import type { StageStatus } from '@/lib/types/database'

const stageStyles: Record<StageStatus, string> = {
  not_started: 'bg-surface text-ink-3 border border-line',
  in_progress: 'bg-progress-bg text-progress-text',
  done:        'bg-done-bg text-done-text',
  blocked:     'bg-blocked-bg text-blocked-text',
  reopened:    'bg-reopened-bg text-reopened-text',
}

const stageLabels: Record<StageStatus, string> = {
  not_started: '—',
  in_progress: 'In progress',
  done:        'Done',
  blocked:     'Blocked',
  reopened:    'Reopened',
}

const projectStyles: Record<string, string> = {
  active:               'bg-progress-bg text-progress-text',
  waiting_for_feedback: 'bg-warn-bg text-warn-text',
  delivered:            'bg-done-bg text-done-text',
  revision:             'bg-reopened-bg text-reopened-text',
  archived:             'bg-surface text-ink-3 border border-line',
  // legacy — map to closest canonical style
  waiting_for_info:     'bg-progress-bg text-progress-text',
  ready_to_start:       'bg-progress-bg text-progress-text',
  in_production:        'bg-progress-bg text-progress-text',
  ready_to_deliver:     'bg-progress-bg text-progress-text',
  revision_in_progress: 'bg-reopened-bg text-reopened-text',
  not_started:          'bg-progress-bg text-progress-text',
  in_progress:          'bg-progress-bg text-progress-text',
  waiting_for_client:   'bg-warn-bg text-warn-text',
}

const projectLabels: Record<string, string> = {
  active:               'Active',
  waiting_for_feedback: 'Waiting for feedback',
  delivered:            'Delivered',
  revision:             'Revision',
  archived:             'Archived',
  // legacy
  waiting_for_info:     'Active',
  ready_to_start:       'Active',
  in_production:        'Active',
  ready_to_deliver:     'Active',
  revision_in_progress: 'Revision',
  not_started:          'Active',
  in_progress:          'Active',
  waiting_for_client:   'Waiting for feedback',
}

export function StageBadge({ status }: { status: StageStatus }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium ${stageStyles[status]}`}>
      {stageLabels[status]}
    </span>
  )
}

export function ProjectBadge({ status }: { status: string }) {
  const style = projectStyles[status] ?? 'bg-surface text-ink-3 border border-line'
  const label = projectLabels[status] ?? status
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium ${style}`}>
      {label}
    </span>
  )
}
