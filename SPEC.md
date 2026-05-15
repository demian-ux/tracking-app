# SPEC.md — Oaki Studio Project Progress Tracker

## Product Overview

Internal web app for Oaki Studio to track project progress across the production pipeline. This is a project progress tracker, not a time tracker or PM tool.

**Core goal:** Team members can update work status in under 20 seconds. No long forms. No timers. No mandatory notes.

---

## User Roles

### Admin
- Demian, Diego
- Full access: create/archive projects, manage delivery rounds, mark deliveries sent, edit all dates/ETAs, access admin backend, timeline, event history

### Team Member
- Can: select project, see delivery date and current round, select stage and views, set stage ETA, start/finish stages
- Cannot: change project delivery date, public ETA, view count, mark delivery sent, create rounds, access admin backend

### Client (future)
- Read-only portal showing: information received/completed status, team started date, total progress %, estimated delivery, delivered status
- Cannot see: internal stages, view-level data, team names, internal notes, admin history

---

## Core Structure

```
Project
└── Delivery Round (00, 01, 02…)
    └── View (View 01, View 02…)
        └── Stage (Initial / Advanced / Post-production)
```

---

## Delivery Rounds

- Round 00 = first delivery
- Round 01 = first revision delivery
- Round 02 = second revision delivery
- A delivery is counted ONLY when admin clicks "Mark delivery sent" — NOT when post-production finishes

---

## Stages

All projects use 3 fixed stages (no custom stages in v1):
1. Initial stage
2. Advanced stage
3. Post-production

**Warnings (non-blocking):**
- Advanced stage warns if Initial is incomplete
- Post-production warns if Advanced is incomplete

---

## Views

- Admins set number of views per project
- System auto-generates labels: View 01, View 02, …

---

## Stage Statuses

`not_started` | `in_progress` | `done` | `blocked` | `reopened`

---

## Project Statuses

`not_started` | `in_progress` | `waiting_for_client` | `ready_to_deliver` | `delivered` | `revision_in_progress` | `archived`

---

## Time Window Options

`Midday` | `Afternoon` | `EOD`

---

## Progress Calculation (v1)

```
progress = completed_view_stages / total_view_stages

total = view_count × 3 (stages)
```

Example: 6 views × 3 stages = 18 units. 9 done = 50%.

---

## Concurrent Work Rules

- Multiple team members CAN work on same project + stage
- Multiple team members CANNOT work on same view + stage simultaneously
- Example allowed: User A → View 01 / Initial, User B → View 02 / Initial
- Example blocked: User A → View 01 / Initial, User B → View 01 / Initial

---

## Team Widget (`/app/widget`)

Flow:
1. Select Project (dropdown, active projects only)
2. Select Stage (dropdown: Initial / Advanced / Post-production)
3. Select Views (multi-select, conflict-checked)
4. Set Stage ETA (date + time window)
5. Click "Start stage" → creates stage_started event
6. Click "Mark stage finished" → creates stage_finished event

Widget shows: project delivery date, delivery time window, current round, total views.

---

## Admin Backend

- `/admin/projects` — list, create, archive projects
- `/admin/projects/[id]` — project detail, round management, delivery actions
- `/admin/timeline` — visual timeline (lightweight Gantt-style)
- `/admin/events` — audit event log

---

## Mark Delivery Sent

When admin clicks "Mark delivery sent":
1. Confirm action
2. Increment delivery_count on project
3. Mark current delivery_round as delivered
4. Log project_event: delivery_marked_sent
5. Optionally create next round later if revisions requested

---

## UI Direction

- Minimal, clean, modern, fast, focused
- Think: Linear, Notion, modern SaaS
- Soft borders, neutral colors, strong spacing, readable typography
- Responsive layout
- No enterprise PM complexity

---

## MVP Scope (Build Now)

- Authentication + role system
- Team widget
- Admin project management
- Admin timeline
- Delivery rounds
- View-stage tracking
- Delivery counter
- Stage ETA + project ETA
- Progress calculation
- Event logging

## Not in MVP (Build Later)

- Email integration
- AI intake parsing
- Slack notifications
- Time tracking
- Profitability reports
- PM dashboard
- Custom stages
- Advanced analytics
- Client portal
