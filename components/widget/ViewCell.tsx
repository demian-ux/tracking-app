import { memo } from 'react'
import type { StageType, TimeWindow } from '@/lib/types/database'
import { Icon } from '@/components/ui/Icon'

export interface ViewState {
  id: string
  project_view_id: string
  stage: StageType
  status: string
  assigned_user_id: string | null
  latest_eta_date: string | null
  latest_eta_time_window: TimeWindow | null
  block_reason: string | null
}

export interface View {
  id: string
  number: number
  label: string
}

interface ViewCellProps {
  view: View
  state: ViewState | undefined
  selected: boolean
  conflict: boolean
  prereqBlocked: boolean
  prevStageName: string | null
  userId: string
  assignee: { name: string } | null
  pending: boolean
  onToggle: (viewId: string) => void
}

function initials(name: string): string {
  return name.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

export const ViewCell = memo(function ViewCell({
  view, state, selected, conflict, prereqBlocked, prevStageName, userId, assignee, pending, onToggle,
}: ViewCellProps) {
  const isDone = state?.status === 'done'
  const isMine = state?.status === 'in_progress' && state.assigned_user_id === userId
  const isOther = state?.status === 'in_progress' && state.assigned_user_id !== userId
  const isBlocked = state?.status === 'blocked'
  const isReopened = state?.status === 'reopened'
  const showAvatar = (isMine || isOther) && assignee && !selected

  const statusLine = prereqBlocked
    ? (prevStageName ? `Finish ${prevStageName} first` : 'Prerequisite incomplete')
    : isDone ? 'Done'
    : isMine ? 'In progress · you'
    : isOther ? `In progress · ${assignee?.name?.split(' ')[0] ?? 'other'}`
    : isBlocked ? (state?.block_reason ?? 'Blocked')
    : isReopened ? 'Reopened'
    : 'Not started'

  const stateClass = selected
    ? 'bg-accent text-canvas border-accent shadow-[0_0_0_1px_var(--color-accent),0_4px_16px_-4px_var(--color-accent-glow)]'
    : conflict
      ? 'bg-blocked-bg text-blocked-text border-blocked-text animate-shake'
      : prereqBlocked
        ? 'bg-canvas text-ink-faint border-line border-dashed cursor-not-allowed'
        : isDone
          ? 'bg-done-bg text-done-text border-done-text/25'
          : isMine
            ? 'bg-surface text-accent border-accent/45'
            : isBlocked
              ? 'bg-blocked-bg text-blocked-text border-blocked-text/30'
              : isReopened
                ? 'bg-reopened-bg text-reopened-text border-reopened-text/35'
                : isOther
                  ? 'bg-surface text-warn-text border-warn-text/35'
                  : 'bg-surface text-ink-2 border-line hover:border-line-strong hover:text-ink'

  const glyph = !selected && (
    isDone ? <Icon name="check" size={12} /> :
    isBlocked ? <Icon name="block" size={12} /> :
    isReopened ? <Icon name="rotate" size={12} /> :
    prereqBlocked ? <span className="text-[10px] leading-none text-ink-faint">—</span> :
    null
  )

  return (
    <button
      type="button"
      onClick={() => !prereqBlocked && onToggle(view.id)}
      disabled={prereqBlocked}
      title={statusLine}
      aria-label={`${view.label} — ${statusLine}`}
      className={[
        'relative h-11 flex items-center justify-center rounded-sm border',
        'text-sm font-semibold tabular-nums select-none',
        'transition-colors duration-100 ease-out',
        'focus-visible:z-10',
        pending ? 'animate-pulse' : '',
        stateClass,
      ].filter(Boolean).join(' ')}
    >
      {glyph && (
        <span className="absolute top-1 left-1 flex items-center justify-center w-3 h-3">
          {glyph}
        </span>
      )}
      <span className="leading-none">{String(view.number).padStart(2, '0')}</span>
      {showAvatar && assignee && (
        <span
          className={[
            'absolute -top-1.5 -right-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full',
            'text-[8px] font-bold leading-none border-2 border-canvas',
            isMine ? 'bg-accent text-canvas' : 'bg-warn-text text-canvas',
          ].join(' ')}
        >
          {initials(assignee.name)}
        </span>
      )}
    </button>
  )
})
