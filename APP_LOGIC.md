# Oaki Tracker — App Logic Reference

> Generated 2026-05-18. Intended as a full-fidelity reference for auditing correctness of the app's logic.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Database Schema](#2-database-schema)
3. [Enums](#3-enums)
4. [Row Level Security (RLS)](#4-row-level-security-rls)
5. [Migration History](#5-migration-history)
6. [TypeScript Types](#6-typescript-types)
7. [Server Actions](#7-server-actions)
8. [Widget Flow (Team Member)](#8-widget-flow-team-member)
9. [Admin Flow](#9-admin-flow)
10. [Known Invariants & Edge Cases](#10-known-invariants--edge-cases)

---

## 1. Architecture Overview

- **Framework**: Next.js 16.2.6 App Router, TypeScript
- **Database**: Supabase (PostgreSQL), with RLS enabled on every table
- **Auth**: Supabase Auth; `public.users` rows created on first login via `ensureUserProfile()`
- **Styling**: Tailwind v4 CSS-first, dark theme tokens
- **Roles**: `admin`, `team_member`, `client` (only admin and team_member are used in practice)

### Route structure

| Path | Access | Purpose |
|------|--------|---------|
| `/app/widget` | All authenticated | Team widget — start/finish/block stages |
| `/admin/projects` | Admin | List all non-archived projects |
| `/admin/projects/new` | Admin | Create project form |
| `/admin/projects/[id]` | Admin | Project detail: status, rounds, stage grid |
| `/admin/today` | Admin | Dashboard: blocked stages, ETAs due today, due this week, feedback, revisions |
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
| contact_name | TEXT | |
| contact_email | TEXT | |
| phone | TEXT | |
| website | TEXT | |
| notes | TEXT | |
| status | ClientStatus NOT NULL DEFAULT 'active' | 'active' \| 'inactive' \| 'archived' |
| created_at / updated_at | TIMESTAMPTZ | |

### `projects`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| client_id | UUID → clients | ON DELETE SET NULL |
| name | TEXT NOT NULL | |
| notes | TEXT | Added in migration 010 |
| status | project_status NOT NULL DEFAULT 'not_started' | See enum below |
| delivery_date | DATE | |
| delivery_time_window | time_window | |
| ~~public_eta_date~~ | ~~DATE~~ | Removed in migration 010 (column still exists in DB, removed from TS types) |
| ~~public_eta_time_window~~ | ~~time_window~~ | Same as above |
| view_count | INT NOT NULL DEFAULT 1 CHECK >= 1 | |
| current_round_number | INT NOT NULL DEFAULT 0 | Tracks the latest round number |
| delivery_count | INT NOT NULL DEFAULT 0 | Incremented on each `markDeliverySent` |
| created_at / updated_at | TIMESTAMPTZ | `updated_at` auto-set by trigger |

### `project_views`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| project_id | UUID → projects ON DELETE CASCADE | |
| number | INT NOT NULL | 1-based |
| label | TEXT NOT NULL | "View 01", "View 02", etc. |
| active | BOOLEAN NOT NULL DEFAULT TRUE | |
| created_at | TIMESTAMPTZ | |

UNIQUE constraint: `(project_id, number)`

### `delivery_rounds`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| project_id | UUID → projects ON DELETE CASCADE | |
| round_number | INT NOT NULL | 0-based (Round 00, Round 01, …) |
| status | round_status NOT NULL DEFAULT 'active' | |
| started_at | TIMESTAMPTZ | |
| completed_at | TIMESTAMPTZ | |
| delivered_at | TIMESTAMPTZ | Set by `markDeliverySent` |
| created_at | TIMESTAMPTZ | |

UNIQUE constraint: `(project_id, round_number)`

### `view_stage_states`
One row per `(delivery_round, project_view, stage)` triplet.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| project_id | UUID → projects ON DELETE CASCADE | Denormalized for efficient RLS queries |
| delivery_round_id | UUID → delivery_rounds ON DELETE CASCADE | |
| project_view_id | UUID → project_views ON DELETE CASCADE | |
| stage | stage_type NOT NULL | 'initial' \| 'advanced' \| 'post_production' |
| status | stage_status NOT NULL DEFAULT 'not_started' | |
| assigned_user_id | UUID → users ON DELETE SET NULL | Set when a team member starts the stage |
| started_at | TIMESTAMPTZ | |
| completed_at | TIMESTAMPTZ | |
| latest_eta_date | DATE | |
| latest_eta_time_window | time_window | |
| block_reason | TEXT | |
| updated_at | TIMESTAMPTZ | Auto-set by trigger |

UNIQUE constraint: `(delivery_round_id, project_view_id, stage)`

### `stage_events` (append-only)
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| project_id | UUID | Denormalized |
| delivery_round_id | UUID | |
| project_view_id | UUID | |
| stage | stage_type | |
| event_type | stage_event_type | |
| actor_id | UUID → users | |
| eta_date / eta_time_window | | Set on stage_started / stage_eta_changed |
| created_at | TIMESTAMPTZ | |

### `project_events` (append-only)
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| project_id | UUID | |
| actor_id | UUID → users | |
| event_type | project_event_type | |
| payload | JSONB | Structured context per event type |
| created_at | TIMESTAMPTZ | |

### Indexes
- `projects(status)` — for status-filtered queries
- `project_views(project_id)`
- `delivery_rounds(project_id)`
- `view_stage_states(project_id)`
- `view_stage_states(delivery_round_id)`
- `stage_events(project_id)`
- `project_events(project_id)`

### Triggers
- `set_updated_at_projects` — BEFORE UPDATE on `projects`, sets `updated_at = NOW()`
- `set_updated_at_view_stage_states` — BEFORE UPDATE on `view_stage_states`

---

## 3. Enums

### `project_status` (PostgreSQL enum)
**Canonical values (post-migration 009/010):**
- `active` — normal working state
- `waiting_for_feedback` — delivery sent, awaiting client response
- `delivered` — final delivery accepted (manual admin set)
- `revision` — revision round in progress
- `archived` — hidden from widget and most queries

**Legacy values (still exist in DB enum for backward compat):**
`not_started`, `in_progress`, `waiting_for_client`, `ready_to_deliver`, `revision_in_progress`, `waiting_for_info`, `ready_to_start`, `in_production`

### `stage_type`
`initial` → `advanced` → `post_production` (order matters for warning logic)

### `stage_status`
`not_started` | `in_progress` | `done` | `blocked` | `reopened`

### `round_status`
`active` | `delivered` | `revision_requested` | `ready_for_admin_review`

Note: `ready_for_admin_review` is referenced in `ensureProjectWorkflow` as a valid "active-ish" round status but no longer set by any action (legacy). `delivered` is set by `markDeliverySent`.

### `time_window`
`Midday` | `Afternoon` | `EOD`

### `stage_event_type`
`stage_started` | `stage_eta_changed` | `stage_finished` | `stage_reopened` | `stage_blocked` | `stage_unblocked`

### `project_event_type`
`project_created` | `delivery_date_changed` | `public_eta_changed` | `view_count_changed` | `delivery_marked_sent` | `revision_round_created` | `project_archived` | `information_received` | `information_completed` | `project_status_changed` | `admin_review_approved`

### `user_role`
`admin` | `team_member` | `client`

---

## 4. Row Level Security (RLS)

RLS is enabled on all 8 tables.

### Helper function
```sql
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS user_role AS $$
  SELECT role FROM public.users WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```
SECURITY DEFINER is required because `public.users` itself has RLS — this function bypasses it to read the calling user's own role.

### Policy summary by table

**users**
- Any authenticated user: SELECT their own row (`id = auth.uid()`)
- Admin: SELECT all rows
- Admin: ALL operations

**clients**
- Admin: ALL
- Team member + admin: SELECT

**projects**
- Admin: ALL
- Team member: SELECT where `status != 'archived'`

**project_views**
- Admin: ALL
- Team member + admin: SELECT

**delivery_rounds**
- Admin: ALL
- Team member + admin: SELECT
- Team member: INSERT (added in migration 011, for `ensureProjectWorkflow` repair)

**view_stage_states**
- Admin: ALL
- Team member: SELECT (all states — needed for conflict detection in widget)
- Team member: UPDATE (start/finish/block stages)
- Team member: INSERT (added in migration 011, for `ensureProjectWorkflow` repair)

**stage_events**
- Admin: ALL
- Team member: SELECT
- Team member: INSERT own events only (`actor_id = auth.uid()`)

**project_events**
- Admin: ALL
- Team member: SELECT

---

## 5. Migration History

| File | Description |
|------|-------------|
| 001_initial_schema.sql | All tables, enums, indexes, triggers |
| 002_rls.sql | RLS policies and `current_user_role()` function |
| 003_* | (Not read — likely clients or users additions) |
| 004_* | Added legacy statuses to project_status enum |
| 005_* | User profile migration; profile row seeding |
| 006_* | Unknown |
| 007_backfill_production_statuses.sql | Backfills legacy status values. Uses `status::text` cast to avoid PostgreSQL enum parse-time validation. Wrapped in `DO $$ BEGIN IF EXISTS (... 'in_production' in enum) THEN ... END IF; END $$` guard so it no-ops if migration 004 was skipped. |
| 008_* | Unknown |
| 009_simplified_statuses.sql | Adds `active` and `revision` to the project_status enum (idempotent: `ADD VALUE IF NOT EXISTS`) |
| 010_backfill_simplified_statuses.sql | Adds `notes` column to projects. Collapses all legacy statuses to canonical values using `status::text IN (...)` cast. Maps: `not_started/in_progress/waiting_for_info/ready_to_start/in_production/ready_to_deliver` → `active`; `revision_in_progress` → `revision`; `waiting_for_client` → `waiting_for_feedback`. Also drops `public_eta_date` and `public_eta_time_window` columns. |
| 011_team_workflow_repair_policies.sql | Grants INSERT on `delivery_rounds` and `view_stage_states` to team_member role (needed for `ensureProjectWorkflow` auto-repair). |

**Critical PostgreSQL gotcha documented during development:** Enum literals in WHERE clauses are validated at parse time, before execution. `WHERE status IN ('waiting_for_info', ...)` will fail with an error if any listed value does not exist in the enum, even if no rows have that value. Fix: use `WHERE status::text IN (...)` to cast the column to text first.

---

## 6. TypeScript Types

### `lib/types/database.ts`

Manually maintained type definitions (not auto-generated from Supabase).

**ProjectStatus** — canonical values first, legacy values appended for backward compat:
```ts
type ProjectStatus =
  | 'active' | 'waiting_for_feedback' | 'delivered' | 'revision' | 'archived'
  // legacy:
  | 'waiting_for_info' | 'ready_to_start' | 'in_production'
  | 'ready_to_deliver' | 'revision_in_progress' | 'not_started'
  | 'in_progress' | 'waiting_for_client'
```

Note: `public_eta_date` and `public_eta_time_window` are removed from the `projects` Row/Insert/Update types even though they may still exist as columns in the DB (dropped in migration 010). The `block_reason` field on `view_stage_states` is in the TS type but was added as a column in a later migration (not in 001).

### `lib/types/app.ts`

Higher-level types and constants derived from `database.ts`:

- `STAGE_ORDER: StageType[] = ['initial', 'advanced', 'post_production']`
- `STAGE_LABELS` — display labels for each stage type
- `TIME_WINDOWS: TimeWindow[] = ['Midday', 'Afternoon', 'EOD']`
- `ACTIVE_PROJECT_STATUSES = ['active', 'waiting_for_feedback', 'delivered', 'revision']`
- `PROJECT_STATUS_LABELS` — maps all canonical + legacy values to display strings; legacy values map to nearest canonical label
- `BLOCK_REASONS` — preset list: 'Waiting for assets', 'Waiting for approval', 'Technical issue', 'Awaiting client feedback', 'Scope unclear', 'Other'
- `roundLabel(n)` — `Round ${n.padStart(2, '0')}` e.g. "Round 00", "Round 01"
- `viewLabel(n)` — `View ${n.padStart(2, '0')}` e.g. "View 01"

**CreateProjectInput:**
```ts
interface CreateProjectInput {
  name: string
  clientId: string | null
  deliveryDate: string | null
  deliveryTimeWindow: TimeWindow | null
  viewCount: number
  notes?: string | null
}
```

---

## 7. Server Actions

All actions are `'use server'` Next.js Server Actions. All check authentication first (`supabase.auth.getUser()`). Admin-only actions additionally check `users.role === 'admin'`.

### `lib/actions/projects.ts`

#### `createProject(input: CreateProjectInput)`
**Auth**: Admin only.

Steps:
1. Insert into `projects` with `status: 'active'`
2. Insert `view_count` rows into `project_views` (labeled "View 01", "View 02", …)
3. Insert `delivery_rounds` row: `round_number: 0, status: 'active'`
4. Insert `view_stage_states`: all `views × STAGE_ORDER` combinations, `status: 'not_started'`
5. Log `project_created` event
6. `revalidatePath('/admin/projects')`

Returns: `{ data: project }` or `{ error: string }`

#### `updateProjectDates(projectId, { deliveryDate, deliveryTimeWindow })`
**Auth**: Admin only.

Updates `delivery_date` and `delivery_time_window` on the project. Logs `delivery_date_changed` event if `deliveryDate` is provided (even if null — logs the clear).

`revalidatePath('/admin/projects/[id]')`

#### `archiveProject(projectId)`
**Auth**: Admin only.

Sets `status = 'archived'`. Logs `project_archived`. Revalidates `/admin/projects`, `/admin/projects/[id]`, `/app/widget`.

#### `deleteProjectPermanently(projectId)`
**Auth**: Admin only. No typing confirmation required.

Steps (sequential, stops on first error):
1. Pre-log `project_archived` event with `{ action: 'delete_permanently_requested', project_name }`
2. Delete `stage_events` WHERE `project_id`
3. Delete `project_events` WHERE `project_id`
4. Delete `view_stage_states` WHERE `project_id`
5. Delete `delivery_rounds` WHERE `project_id`
6. Delete `project_views` WHERE `project_id`
7. Delete `projects` WHERE `id`

Note: The event log step (step 1) will itself be deleted in step 3. The cascade on `projects` (ON DELETE CASCADE on child tables) would handle cleanup, but the action deletes children explicitly in order to surface errors from each step.

`revalidatePath('/admin/projects')`, `/admin/projects/[id]`, `/app/widget`

#### `updateProjectStatus(projectId, status)`
**Auth**: Admin only.

Sets `status` to any value. Logs `project_status_changed`. Revalidates `/admin/projects`, `/admin/projects/[id]`, `/admin/today`.

---

### `lib/actions/stages.ts`

#### `ensureProjectWorkflow(projectId)` — called by both widget and `startStage`
**Auth**: Any authenticated user (team_member or admin).

Purpose: Guarantee a usable active round + full set of `view_stage_states` exists, auto-repairing if rows are missing.

Steps:
1. Fetch project — error if not found or `status === 'archived'`
2. Fetch active views (`active = true`) — error if none
3. Query `delivery_rounds` where `status IN ('active', 'ready_for_admin_review')`, ordered by `round_number DESC` — take the first
4. If no round found: INSERT a new `delivery_rounds` row with `round_number = project.current_round_number, status: 'active'`
5. Fetch all `view_stage_states` for the round
6. Compute missing `(view_id, stage)` pairs — INSERT any missing states with `status: 'not_started'`
7. Re-fetch all states for the round
8. Return `{ data: { round, states } }`

**RLS requirement**: team_member needs INSERT on `delivery_rounds` and `view_stage_states` — added by migration 011.

#### `startStage(input: StartStageInput)`
**Auth**: Any authenticated user.

`StartStageInput`: `{ projectId, roundId, viewIds[], stage, etaDate, etaTimeWindow }`

Steps:
1. Call `ensureProjectWorkflow(projectId)` — return its error if any
2. Check for conflicts: any `view_stage_states` with `status = 'in_progress'` for the same `(roundId, viewIds, stage)`
   - If conflicts: return `{ error: 'conflict', conflictingViewIds: [...] }`
3. UPDATE `view_stage_states` SET `status='in_progress', assigned_user_id=user.id, started_at=now, latest_eta_date, latest_eta_time_window, block_reason=null` WHERE `(delivery_round_id, project_view_id IN viewIds, stage)`
4. Verify: re-fetch updated rows and check count matches `viewIds.length` — error if short
5. Insert `stage_started` events for each viewId
6. Revalidate `/app/widget`, `/admin/projects/[id]`

**Note**: ETA is optional. Empty string `etaDate` is sent as `null`.

#### `finishStage(input: FinishStageInput)`
**Auth**: Any authenticated user.

`FinishStageInput`: `{ projectId, roundId, viewIds[], stage }`

Steps:
1. UPDATE `view_stage_states` SET `status='done', completed_at=now` WHERE `(delivery_round_id, project_view_id IN viewIds, stage)`
2. Insert `stage_finished` events
3. Revalidate `/app/widget`, `/admin/projects/[id]`

**No auto-advance of project status.** Project status must be changed manually by admin.

#### `blockStage(projectId, roundId, viewIds[], stage, reason)`
**Auth**: Any authenticated user.

UPDATE `view_stage_states` SET `status='blocked', block_reason=reason`. Insert `stage_blocked` events. Revalidate `/app/widget`, `/admin/projects/[id]`.

#### `unblockStage(projectId, roundId, viewId, stage)`
**Auth**: Admin only.

UPDATE `view_stage_states` SET `status='not_started', block_reason=null`. Insert `stage_unblocked` event. Revalidate `/admin/projects/[id]`, `/admin/today`.

Note: `unblockStage` takes a single `viewId` (not an array), unlike `blockStage` which takes `viewIds[]`.

#### `reopenStage(projectId, roundId, viewId, stage)`
**Auth**: Admin only.

UPDATE `view_stage_states` SET `status='reopened', completed_at=null`. Insert `stage_reopened` event. Revalidate `/admin/projects/[id]`.

---

### `lib/actions/delivery.ts`

#### `markDeliverySent(projectId, roundId)`
**Auth**: Admin only.

Steps:
1. UPDATE `delivery_rounds` SET `status='delivered', delivered_at=now` WHERE `id=roundId`
2. Fetch project's current `delivery_count`
3. UPDATE `projects` SET `delivery_count += 1, status='waiting_for_feedback'`
4. Log `delivery_marked_sent` event
5. Revalidate `/admin/projects/[id]`, `/admin/projects`, `/admin/today`

**Note**: Does NOT increment `current_round_number`. The round number only advances when a revision round is created.

#### `createRevisionRound(projectId)`
**Auth**: Admin only.

Steps:
1. Fetch project's `current_round_number` and `view_count`
2. `newRoundNumber = current_round_number + 1`
3. INSERT new `delivery_rounds` row: `round_number=newRoundNumber, status='active'`
4. Fetch active views
5. INSERT `view_stage_states` for all `views × STAGE_ORDER`, `status: 'not_started'`
6. UPDATE `projects` SET `current_round_number=newRoundNumber, status='revision'`
7. Log `revision_round_created` event
8. Revalidate `/admin/projects/[id]`, `/admin/today`

---

### `lib/actions/clients.ts`

#### `createClient(input: ClientInput)`
**Auth**: Admin only (via shared `requireAdmin()` helper).

INSERT into `clients`. Has fallback: if the insert fails with "Could not find the column" (meaning `phone`/`website`/`notes` columns don't exist yet), retries with only `name`, `contact_name`, `contact_email`. Revalidates `/admin/clients`, `/admin/projects/new`.

#### `updateClient(id, input: ClientInput)`
**Auth**: Admin only. Same fallback as `createClient`.

#### `archiveClient(id)`
**Auth**: Admin only. Sets `status='archived'`.

---

## 8. Widget Flow (Team Member)

**Page**: `app/app/widget/page.tsx` (server component)
**Client component**: `components/widget/WidgetClient.tsx`

### Server component data fetch
Queries `projects` with `.in('status', ['active', 'revision', 'waiting_for_info', 'ready_to_start', 'in_production', 'ready_to_deliver', 'not_started', 'in_progress'])`.

This intentionally **excludes** `waiting_for_feedback`, `delivered`, and `archived` — those projects don't need team work.

Also fetches current user's name and role to show in the header.

### Client component state

```
projectId        — selected project UUID
stage            — selected StageType | ''
selectedViewIds  — string[] of selected view UUIDs
etaDate          — string (YYYY-MM-DD) | ''
etaWindow        — TimeWindow | ''
views            — View[] loaded async
round            — Round | null loaded async
roundLoading     — boolean (true while ensureProjectWorkflow is in flight)
states           — ViewState[] for the active round
conflictViewIds  — string[] set after a conflict error
feedback         — { ok: boolean, msg: string } | null
showBlockPanel   — boolean
blockReason      — string
```

### Loading lifecycle

When project changes (onChange of project selector):
1. Synchronously reset: `projectId=next, selectedViewIds=[], conflictViewIds=[], showBlockPanel=false, blockReason='', stage='', etaDate='', etaWindow='', feedback=null, round=null, states=[], views=[], roundLoading=!!next`

Then a `useEffect` (deps: `[projectId, supabase]`) fires:
1. Parallel: fetch `project_views` from Supabase client + call `ensureProjectWorkflow(projectId)` (server action)
2. Set `views` from Supabase result
3. Set `roundLoading=false`
4. If workflow error: set `feedback({ ok: false, msg: error })`
5. If workflow success: set `round` and `states`

**Why the state resets are in onChange not in useEffect:** The `react-hooks/set-state-in-effect` lint rule disallows synchronous `setState` calls in the effect body (causes cascading render loops). Resets go in the event handler instead.

### `disabledReason` logic

Controls whether Start Stage / Mark Done buttons are disabled:
```
isPending          → 'action running'
!projectId         → 'no project selected'
roundLoading       → 'loading workflow…'
!round             → 'no active delivery round'
!stage             → 'no stage selected'
selectedViewIds.length === 0 → 'no views selected'
null               → button is enabled
```

ETA is always optional — never gates the Start button.

### View button states

For each view button in the grid, the style reflects the `view_stage_states` status for that `(view, stage)` combination:

| Condition | Style |
|-----------|-------|
| selected | accent background |
| conflict (returned from startStage) | blocked style |
| status = done | done-bg with checkmark |
| status = in_progress, assigned = current user | accent border |
| status = in_progress, assigned = other user | warn border |
| status = blocked | blocked-bg with `!` |
| otherwise | default |

### Stage warning

If the selected stage is `advanced` or `post_production`, the widget shows a warning if the previous stage is not `done` for any of the selected views. This is informational only — it does not disable the button.

### Actions

**Start Stage** (`handleStart`):
- Calls `startStage({ projectId, roundId: round.id, viewIds, stage, etaDate|null, etaTimeWindow|null })`
- On `error === 'conflict'`: show conflict feedback, highlight conflicting views
- On other error: show error feedback
- On success: clear selection, reload states from DB

**Mark Done** (`handleFinish`):
- Calls `finishStage({ projectId, roundId: round.id, viewIds, stage })`
- On error: show feedback; on success: clear selection, reload states

**Block** (shown only when `anyInProgress && selectedViewIds.length > 0 && !!stage`):
- Shows block panel with reason selector
- Calls `blockStage(projectId, round.id, viewIds, stage, blockReason)`
- Requires reason to be selected (button disabled if empty)

**reloadStates()**: Fetches `view_stage_states` for the current `round.id` from Supabase client directly (not via server action).

### Dev debug panel

Rendered only in `NODE_ENV === 'development'`. Shows: project id, round id (or 'loading…'), stage, selected view labels, `disabledReason` (or 'none — button should be active').

---

## 9. Admin Flow

### `/admin/projects` — Project list

Server component. Queries all non-archived projects with their `delivery_rounds.view_stage_states` for progress calculation. Progress is based on the active round's states.

Each row has:
- Link to `/admin/projects/[id]`
- Progress bar (active round states)
- Status badge
- `ProjectCleanupActions` (compact mode) — Archive and Delete buttons

### `/admin/projects/[id]` — Project detail

Server component fetching:
- Full project row + client
- All `delivery_rounds` ordered by round_number
- Active views
- `view_stage_states` for the active round (joined with `users.name`)

**Active round**: finds the first round where `status = 'active' OR 'ready_for_admin_review'`.

**Stage grid**: Renders a table of `views × stages` with `StageBadge` for each cell. Shows `block_reason` and ETA inline per cell.

**`ProjectDetailClient`** (client component) handles:

| Section | Fields / Actions |
|---------|-----------------|
| Blocked stages panel | Lists all states where `status='blocked'`. Each has an Unblock button → calls `unblockStage` |
| Status | Current status display. "Change" → grid of `ACTIVE_PROJECT_STATUSES` buttons → calls `updateProjectStatus` |
| Delivery date | Current date display. "Edit" → date input + time_window select + Save → calls `updateProjectDates` |
| Delivery actions | "Mark delivery sent" → confirm → `markDeliverySent`; "Create revision round" → `createRevisionRound` |
| Rounds list | Shows all rounds with status badges |

**`ProjectCleanupActions`** (inline modal):
- "Archive" button → modal shows project name + "Hides from the widget. Data and history are kept." → Archive/Cancel → `archiveProject` → `router.refresh()`
- "Delete" button → modal shows project name + "Removes all views, rounds, stage states, and history. Cannot be undone." → Delete/Cancel → `deleteProjectPermanently` → `router.push(afterDeleteHref)` or `router.refresh()`
- `afterDeleteHref="/admin/projects"` on detail page; not set on list page
- Errors from server actions are shown inside the modal

### `/admin/today` — Dashboard

Server component. 5 parallel queries:

1. **Due this week**: projects with `delivery_date` between today and +7 days, `status NOT IN ('delivered','archived')`
2. **Stages due today**: `view_stage_states` where `latest_eta_date = today AND status = 'in_progress'` (joined with project, view, user)
3. **Blocked**: `view_stage_states` where `status = 'blocked'` (joined with project, view, user)
4. **Waiting for feedback**: projects where `status = 'waiting_for_feedback'`
5. **Active revisions**: projects where `status = 'revision'`

Each section shows a count. Empty sections are hidden. If all empty: "All clear."

---

## 10. Known Invariants & Edge Cases

### Project lifecycle state machine
There is no enforced state machine. Status is set freely by admin via `updateProjectStatus` or implicitly by:
- `createProject` → `active`
- `markDeliverySent` → `waiting_for_feedback`
- `createRevisionRound` → `revision`
- `archiveProject` → `archived`

### Round number vs delivery count
- `current_round_number` advances only on `createRevisionRound` (incremented by 1)
- `delivery_count` advances on every `markDeliverySent` (including the initial delivery)
- Round 00 is the initial delivery; Round 01 is the first revision

### `ensureProjectWorkflow` idempotency
Safe to call multiple times. Uses UNIQUE constraint on `(delivery_round_id, project_view_id, stage)` to avoid duplicate inserts — BUT the current implementation checks for missing keys and only inserts missing ones, so it won't hit a constraint violation. If two concurrent calls race, the second will either find the rows already there or hit the unique constraint (which would surface as an error).

### `deleteProjectPermanently` event log race
The action logs a `project_archived` event first, then deletes all `project_events`. The pre-log is therefore always deleted. This is intentional (last-breath audit trail that is immediately cleaned up — of questionable value).

### `public_eta_date` column
The column still exists in the database (created in 001, supposed to be dropped in 010). The `/admin/projects/[id]` page server component still references `project.public_eta_date` in the 3-column info grid ("Public ETA" card). The TS type does not include this field (removed from Row). This will produce a TypeScript error (accessing property not in type) or a runtime `undefined`. **This is a bug in the detail page**.

### Widget project filter vs status
The widget server component uses an explicit `IN` list of allowed statuses rather than `.not('status', 'eq', 'archived')`. This means:
- `waiting_for_feedback` and `delivered` are intentionally excluded (no team work needed)
- Legacy status values (`waiting_for_info`, `ready_to_start`, `in_production`, `ready_to_deliver`, `not_started`, `in_progress`) are included — so old rows not yet migrated will still appear in the widget
- `revision` and `active` are the primary expected active states

### `blockStage` vs `unblockStage` signature difference
- `blockStage(projectId, roundId, viewIds: string[], stage, reason)` — takes an array of viewIds
- `unblockStage(projectId, roundId, viewId: string, stage)` — takes a single viewId

The admin unblock UI in `ProjectDetailClient` calls it per-state (one at a time), so this is consistent with use.

### `createRevisionRound` does not archive the old round
The previously active round stays with `status='active'`. After `createRevisionRound`, there are two rounds where `status='active'`. `ensureProjectWorkflow` uses `ORDER BY round_number DESC LIMIT 1` to pick the latest one, which will be the new revision round. This is correct in practice but means the old round is not formally closed.

### No client-side auth enforcement
Client components (`WidgetClient`, `ProjectDetailClient`) call server actions directly. The server actions always re-check auth + role. There is no client-side role guard beyond what the server page component renders.

### `block_reason` column
Added after migration 001 (not present in the initial schema). The TypeScript type includes it. Migration that added it is not listed here (likely 006 or 008).
