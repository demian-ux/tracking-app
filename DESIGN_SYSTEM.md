# DESIGN_SYSTEM.md — Oaki Studio Tracker

## Philosophy

This is a desktop-first production tool for artists working on Windows 11 workstations with large monitors. It should feel like a premium internal instrument — not a SaaS product.

References: Linear, Notion dark mode, Arc Browser, Framer, high-end architecture studio software.

---

## Color Tokens

| Token | Hex | Usage |
|---|---|---|
| `canvas` | `#222222` | Root background |
| `surface` | `#2a2a2a` | Panels, cards, inputs |
| `elevated` | `#303030` | Hover states, dropdowns |
| `overlay` | `#383838` | Active/selected items |
| `line` | `#333333` | Default borders |
| `line-strong` | `#464646` | Visible dividers |
| `ink` | `#f0f0f0` | Primary text |
| `ink-2` | `#888888` | Secondary text, labels |
| `ink-3` | `#4a4a4a` | Disabled, very muted |
| `accent` | `#c6b193` | Brand warm gold — CTAs, active states |
| `accent-dim` | `#9e8c74` | Accent hover |

---

## Status Colors

| Status | Meaning |
|---|---|
| `not_started` | Neutral / canvas |
| `in_progress` | Blue tint |
| `done` | Green tint |
| `blocked` | Red tint |
| `reopened` | Amber tint |

All status colors are desaturated and dark-appropriate — never bright.

---

## Typography

- **Font**: Geist Sans
- **Micro label**: 11px · uppercase · `tracking-widest` · `text-ink-3` — used for section headers
- **Small**: 13px · `text-ink-2` — metadata, timestamps
- **Body**: 13px · `text-ink` — primary content
- **UI**: 13px · `text-ink` — inputs, selects, buttons
- **Heading**: 15px · medium weight · `text-ink`

No large headings. This is a dense production tool, not a marketing page.

---

## Spacing

Dense but not cramped. Key rhythm:
- Section gaps: 24px
- Item gaps: 8px
- Input padding: 8px 12px
- Panel padding: 16px or 20px

---

## Components

### Input / Select
- Background: `surface`
- Border: `line`
- Focus ring: `accent` / 1px
- Hover: `elevated`
- Text: `ink`
- Placeholder: `ink-3`
- Height: 36px
- Border radius: 6px

### Button — Primary
- Background: `accent`
- Text: `canvas` (dark on gold)
- Hover: `accent-dim`
- Height: 36px

### Button — Secondary
- Background: `surface`
- Border: `line-strong`
- Text: `ink`
- Hover: `elevated`

### Button — Ghost
- No background, no border
- Text: `ink-2`
- Hover: `text-ink`, `bg-elevated`

### View Toggle Button (widget)
- Idle: `bg-surface`, `border-line`, `text-ink-2`
- Active/selected: `bg-accent`, `text-canvas`
- Done: `bg-done-bg`, `text-done-text`, `border-done-text/20`
- In progress (mine): `border-accent/50`, `text-accent`
- In progress (other): `border-warn-text/30`, `text-ink-3`

### Progress Bar
- Track: `line-strong`
- Fill: `accent`
- Height: 2px (inline) or 3px (prominent)

### Badge
- Small pill: 10px text, tight padding
- Background from status color token

---

## Layout Shells

### Widget shell (`/app/widget`)
- Full viewport: `bg-canvas`
- Content column: `max-w-[420px]`, `mx-auto`, `pt-16 pb-8 px-6`
- Header: fixed top bar, `bg-canvas`, `border-b border-line`

### Admin shell (`/admin/*`)
- Top nav: `bg-canvas`, `border-b border-line`, sticky
- Content: `max-w-6xl mx-auto px-8 py-8`
- Tables preferred over card grids

---

## Widget Flow Layout

```
Header: OAKI STUDIO ————————————————— [user] [Admin →]

─ PROJECT ───────────────────────────────────────────
  [ Journey / Food Hall                           ▾ ]
  Jun 15 · EOD    Round 00    6 views
  ▓▓▓▓▓▓▓▒▒▒▒▒▒  33%

─ STAGE ─────────────────────────────────────────────
  [ Initial stage                                 ▾ ]

─ VIEWS ─────────────────────────────────────────────
  [ 01 ✓ ]  [ 02 ● ]  [ 03    ]  [ 04    ]
  [ 05    ]  [ 06    ]

─ ETA ───────────────────────────────────────────────
  [ Jun 10 ──────────── ]  [ EOD ▾ ]

  [ Start stage ]              [ Mark stage done ]
```

---

## Admin Layout

Single top nav. Tabs: Projects · Timeline · Events.

Tables over cards. Dense rows with hover highlight. Accent on active states.

---

## Timeline Proposal

Horizontal grid per project. Rows = views. Columns = stages.
Delivery date rendered as a vertical marker line.
Round tabs above grid to switch between Round 00 / Round 01.

---

## Anti-patterns

- No white backgrounds
- No light mode
- No floating action buttons
- No excessive rounded corners (use 6px max)
- No shadows (use borders instead)
- No emoji in UI
- No skeleton loaders (use instant data from RSC)
- No mobile breakpoints
