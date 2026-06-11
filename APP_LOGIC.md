# Oaki Tracker — App Logic Reference

> Originally generated 2026-05-18; rewritten 2026-06-10 to reflect the per-view-round schema (migration 018), the v2 RPC architecture (022, 024), and current server actions. Intended as a full-fidelity reference for auditing correctness of the app's logic.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Database Schema](#2-database-schema)
3. [Enums](#3-enums)
4. [Row Level Security (RLS)](#4-row-level-security-rls)
5. [RPC Architecture](#5-rpc-architecture)
6. [Migration History](#6-migration-history)
7. [TypeScript Types](#7-typescript-types)
8. [Server Actions](#8-server-actions)
9. [Widget Flow (Team Member)](#9-widget-flow-team-member)
10. [Admin Flow](#10-admin-flow)
11. [Known Invariants & Edge Cases](#11-known-invariants--edge-cases)

---

## 1. Architecture Overview

- **Framework**: Next.js 16.2.6 App Router, TypeScript
- **Database**: Supabase (PostgreSQL), with RLS enabled on every table
- **Auth**: Supabase Auth; `public.users` rows created on first login via `ensureUserProfile()`
- **Route protection**: `proxy.ts` at the repo root. **This is Next.js 16's renamed middleware convention** (`middleware.ts` → `proxy.ts`, exported function `proxy`). It requires auth on all non-`/auth` routes and gates `/admin/*` on the `admin` role. Do not mistake it for dead code.
- **Styling**: Tailwind v4 CSS-first, dark theme tokens
- **Roles**: `admin`, `team_member`, `client` (only admin and team_member are used in practice)
- **Desktop**: Tauri 2 shell (`src-tauri/`) that loads the hosted `/app/widget` URL in a WebView. The URL is baked in at build time via `OAKI_WIDGET_URL`; release builds assert it is HTTPS.

### Route structure

| Path | Access | Purpose |
|------|--------|---------|
| `/app/widget` | All authenticated | Team widget — start/finish/block/reset stages |
| `/admin/projects` | Admin | List all non-archived projects |
| `/admin/projects/new` | Admin | Create project form |
| `/admin/projects/[id]` | Admin | Project detail: status, per-view rounds, stage grid, delivery |
| `/admin/today` | Admin | Dashboard: blocked stages, ETAs due today, due this week, feedback, revisions |
| `/admin/deliveries` | Admin | Delivery history with undo |
| `/admin/timeline` | Admin | Timeline view |
| `/admin/clients` | Admin | Client management |
| `/auth/login` | Public | Login |

---

## 2. Database Schema

### `users`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | References `auth.users(id)` ON DELETE CASCADE |
| name | TEXT NOT NULL | |
| email | TEXT NOT NULL UNIQUE | |
| role | user_role NOT NULL DEFAULT 'team_member' | |
| created_at | TIMESTAMPTZ | |

Rows are created by the app on first login (`ensureUserProfile`), not by a DB trigger.

### `clients`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| name | TEXT NOT NULL | |
| contact_name / contact_email / phone / website / notes | TEXT | |
| status | client_status NOT NULL DEFAULT 'active' | 'active' \| 'inactive' \| 'archived' |
| created_at / updated_at | TIMESTAMPTZ | |

### `projects`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| client_id | UUID → clients | ON DELETE SET NULL |
| name | TEXT NOT NULL | |
| notes | TEXT | Added in migration 010 |
| status | project_status NOT NULL DEFAULT 'not_started' | App always sets canonical values; see enum below |
| delivery_date | DATE | |
| delivery_time_window | time_window | |
| view_count | INT NOT NULL DEFAULT 1 CHECK >= 1 | |
| current_round_number | INT NOT NULL DEFAULT 0 | **Legacy / effectively dead post-018.** Rounds are per-view now (`project_views.current_round_number` + `project_view_rounds`). Kept only for backward compat; no active code reads it. Candidate for removal. |
| delivery_count | INT NOT NULL DEFAULT 0 | Incremented by `mark_delivery_sent_v2_rpc`, decremented by undo. Advisory — the admin detail page derives delivery history from `project_view_rounds.delivered_at` instead. |
| created_at / updated_at | TIMESTAMPTZ | `updated_at` auto-set by trigger |

### `project_views`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| project_id | UUID → projects ON DELETE CASCADE | |
| number | INT NOT NULL | 1-based |
| label | TEXT NOT NULL | "View 01", "View 02", etc. |
| active | BOOLEAN NOT NULL DEFAULT TRUE | Deactivated views are excluded from the workflow |
| current_round_number | INT NOT NULL DEFAULT 0 | Per-view round counter (added in 018) |
| created_at | TIMESTAMPTZ | |

UNIQUE constraint: `(project_id, number)`

### `project_view_rounds` (replaces `delivery_rounds`, migration 018)

**Each view has its own round sequence.** View 01 can be delivered (its round 0 `delivered`) while View 02's round 0 is still `active`. Delivery, undo, and revision rounds are all per-view.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| project_id | UUID → projects ON DELETE CASCADE | |
| project_view_id | UUID → project_views ON DELETE CASCADE | |
| round_number | INT NOT NULL DEFAULT 0 | 0-based per view |
| status | round_status NOT NULL DEFAULT 'active' | 'active' \| 'delivered' \| 'revision_requested' (+ legacy 'ready_for_admin_review') |
| delivered_at | TIMESTAMPTZ | Set by `mark_delivery_sent_v2_rpc`; one timestamp groups a delivery batch |
| created_at | TIMESTAMPTZ | |

UNIQUE constraint: `(project_view_id, round_number)`

The old project-wide `delivery_rounds` table was **dropped in migration 018**.

### `view_stage_states`
One row per `(project_view_round, project_view, stage)` triplet.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| project_id | UUID → projects ON DELETE CASCADE | Denormalized for efficient RLS queries |
| project_view_round_id | UUID → project_view_rounds ON DELETE CASCADE | NOT NULL (018) |
| project_view_id | UUID → project_views ON DELETE CASCADE | |
| stage | stage_type NOT NULL | |
| status | stage_status NOT NULL DEFAULT 'not_started' | |
| assigned_user_id | UUID → users ON DELETE SET NULL | Set when a team member starts the stage; cleared on finish/reset |
| started_at / completed_at | TIMESTAMPTZ | |
| latest_eta_date | DATE | Cleared on finish/reset |
| latest_eta_time_window | time_window | |
| block_reason | TEXT | |
| status_before_block | stage_status | Saved when blocking (014); restored on unblock |
| updated_at | TIMESTAMPTZ | Auto-set by trigger |

UNIQUE constraint includes `(project_view_round_id, project_view_id, stage)`.

### `stage_events` (append-only)
`id, project_id, project_view_round_id (NOT NULL), project_view_id, stage, event_type, actor_id, eta_date, eta_time_window, created_at`

### `project_events` (append-only)
`id, project_id, actor_id, event_type, payload JSONB, created_at`

---

## 3. Enums

### `project_status`
**Canonical (the app only sets these):** `active`, `waiting_for_feedback`, `delivered`, `revision`, `archived`

**Legacy (still in the enum, backfilled to canonical by 009/010):** `not_started`, `in_progress`, `waiting_for_client`, `ready_to_deliver`, `revision_in_progress`, `waiting_for_info`, `ready_to_start`, `in_production`

### `stage_type`
`initial` → `advanced` → `post_production`. Display labels (lib/types/app.ts): "Assets & References", "3D", "Post-production". Order is enforced for team members by `start_stage_v2_rpc` (previous stage must be `done`); admins are exempt.

### `stage_status`
`not_started` | `in_progress` | `done` | `blocked` | `reopened`

### `round_status`
`active` | `delivered` | `revision_requested` | `ready_for_admin_review` (legacy, no longer set; repaired to `active` by `ensure_workflow_v2_rpc`)

### `time_window`
`Midday` | `Afternoon` | `EOD`

### `stage_event_type`
`stage_started` | `stage_eta_changed` | `stage_finished` | `stage_reopened` | `stage_blocked` | `stage_unblocked` | `stage_reset` (added 019)

### `project_event_type`
`project_created` | `delivery_date_changed` | `public_eta_changed` | `view_count_changed` | `delivery_marked_sent` | `revision_round_created` | `delivery_undone` (added 023) | `project_archived` | `information_received` | `information_completed` | `project_status_changed` | `admin_review_approved`

### `user_role`
`admin` | `team_member` | `client`

---

## 4. Row Level Security (RLS)

RLS is enabled on all tables. Helper:

```sql
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS user_role AS $$
  SELECT role FROM public.users WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

### Policy summary by table

**users** — own-row SELECT for everyone; admin ALL.

**clients** — admin ALL; team SELECT.

**projects** — admin ALL; team SELECT where `status != 'archived'`.

**project_views** — admin ALL; team SELECT.

**project_view_rounds** — admin ALL; team SELECT. **Team INSERT/UPDATE policies from 018 were dropped in migration 024** — all round mutations go through SECURITY DEFINER RPCs (which bypass RLS) or admin policies. Team members cannot write rounds directly.

**view_stage_states** — admin ALL; team SELECT (all states — needed for widget conflict detection); team UPDATE/INSERT (used by the widget's `undoStageAction` direct writes and legacy repair paths; all other mutations go through RPCs).

**stage_events** — admin ALL; team SELECT; team INSERT own events only (`actor_id = auth.uid()`).

**project_events** — admin ALL; team SELECT.

---

## 5. RPC Architecture

All workflow mutations are single-round-trip `SECURITY DEFINER` PL/pgSQL functions with `SET search_path = public`, returning JSONB `{ ok: true, ... }` or `{ ok: false, error, ... }`. Each re-checks the caller's role from `public.users` at the top. Grants: `REVOKE FROM PUBLIC` + `GRANT EXECUTE TO authenticated`.

### Stage RPCs (migration 022)

| RPC | Caller | Behavior |
|-----|--------|----------|
| `ensure_workflow_v2_rpc(project_id)` | admin/team | Idempotent pre-flight: repair-reactivates the latest non-active round per view (**but never a `delivered` round** — changed in 024), creates round 0 for views with no rounds, fills missing `view_stage_states`. Returns active rounds + states. |
| `start_stage_v2_rpc(project_id, view_ids[], stage, eta_date?, eta_window?)` | admin/team | Sequential-stage enforcement for team; conflict detection (`in_progress` by someone else → `{ error: 'conflict', conflictingViewIds }`); atomic state update + `stage_started` events in one CTE. |
| `finish_stage_v2_rpc(project_id, view_ids[], stage)` | admin/team | Only `in_progress` states; team can only finish their own. Clears assignee + ETA, sets `completed_at`. |
| `block_stage_v2_rpc(project_id, view_ids[], stage, reason)` | admin/team | Only `in_progress`, own (or admin). Saves `status_before_block`. |
| `reset_stage_v2_rpc(project_id, view_ids[], stage)` | admin/team | Cascade-resets the chosen stage and all later stages to `not_started`; team can only reset stages assigned to them. Logs `stage_reset`. |

### Delivery RPCs (migration 024)

| RPC | Caller | Behavior |
|-----|--------|----------|
| `mark_delivery_sent_v2_rpc(project_id, view_ids[])` | admin | Locks the selected views' active rounds `FOR UPDATE`, verifies every stage is `done` (else returns `{ error: 'incomplete', incomplete: [...] }`), marks rounds `delivered` with one shared `delivered_at` timestamp, sets project `waiting_for_feedback`, increments `delivery_count`, logs `delivery_marked_sent`. Fully transactional. |
| `undo_delivery_sent_v2_rpc(project_id, delivered_at)` | admin | Locks the delivered rounds matching `delivered_at` and all later rounds of the same views. Refuses if any later (revision) round has started work. Deletes clean later rounds, reverts rounds to `active`, resyncs `project_views.current_round_number`, sets project `active`, decrements `delivery_count`, logs `delivery_undone`. |
| `create_revision_round_v2_rpc(project_id, view_ids[])` | admin | Requires project status `waiting_for_feedback`/`delivered` and no active round on the selected views. Inserts `max(round_number)+1` rounds + fresh stage states, updates `project_views.current_round_number`, sets project `revision`, logs `revision_round_created`. Single statement chain (CTE) — atomic. |

### Other

- `check_data_integrity_rpc` (017/021) — admin diagnostics.
- v1 RPCs from migration 015 that referenced `delivery_rounds` were dropped in 022. The 015 GRANT/REVOKE for `create_project_workflow_rpc` used a wrong 6-parameter signature and silently failed; migration 024 re-applies it with the correct signature (guarded).

---

## 6. Migration History

| File | Description |
|------|-------------|
| 001 | All tables (incl. project-wide `delivery_rounds`), enums, indexes, triggers |
| 002 | RLS policies + `current_user_role()` |
| 003 | Profile self-insert policy |
| 004 | Legacy production statuses; `ready_for_admin_review` round status |
| 005 | Auth trigger |
| 006 / 008 | Clients table + column guards |
| 007 | Backfill legacy production statuses (uses `status::text` cast — see gotcha below) |
| 009 / 010 | Canonical statuses (`active`, `revision`); backfill; add `projects.notes`; drop `public_eta_*` columns |
| 011 | Team INSERT policies for workflow repair (largely superseded) |
| 012 | Drop public ETA columns (final) |
| 013 | Repair multiple active rounds |
| 014 | `status_before_block` |
| 015 | v1 RPCs (project-wide rounds) — **dropped in 022**; contains the bad GRANT signature fixed in 024 |
| 016 | Restrict direct-write RLS |
| 017 / 021 | Integrity-check RPC (v1, v2) |
| 018 | **Per-view rounds**: drop `delivery_rounds`, create `project_view_rounds`, re-point `view_stage_states`/`stage_events`, per-view `current_round_number` |
| 019 | `stage_reset` event type |
| 020 | Indexes |
| 022 | v2 stage RPCs (`ensure/start/finish/block/reset_stage_v2_rpc`); drop v1 RPCs |
| 023 | `delivery_undone` event type |
| 024 | **Transactional delivery RPCs** (`mark_delivery_sent_v2_rpc`, `undo_delivery_sent_v2_rpc`, `create_revision_round_v2_rpc`); `ensure_workflow_v2_rpc` no longer reactivates delivered rounds; fix 015 grant signature; drop team INSERT/UPDATE on `project_view_rounds` |

**Critical PostgreSQL gotcha:** enum literals in WHERE clauses are validated at parse time. `WHERE status IN ('waiting_for_info', ...)` fails if any listed value doesn't exist in the enum, even with zero matching rows. Fix: `WHERE status::text IN (...)`.

---

## 7. TypeScript Types

### `lib/types/database.ts`
Manually maintained (not auto-generated; the Supabase clients use `type DB = any` — generating real types via `supabase gen types typescript` is an open TODO requiring a CLI access token).

### `lib/types/app.ts`

- `STAGE_ORDER = ['initial', 'advanced', 'post_production']`
- `STAGE_LABELS = { initial: 'Assets & References', advanced: '3D', post_production: 'Post-production' }`
- `TIME_WINDOWS = ['Midday', 'Afternoon', 'EOD']`
- `ACTIVE_PROJECT_STATUSES = ['active', 'waiting_for_feedback', 'delivered', 'revision']`
- `PROJECT_STATUS_LABELS` — canonical + legacy → display strings
- `BLOCK_REASONS` — preset list ('Waiting for assets', …, 'Other')
- `viewLabel(n)` — "View 01" etc.

**Inputs (no `roundId` anywhere — the RPCs resolve active rounds per view):**
```ts
interface StartStageInput  { projectId; viewIds: string[]; stage; etaDate: string|null; etaTimeWindow: TimeWindow|null }
interface FinishStageInput { projectId; viewIds: string[]; stage }
interface CreateProjectInput { name; clientId: string|null; deliveryDate: string|null; deliveryTimeWindow: TimeWindow|null; viewCount: number }
```

---

## 8. Server Actions

All actions are `'use server'`, auth-checked via `requireAdmin()` / `requireWorker()` (admin or team_member) from `lib/actions/auth.ts`. Most are thin wrappers around the RPCs above.

### `lib/actions/stages.ts`
- `ensureProjectWorkflow(projectId)` → `ensure_workflow_v2_rpc`
- `startStage(input)` → `start_stage_v2_rpc`; maps `{ error: 'conflict' }` to `{ error: 'conflict', conflictingViewIds }`
- `finishStage(input)` → `finish_stage_v2_rpc`
- `blockStage(projectId, viewIds, stage, reason)` → `block_stage_v2_rpc`
- `resetStage(projectId, viewIds, stage)` → `reset_stage_v2_rpc`
- `unblockStage(projectId, viewId, stage)` — **admin-only direct writes** (find active round → check `blocked` → restore `status_before_block` → log `stage_unblocked`). Low-frequency, kept off-RPC intentionally.
- `reopenStage(projectId, viewId, stage)` — admin-only direct writes (`done` → `reopened`, log `stage_reopened`).
- `undoStageAction(projectId, restores[])` — worker direct writes restoring snapshotted states (powers the widget's 12-second undo toast). Relies on team UPDATE policy on `view_stage_states`.

### `lib/actions/delivery.ts` (rewritten for migration 024)
- `markDeliverySent(projectId, viewIds[])` → `mark_delivery_sent_v2_rpc`; on `{ error: 'incomplete' }` maps the payload to `IncompleteItem[]` (`viewLabel`, `stageLabel`, `status`)
- `undoDeliverySent(projectId, deliveredAt)` → `undo_delivery_sent_v2_rpc`; returns `{ revertedCount, revisionRoundsRemoved }`
- `createRevisionRound(projectId, viewIds[])` → `create_revision_round_v2_rpc`

### `lib/actions/projects.ts`
- `createProject(input)` — admin. Insert project (`status: 'active'`) → insert views → insert one round-0 `project_view_rounds` row per view → insert all `views × stages` states → log `project_created`. (Multi-query direct writes; project creation is low-contention.)
- `updateProjectDates(projectId, { deliveryDate, deliveryTimeWindow })` — admin; logs `delivery_date_changed`.
- `archiveProject(projectId)` — admin; sets `archived`, logs `project_archived`.
- `deleteProjectPermanently(projectId, confirmation)` — admin; requires the literal string `"DELETE PROJECT"`. Deletes children explicitly (stage_events → project_events → view_stage_states → project_view_rounds → project_views → projects), stopping on first error.
- `updateProjectStatus(projectId, status)` — admin; free-form status set, logs `project_status_changed`.
- `updateProjectViewCount(projectId, n)` — admin; 1–99. Growing: reactivates/creates views, ensures each has a round + stage states. Shrinking: deactivates views with `number > n` (data preserved). Logs `view_count_changed`.

### `lib/actions/clients.ts`
- `createClient` / `updateClient` — admin; fallback retry without `phone/website/notes` if those columns are missing.
- `archiveClient` — admin; sets `status='archived'`.

All workflow actions revalidate via `revalidateProjectScreens(projectId)` (widget + admin project screens).

---

## 9. Widget Flow (Team Member)

**Page**: `app/app/widget/page.tsx` (RSC). Fetches in parallel: projects `.in('status', ['active', 'revision'])` with client name, current user, team members. `waiting_for_feedback`, `delivered`, `archived` are excluded — no team work needed. (Legacy statuses were backfilled by 009/010, so they're not in the filter.)

**Client component**: `components/widget/WidgetClient.tsx`

### State model
- Selection: `projectId`, `stage`, `selectedViewIds`, `etaDate`, `etaWindow`, `viewFilter`
- Data: `views`, `viewRounds` (active per-view rounds), `states`, `roundLoading`, `workflowError`
- Transient: `feedback` (auto-clears after 8 s), `conflictViewIds`, `panel: 'none' | 'block' | 'reset'` (block picker and reset confirm are mutually exclusive), `blockReason`, `undoState`
- In-flight: `pendingAction`, `pendingViewIds`

**Initial stage is whole-project, but per-view-aware:** `effectiveSelectedViewIds` is *derived* — when `stage === 'initial'` it is every view that has an Initial state in an **active** round (delivered/locked views are skipped). Because views can sit on different rounds with mixed statuses (view-count expansion, per-view delivery), each action further narrows to its actionable subset: Start targets views whose Initial is `not_started`/`reopened` (`startTargetViewIds`), Finish/Block target views `in_progress` and assigned to the caller (`finishTargetViewIds`), Reset targets non-`not_started` views owned by the caller or any if admin (`resetTargetViewIds`). A button is enabled when its subset is non-empty. Non-initial stages keep strict all-selected-must-match semantics over the user's explicit selection.

### Loading lifecycle
On project change: synchronous reset in the `onChange` handler (lint rule `react-hooks/set-state-in-effect` forbids sync setState in effects), then a `useEffect` fetches `project_views` (client-side Supabase) and `ensureProjectWorkflow` (server action) in parallel.

### Actions
All four mutations (start / finish / reset / block) follow the same shape: snapshot affected states → optimistic `setStates` → server action → on error `rollback(snapshot)` + feedback → on success `mergeStates(updatedStates)` from the RPC response. Start and finish arm a 12-second **undo toast**; undo restores the snapshot via `undoStageAction` (direct writes).

- Conflict on start: RPC returns `conflictingViewIds`; those cells get the conflict style and a feedback message is shown.
- Eligibility: `canStart` (all selected `not_started`/`reopened`, previous stage done unless admin), `canFinish`/`canBlock` (all selected `in_progress` and mine), `canReset` (anything non-`not_started`, mine unless admin; warns about cascade to later stages).
- `startDisabledReason` / `finishDisabledReason` strings surface why a button is disabled.

### Quick filters
Chips: All / Mine / Available / Blocked / Done with counts; changing a filter prunes the selection to views still visible.

---

## 10. Admin Flow

### `/admin/projects`
RSC list of non-archived projects with progress derived from active rounds' states.

### `/admin/projects/[id]`
RSC fetches project + client, all `project_view_rounds`, active views, and stage states for active rounds (joined with `users.name`). `ProjectDetailClient` handles:

| Section | Behavior |
|---------|----------|
| Info bar | Delivery date, progress, status, view count — each opens an inline editor |
| Blocked stages | List with per-stage Unblock buttons |
| Send delivery | Per-view checkboxes with readiness ("Ready" / "N incomplete"); select-all-ready; confirm → `markDeliverySent(projectId, viewIds)` |
| Revision | Shown when status is `waiting_for_feedback`/`delivered` and delivered views exist; per-view checkboxes → `createRevisionRound(projectId, viewIds)` |
| View count | +/− stepper → `updateProjectViewCount` |

### `/admin/deliveries`
Delivery history grouped by `(project, delivered_at)` with **Undo** buttons → `undoDeliverySent(projectId, deliveredAt)`.

### `/admin/today`
Parallel queries: due this week, ETAs due today (`latest_eta_date = today AND status = 'in_progress'`), blocked stages, waiting-for-feedback projects, active revisions.

---

## 11. Known Invariants & Edge Cases

### Delivered rounds are locked
After `mark_delivery_sent_v2_rpc`, a view has no active round. Since migration 024, `ensure_workflow_v2_rpc` will **not** reactivate a `delivered` round — merely opening the widget cannot reopen delivered work. The only exits from `delivered` are `create_revision_round_v2_rpc` (new round) or `undo_delivery_sent_v2_rpc` (revert). Views with no active round simply don't participate in the widget workflow.

### Delivery batching by timestamp
`mark_delivery_sent_v2_rpc` stamps all rounds in one call with a single `delivered_at` value; the deliveries history and undo identify a batch by exact `(project_id, delivered_at)` match. Don't update `delivered_at` out-of-band.

### Undo safety
`undo_delivery_sent_v2_rpc` refuses if any later round of the affected views has a stage that isn't `not_started`. Clean later rounds are cascade-deleted (their stage states go via FK cascade). The whole operation is one transaction; it cannot race `create_revision_round_v2_rpc` because both lock the relevant rounds / project row.

### Round counters
- `project_views.current_round_number` — authoritative per-view counter, maintained by the revision/undo RPCs.
- `projects.current_round_number` — **dead** (pre-018 relic). Do not read it.
- `projects.delivery_count` — advisory; UI derives delivery history from `delivered_at` timestamps.

### No enforced project status machine
Admin can set any canonical status via `updateProjectStatus`. Implicit transitions: create → `active`; delivery → `waiting_for_feedback`; revision → `revision`; undo delivery → `active`; archive → `archived`.

### Stage order enforcement is server-side for team only
`start_stage_v2_rpc` requires the previous stage `done` for team members; admins bypass. The widget mirrors this client-side (`stageOrderBlock`) for UX, but the RPC is the authority.

### Optimistic-update rollback caveat
The widget snapshots only the fields it mutates. If a concurrent server change lands between snapshot and rollback, the rollback can overwrite it until the next `ensureProjectWorkflow` reload. Acceptable for a small team; a full reload on error is the mitigation (`reloadStates()` is called after failed undos).

### `view_stage_states` team UPDATE policy is still open
Required by `undoStageAction` (widget undo). All other state mutations go through RPCs that enforce ownership. Tightening this policy (e.g. `assigned_user_id = auth.uid()` WITH CHECK) would break undo of finish (which clears the assignee) — revisit if undo ever moves into an RPC.

### `deleteProjectPermanently` event log race
The action logs a `project_archived` event first, then deletes all `project_events` — the pre-log is always deleted. Intentional but of questionable value.

### Enum parse-time validation
See the gotcha in §6 — always cast `status::text` when filtering on possibly-absent enum literals.
