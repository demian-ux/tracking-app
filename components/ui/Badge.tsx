const styles: Record<string, string> = {
  not_started:          'bg-overlay/60 text-ink-3 border border-line',
  in_progress:          'bg-progress-bg text-progress-text',
  done:                 'bg-done-bg text-done-text',
  blocked:              'bg-blocked-bg text-blocked-text',
  reopened:             'bg-reopened-bg text-reopened-text',
  active:               'bg-progress-bg text-progress-text',
  waiting_for_feedback: 'bg-warn-bg text-warn-text',
  delivered:            'bg-done-bg text-done-text',
  revision:             'bg-reopened-bg text-reopened-text',
  archived:             'bg-overlay/60 text-ink-3 border border-line',
  // legacy project statuses — map to closest canonical style
  waiting_for_info:     'bg-progress-bg text-progress-text',
  ready_to_start:       'bg-progress-bg text-progress-text',
  in_production:        'bg-progress-bg text-progress-text',
  ready_to_deliver:     'bg-progress-bg text-progress-text',
  revision_in_progress: 'bg-reopened-bg text-reopened-text',
  waiting_for_client:   'bg-warn-bg text-warn-text',
}

const labels: Record<string, string> = {
  not_started:          'Not started',
  in_progress:          'In progress',
  done:                 'Done',
  blocked:              'Blocked',
  reopened:             'Reopened',
  active:               'Active',
  waiting_for_feedback: 'Waiting',
  delivered:            'Delivered',
  revision:             'Revision',
  archived:             'Archived',
  waiting_for_info:     'Active',
  ready_to_start:       'Active',
  in_production:        'Active',
  ready_to_deliver:     'Active',
  revision_in_progress: 'Revision',
  waiting_for_client:   'Waiting',
}

const fallback = 'bg-overlay/60 text-ink-3 border border-line'

interface BadgeProps {
  status: string
  label?: string
  dot?: boolean
}

/** One badge for stage status, project status, and event type. */
export function Badge({ status, label, dot = false }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex w-fit items-center gap-1.5 px-2 py-0.5 rounded-full',
        'text-[10px] font-semibold tracking-[0.01em] whitespace-nowrap',
        styles[status] ?? fallback,
      ].join(' ')}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />}
      {label ?? labels[status] ?? status}
    </span>
  )
}
