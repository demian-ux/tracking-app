# ROADMAP.md — Oaki Studio Tracker

## Phase 1 — Foundation (Current)

### 1.1 Project Setup
- [x] Create SPEC.md, DATABASE.md, ARCHITECTURE.md, ROADMAP.md
- [x] Scaffold Next.js app (App Router, TypeScript, TailwindCSS)
- [ ] Configure Supabase project + environment variables (add real keys to .env.local)
- [ ] Set up Supabase Auth (email/password) — create users in Supabase dashboard

### 1.2 Database
- [x] Write SQL migrations (enums, tables, RLS, triggers, indexes)
- [x] Handwritten TypeScript types (lib/types/database.ts)
- [x] Seed development data script (supabase/seed.sql)

### 1.3 Auth + Routing
- [x] Login page (`/auth/login`)
- [x] Supabase Auth callback route
- [x] Proxy (middleware): session refresh + role-based route protection
- [x] Root redirect (admin → `/admin/projects`, team → `/app/widget`)

---

## Phase 2 — Team Widget

### 2.1 Widget Core (`/app/widget`)
- [x] Project selector dropdown (active projects only)
- [x] Project info display (delivery date, time window, current round, view count)
- [x] Stage selector dropdown
- [x] View multi-selector (with conflict detection)
- [x] Stage ETA form (date + time window)
- [x] "Start stage" button + server action
- [x] "Mark stage finished" button + server action
- [x] Stage order warnings (non-blocking)

---

## Phase 3 — Admin Backend

### 3.1 Project Management (`/admin/projects`)
- [x] Project list page (with status, delivery date, progress)
- [x] Create project form (name, client, delivery date/window, view count)
- [x] Auto-generate views + create Round 00 on project creation
- [x] Archive project action

### 3.2 Project Detail (`/admin/projects/[id]`)
- [x] Project overview (status, dates, progress %)
- [x] Edit delivery date / time window
- [x] Edit public ETA / time window
- [ ] Edit view count (adds/deactivates views) — not yet implemented
- [x] Round list with status
- [x] View-stage state grid for current round
- [x] Reopen stage action (action written, UI needs dedicated button)
- [x] "Mark delivery sent" action (with confirmation)
- [x] Create revision round action

### 3.3 Event Log (`/admin/events`)
- [x] Merged list of project_events + stage_events (100 most recent)
- [ ] Filter by project, event type, date range

---

## Phase 4 — Timeline

### 4.1 Timeline View (`/admin/timeline`)
- [x] Project list with per-view stage status grid
- [x] Delivery date display
- [x] ETA display per stage
- [x] Status color coding
- [x] Round status indicators
- [ ] Expandable rounds history (future enhancement)

---

## Phase 5 — Polish + Hardening

- [ ] Loading states and optimistic UI in widget
- [ ] Error boundaries and user-friendly error messages
- [ ] Mobile responsive layout for widget
- [ ] Empty states for all list views
- [ ] Confirmation dialogs for destructive actions
- [ ] Input validation on all forms

---

## Phase 6 — Client Portal (Future)

- [ ] Client auth (magic link or separate password)
- [ ] Client portal route (`/client/projects/[id]`)
- [ ] Progress display (% complete, no internal details)
- [ ] ETA display (public ETA only)
- [ ] Delivery status timeline
- [ ] Information received/completed status

---

## Not Planned (Out of Scope for Now)

- Email notifications
- AI intake parsing
- Slack integration
- Time tracking
- Profitability reports
- Custom stage types
- Advanced analytics
- Multi-workspace support
