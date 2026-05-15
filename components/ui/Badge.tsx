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

// Covers both new canonical statuses and legacy DB values
const projectStyles: Record<string, string> = {
  waiting_for_info:    'bg-surface text-ink-3 border border-line',
  ready_to_start:      'bg-elevated text-ink-2 border border-line-strong',
  in_production:       'bg-progress-bg text-progress-text',
  ready_to_deliver:    'bg-surface text-accent border border-accent/40',
  delivered:           'bg-done-bg text-done-text',
  waiting_for_feedback:'bg-warn-bg text-warn-text',
  revision_in_progress:'bg-reopened-bg text-reopened-text',
  archived:            'bg-surface text-ink-3 border border-line',
  // legacy
  not_started:         'bg-surface text-ink-3 border border-line',
  in_progress:         'bg-progress-bg text-progress-text',
  waiting_for_client:  'bg-warn-bg text-warn-text',
}

const projectLabels: Record<string, string> = {
  waiting_for_info:    'Waiting for info',
  ready_to_start:      'Ready to start',
  in_production:       'In production',
  ready_to_deliver:    'Ready to deliver',
  delivered:           'Delivered',
  waiting_for_feedback:'Waiting for feedback',
  revision_in_progress:'Revision',
  archived:            'Archived',
  // legacy
  not_started:         'Not started',
  in_progress:         'In progress',
  waiting_for_client:  'Waiting',
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
