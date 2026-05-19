# Oaki Tracker — Codex Debug Guide

This document gives you everything you need to understand, navigate, and debug the Oaki Tracker app.

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2.6 — App Router, React 19 |
| Database | Supabase (PostgreSQL + Auth + RLS) |
| Language | TypeScript 5, strict |
| Styling | Tailwind CSS v4 with `@theme` custom tokens |
| Auth | Supabase Auth — SSR cookies via `@supabase/ssr` |

---

## Project Layout

```
app/
  app/
    widget/page.tsx          # Team widget — main working view
  admin/
    layout.tsx               # Admin auth gate (admin role required)
    today/page.tsx           # Today's blocked items + due stages
    projects/
      page.tsx               # Projects list
      [id]/page.tsx          # Project detail — stage grid, rounds
      new/page.tsx           # Create project
    clients/page.tsx
    timeline/page.tsx
    events/page.tsx
    integrity/page.tsx       # Data integrity checks (calls RPC)

components/
  widget/
    WidgetClient.tsx         # Core widget — all state, all actions
  admin/
    ProjectDetailClient.tsx  # Inline editing, status chips, stepper
  ui/
    Button.tsx               # Shared button with variants
    Badge.tsx                # Status badge pill
    ProgressBar.tsx
    ViewSwitcher.tsx         # Admin/Widget toggle
    AdminNavLink.tsx         # Active-aware nav link (client component)

lib/
  actions/
    stages.ts                # startStage, finishStage, blockStage, resetStage, undoStageAction, ensureProjectWorkflow
    auth.ts                  # requireWorker(), requireAdmin()
    projects.ts              # createProject, updateProject, archiveProject
    delivery.ts              # delivery actions
    clients.ts               # client CRUD
  types/
    database.ts              # Full DB type map — Row/Insert/Update per table
    app.ts                   # STAGE_ORDER, STAGE_LABELS, domain types
  utils/
    revalidate.ts            # revalidateProjectScreens(projectId)
    formatting.ts            # formatDelivery, date helpers
    ensure-profile.ts        # Upserts user row on first login
    progress.ts              # Progress % helpers
    rounds.ts                # Round utilities
  supabase/
    client.ts                # Browser Supabase client
    server.ts                # Server Supabase client (cookie-based)

supabase/migrations/         # Applied in order — source of truth for schema
```

---

## Data Model

The hierarchy is:

```
projects
  └─ project_views          (one per deliverable view, e.g. "View 01")
       └─ project_view_rounds  (one per delivery round for that view)
            └─ view_stage_states  (one per stage: initial / advanced / post_production)
```

### Key Tables

**projects**
- `id`, `name`, `status` (active | waiting_for_feedback | delivered | revision | archived)
- `delivery_date`, `delivery_time_window` (Midday | Afternoon | EOD)
- `view_count`, `current_round_number`, `delivery_count`

**project_views**
- `id`, `project_id`, `number` (1-based), `label`, `active` (bool), `current_round_number`

**project_view_rounds** ← added in migration 018
- `id`, `project_id`, `project_view_id`, `round_number`, `status` (active | delivered | revision_requested)
- Each view has its own independent round. Do NOT confuse with the old `delivery_rounds` table (dropped in 018).

**view_stage_states**
- `id`, `project_id`, `project_view_round_id`, `project_view_id`
- `stage` (initial | advanced | post_production)
- `status` (not_started | in_progress | done | blocked | reopened)
- `assigned_user_id`, `started_at`, `completed_at`
- `latest_eta_date`, `latest_eta_time_window`
- `block_reason`, `status_before_block`
- One row per (view_round, stage) — always exactly 3 per active round.

**stage_events** — append-only log
- `project_view_round_id`, `project_view_id`, `stage`, `event_type`, `actor_id`, `created_at`
- event_type: `stage_started | stage_eta_changed | stage_finished | stage_reopened | stage_blocked | stage_unblocked | stage_reset`

**users**
- `id` (matches `auth.uid()`), `name`, `email`, `role` (admin | team_member | client)

### Stage Order

```ts
STAGE_ORDER = ['initial', 'advanced', 'post_production']
```

Sequential enforcement: Initial must be `done` before Advanced can start; Advanced must be `done` before Post-prod can start. Admins bypass this.

---

## Critical Architecture Notes

### The per-view rounds migration (018)

Migration 018 replaced the old project-level `delivery_rounds` table with `project_view_rounds` — one round per view, not per project. **Any code referencing `delivery_rounds` or `delivery_round_id` is stale and will fail.**

The old foreign key `view_stage_states.delivery_round_id` was replaced by `view_stage_states.project_view_round_id`.

### Workflow initialization

`ensureProjectWorkflow(projectId)` in `lib/actions/stages.ts`:
- Fetches active views for the project
- Ensures each view has exactly one active `project_view_round`
- Ensures each active round has exactly 3 `view_stage_states` (one per stage)
- Creates missing rows automatically
- Called once on project selection in the widget, NOT after every action

### Supabase clients

- **Server** (`lib/supabase/server.ts`): used in server components, server actions, API routes. Cookie-based session.
- **Browser** (`lib/supabase/client.ts`): used in client components for real-time or direct reads. Do not use in server actions.

### Auth guards

```ts
// For admin + team_member access:
const auth = await requireWorker()
if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
const { user, profile, supabase } = auth.data

// For admin-only:
const auth = await requireAdmin()
const { user, supabase } = auth.data
```

Both functions call Supabase to verify the session and fetch the user's role. They return `{ error, data }`.

### Server actions

All server actions are in `lib/actions/`. They follow this pattern:

```ts
'use server'

export async function someAction(input: ...) {
  const auth = await requireWorker()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { user, supabase } = auth.data

  // ... do DB work ...

  revalidateProjectScreens(projectId)  // invalidates Next.js cache
  return { data: { updatedStates } }   // or return { error: 'message' }
}
```

`revalidateProjectScreens` calls `revalidatePath` on widget + admin project pages to trigger server re-renders where needed.

### Optimistic UI (WidgetClient)

The widget does NOT wait for the server before updating the UI:

```ts
// 1. Capture snapshot for rollback
const snapshot = selectedStates.map(s => ({ id: s.id, status: s.status, assigned_user_id: s.assigned_user_id }))

// 2. Update local state immediately (optimistic)
setStates(prev => prev.map(s => viewIds.includes(s.project_view_id) && s.stage === stage
  ? { ...s, status: 'in_progress', assigned_user_id: userId }
  : s
))
clearSelection()

// 3. Fire server action in background
startTransition(async () => {
  const result = await startStage(...)
  if (result.error) {
    rollback(snapshot)           // restore previous state
    setFeedback({ ok: false, msg: result.error })
  } else {
    mergeStates(result.data.updatedStates)  // reconcile with DB values
    armUndo(...)
  }
})
```

`rollback(snapshot)` restores `status`, `assigned_user_id`, `block_reason`, and ETA fields.

`mergeStates(updated)` merges server-returned rows into local state by `id`, updating timestamps etc.

### State lookup

`view_stage_states` are stored in a `Map<"viewId:stage", ViewState>` (`stateByViewStage`) built via `useMemo`. Use `getState(viewId, stage)` — O(1). Never scan `states.find()` in a loop.

### React.memo on view cells

`ViewCell` is a `memo()`-wrapped component. Its props must be stable for the memo to be effective:
- `onToggle` is `useCallback([], [])` — stable
- `state` comes from `stateByViewStage.get(...)` — same object reference if unchanged
- `selected`, `conflict`, `prereqBlocked` are booleans derived per-cell

---

## Revalidation vs Local State

After widget actions (start, finish, block, reset):
- Local state is updated optimistically — **do not call `router.refresh()`**
- `revalidateProjectScreens` is called server-side to invalidate admin pages
- `reloadStates()` exists but is only called on undo failure — not on normal success

After admin actions (project edits, status changes):
- These are server components — `revalidatePath` causes a server re-render
- Admin pages fetch fresh data on each render

---

## Tailwind Design Tokens

Defined in `app/globals.css` via `@theme`. Key tokens:

| Token | Color | Use |
|---|---|---|
| `bg-canvas` | #111111 | Page background |
| `bg-surface` | #1b1b1b | Cards, inputs |
| `bg-elevated` | #242424 | Dropdowns, hovers |
| `bg-overlay` | #2e2e2e | Selected nav, overlay |
| `text-ink` | #ececec | Primary text |
| `text-ink-2` | #767676 | Secondary text |
| `text-ink-3` | #3e3e3e | Muted / labels |
| `text-accent` | #c9a96d | Gold accent |
| `border-line` | #262626 | Default border |
| `border-line-strong` | #3a3a3a | Stronger border |
| `bg-done-bg` / `text-done-text` | Green tones | Done status |
| `bg-blocked-bg` / `text-blocked-text` | Red tones | Blocked status |
| `bg-warn-bg` / `text-warn-text` | Amber tones | Reopened / warnings |

---

## Common Bugs and Gotchas

### `delivery_rounds` does not exist
**Cause:** Code written before migration 018. The table was dropped.
**Fix:** Replace all references with `project_view_rounds`. The FK is `project_view_round_id`, not `delivery_round_id`.

### Widget shows "Could not load active rounds"
**Cause:** `ensureProjectWorkflow` failed. Common reasons:
- Project has no active views (`project_views.active = true` rows missing)
- The project status is `archived`
- Supabase RLS blocking the insert of new `project_view_rounds`

**Debug:** Open the dev panel at the bottom of the widget (visible in `NODE_ENV=development`). It shows `rounds`, `stage`, `filter`, `canStart`, `workflow error`.

### Stage action fails with "Stage data not found"
**Cause:** `view_stage_states` rows are missing for that view+round+stage. The round exists but was never fully initialized.
**Fix:** Call `ensureProjectWorkflow(projectId)` — it will create missing rows. Or run the integrity check at `/admin/integrity`.

### Optimistic update flickers back
**Cause:** Server action returned an error, triggering `rollback()`. Or `mergeStates()` received rows with different values than the optimistic update.
**Debug:** Check the `feedback` state rendered in the action bar — it will show the error message.

### `usePathname()` not available in server component
**Fix:** Wrap in a client component with `'use client'`. This is why `AdminNavLink` is a client component even though it's just a link.

### `revalidatePath` not invalidating widget
**Cause:** The widget route is `/app/widget`. Make sure `revalidateProjectScreens` includes that path.

### TypeScript: "Property does not exist on type `{ data: true }`"
**Cause:** Server action return type changed to `{ data: { updatedStates } }` but callsite still checks `result.data === true`.
**Fix:** Update callsites. Server actions now return `{ data: { updatedStates: ViewState[] } }` on success.

### RLS policy blocking insert
**Cause:** Supabase RLS is enabled on all tables. If a `SECURITY DEFINER` function is not used, inserts by the authenticated user must match the policy.
**Debug:** Check `002_rls.sql` for the relevant table's policies. The `requireWorker` guard in server actions ensures the request is authenticated but does not bypass RLS — the Supabase client in server actions uses the user's session.

---

## Migrations — Applied Order

```
001_initial_schema.sql       Base tables, indexes, enums
002_rls.sql                  Row Level Security policies
003–014                      Various fixes, additions
015_rpc_functions.sql        SQL RPC functions for workflow
016                          RLS policy changes
017_integrity_rpc.sql        Data integrity check RPC (now superseded)
018_per_view_rounds.sql      BREAKING: drops delivery_rounds, adds project_view_rounds
019_add_stage_reset_event.sql  Adds 'stage_reset' to stage_event_type enum
020_add_indexes.sql          Performance indexes on new schema
021_integrity_rpc_v2.sql     Rewrites integrity RPC for per-view-rounds schema
```

**Important:** Migrations 019, 020, 021 must be applied manually in Supabase SQL editor if not already done. The app will error without them.

---

## Running Locally

```bash
npm install
npm run dev        # http://localhost:3000
```

Environment variables required (`.env.local`):
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

First run: log in, then promote your account to admin in Supabase:
```sql
UPDATE public.users SET role = 'admin' WHERE email = 'your@email.com';
```

---

## Key Files for Debugging Specific Issues

| Problem area | File |
|---|---|
| Widget not loading stages | `lib/actions/stages.ts` → `ensureProjectWorkflow` |
| Start/Finish/Block/Reset broken | `lib/actions/stages.ts` → individual action functions |
| Widget UI not updating | `components/widget/WidgetClient.tsx` → handler functions |
| Admin project page | `app/admin/projects/[id]/page.tsx` + `components/admin/ProjectDetailClient.tsx` |
| Auth / role issues | `lib/actions/auth.ts` + `supabase/migrations/002_rls.sql` |
| Data corruption | `app/admin/integrity/page.tsx` + `supabase/migrations/021_integrity_rpc_v2.sql` |
| Schema reference | `lib/types/database.ts` |
| Domain constants | `lib/types/app.ts` |
