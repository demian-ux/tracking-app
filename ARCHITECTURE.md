# ARCHITECTURE.md — Oaki Studio Tracker

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Styling | TailwindCSS |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| ORM | Supabase JS client (typed via generated types) |

---

## Directory Structure

```
tracking-app/
├── app/                          # Next.js App Router
│   ├── layout.tsx                # Root layout with auth context
│   ├── page.tsx                  # Root redirect
│   ├── auth/
│   │   ├── login/page.tsx
│   │   └── callback/route.ts     # Supabase OAuth callback
│   ├── app/
│   │   └── widget/page.tsx       # Team widget (protected: team_member+)
│   ├── admin/
│   │   ├── layout.tsx            # Admin guard
│   │   ├── projects/
│   │   │   ├── page.tsx          # Project list
│   │   │   ├── new/page.tsx      # Create project
│   │   │   └── [id]/page.tsx     # Project detail + round management
│   │   ├── timeline/page.tsx     # Timeline view
│   │   └── events/page.tsx       # Event log
│   └── client/
│       └── projects/[id]/page.tsx # Client portal (future)
├── components/
│   ├── ui/                       # Base UI components (Button, Input, Select…)
│   ├── widget/                   # Widget-specific components
│   │   ├── ProjectSelector.tsx
│   │   ├── StageSelector.tsx
│   │   ├── ViewSelector.tsx
│   │   ├── EtaForm.tsx
│   │   └── ActionButtons.tsx
│   ├── admin/                    # Admin-specific components
│   │   ├── ProjectForm.tsx
│   │   ├── RoundManager.tsx
│   │   ├── DeliveryAction.tsx
│   │   └── EventLog.tsx
│   └── timeline/
│       ├── TimelineView.tsx
│       └── TimelineRow.tsx
├── lib/
│   ├── supabase/
│   │   ├── client.ts             # Browser client
│   │   ├── server.ts             # Server client (RSC/route handlers)
│   │   └── middleware.ts         # Session refresh middleware
│   ├── types/
│   │   ├── database.ts           # Generated Supabase types
│   │   └── app.ts                # App-level types/interfaces
│   ├── actions/                  # Server Actions
│   │   ├── projects.ts
│   │   ├── stages.ts
│   │   ├── rounds.ts
│   │   └── delivery.ts
│   └── utils/
│       ├── progress.ts           # Progress calculation
│       └── formatting.ts         # Date/label formatting
├── middleware.ts                 # Auth + role routing
├── supabase/
│   ├── migrations/               # SQL migration files
│   └── seed.sql                  # Development seed data
└── public/
```

---

## Auth & Routing

### Middleware

`middleware.ts` runs on every request:
1. Refreshes Supabase session cookie
2. Redirects unauthenticated users to `/auth/login`
3. Guards `/admin/*` routes — redirects non-admins to `/app/widget`
4. Guards `/app/*` routes — only `team_member` and `admin` roles

### Role Check Flow

```
Request → middleware.ts
  → get session
  → get user role from users table
  → if /admin/* and role != admin → redirect /app/widget
  → if /app/* and not authenticated → redirect /auth/login
  → proceed
```

---

## Data Flow

### Server Components (RSC)

Used for:
- Initial data loading (project lists, round data, timeline)
- Pages that don't need real-time

### Server Actions

Used for all mutations:
- `createProject(data)` → insert + create views + create round 00 + log event
- `startStage(data)` → upsert view_stage_states + insert stage_events
- `finishStage(data)` → update view_stage_states + insert stage_events
- `markDeliverySent(roundId)` → update round + increment delivery_count + log event
- `createRevisionRound(projectId)` → insert new delivery_round + create view_stage_states

### Real-time (future)

Supabase Realtime subscriptions can be added to the widget for live status updates. Architecture supports this without changes — just add `supabase.channel()` subscriptions in the widget client component.

---

## Event-Driven Pattern

All significant actions produce immutable event records:

```
User action
  → Server Action
    → Mutation (view_stage_states / delivery_rounds / projects)
    → Event insert (stage_events / project_events)
    → Return updated state
```

Events are append-only and never deleted. This enables:
- Audit log (`/admin/events`)
- Timeline reconstruction
- Client portal progress history
- Future analytics

---

## Progress Calculation

```typescript
// lib/utils/progress.ts
function calculateProgress(viewStageStates: ViewStageState[]): number {
  const total = viewStageStates.length;
  const completed = viewStageStates.filter(s => s.status === 'done').length;
  return total === 0 ? 0 : Math.round((completed / total) * 100);
}
```

Calculated at query time, not stored. Derived from `view_stage_states` for current round.

---

## Conflict Detection (Concurrent View Lock)

Before allowing a team member to start a view+stage:

```sql
SELECT assigned_user_id
FROM view_stage_states
WHERE delivery_round_id = $1
  AND project_view_id = $2
  AND stage = $3
  AND status = 'in_progress'
  AND assigned_user_id != $currentUserId
```

If a row is returned → block with conflict warning (show who is working on it).

---

## Key Design Decisions

1. **No time tracking** — `started_at`/`completed_at` are timestamps for audit trail only, never displayed as "time spent"

2. **Non-blocking warnings** — stage order warnings are UI-only; no database enforcement allows real non-linear production

3. **Auto-generated views** — when `view_count` changes, views are added/deactivated. Old views are never hard-deleted to preserve event history

4. **Round 00 always exists** — when a project is created, Round 00 and its view_stage_states are created immediately

5. **Client portal separation** — client-facing data is derived at query time using RLS + filtered queries. No separate "public" copies of data

6. **Supabase types** — run `supabase gen types typescript` after migrations to keep `lib/types/database.ts` in sync

---

## Security Model

- All routes protected by middleware session check
- Admin routes additionally check `user.role === 'admin'`
- RLS policies enforce data isolation at the database level (defense in depth)
- Server Actions validate role before executing mutations
- No sensitive data (internal ETAs, team names) returned in client portal queries
