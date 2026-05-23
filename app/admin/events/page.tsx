import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/Badge'
import { PageHead } from '@/components/ui/PageHead'
import { EmptyState } from '@/components/ui/EmptyState'
import { STAGE_LABELS } from '@/lib/types/app'
import type { StageType } from '@/lib/types/database'

const EVENT_LABELS: Record<string, string> = {
  project_created: 'Project created',
  delivery_date_changed: 'Delivery date changed',
  public_eta_changed: 'Public ETA changed',
  view_count_changed: 'View count changed',
  delivery_marked_sent: 'Delivery sent',
  revision_round_created: 'Revision round created',
  project_archived: 'Project archived',
  information_received: 'Information received',
  information_completed: 'Information completed',
  project_status_changed: 'Project status changed',
  admin_review_approved: 'Admin review approved',
  stage_started: 'Stage started',
  stage_eta_changed: 'Stage ETA changed',
  stage_finished: 'Stage finished',
  stage_reopened: 'Stage reopened',
  stage_blocked: 'Stage blocked',
  stage_unblocked: 'Stage unblocked',
}

// Event type → status colour from the shared Badge map.
const EVENT_BADGE: Record<string, string> = {
  project_created: 'in_progress',
  stage_started: 'in_progress',
  stage_finished: 'done',
  delivery_marked_sent: 'done',
  admin_review_approved: 'done',
  information_completed: 'done',
  stage_blocked: 'blocked',
  stage_reopened: 'reopened',
  revision_round_created: 'reopened',
  project_archived: 'archived',
}

interface BaseEvent {
  id: string
  event_type: string
  created_at: string
  projects: { name: string } | null
  users: { name: string } | null
}

interface ProjectEventRow extends BaseEvent {
  kind: 'project'
  payload: unknown
}

interface StageEventRow extends BaseEvent {
  kind: 'stage'
  stage: string
  project_views: { label: string } | null
}

type EventRow = ProjectEventRow | StageEventRow

export default async function EventsPage() {
  const supabase = await createClient()

  const [{ data: projectEvents }, { data: stageEvents }] = await Promise.all([
    supabase
      .from('project_events')
      .select('id, event_type, created_at, payload, projects ( name ), users ( name )')
      .order('created_at', { ascending: false })
      .limit(100),

    supabase
      .from('stage_events')
      .select('id, event_type, stage, created_at, projects ( name ), project_views ( label ), users ( name )')
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  const all: EventRow[] = [
    ...((projectEvents ?? []) as unknown as Omit<ProjectEventRow, 'kind'>[]).map(e => ({ ...e, kind: 'project' as const })),
    ...((stageEvents ?? []) as unknown as Omit<StageEventRow, 'kind'>[]).map(e => ({ ...e, kind: 'stage' as const })),
  ]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 150)

  return (
    <div>
      <PageHead title="Events" sub={all.length > 0 ? `Last ${all.length}` : undefined} />

      {all.length === 0 ? (
        <EmptyState
          icon="inbox"
          title="No events yet"
          sub="Activity from the team will show up here as projects move."
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Project</th>
                <th>Event</th>
                <th>Detail</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {all.map(event => {
                const label = EVENT_LABELS[event.event_type] ?? event.event_type
                const detail =
                  event.kind === 'stage'
                    ? `${event.project_views?.label ?? ''} · ${STAGE_LABELS[event.stage as StageType] ?? event.stage}`
                    : ''
                return (
                  <tr key={`${event.kind}-${event.id}`}>
                    <td className="tabular-nums whitespace-nowrap text-ink-3">
                      {new Date(event.created_at).toLocaleString('en-US', {
                        month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td className="primary">{event.projects?.name ?? '—'}</td>
                    <td>
                      <Badge status={EVENT_BADGE[event.event_type] ?? 'not_started'} label={label} />
                    </td>
                    <td className="text-ink-3">{detail || '—'}</td>
                    <td className="text-ink-3">{event.users?.name ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
