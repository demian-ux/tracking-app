import { createClient } from '@/lib/supabase/server'

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
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 150)

  return (
    <div>
      <h1 className="text-[15px] font-medium text-ink mb-6">Event log</h1>

      {all.length === 0 && (
        <div className="text-center py-16 text-ink-3 text-[13px]">No events yet.</div>
      )}

      <div className="bg-surface border border-line rounded-md overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-line bg-elevated">
              <th className="text-left px-4 py-2.5 text-[10px] tracking-[0.12em] uppercase text-ink-3">Time</th>
              <th className="text-left px-4 py-2.5 text-[10px] tracking-[0.12em] uppercase text-ink-3">Project</th>
              <th className="text-left px-4 py-2.5 text-[10px] tracking-[0.12em] uppercase text-ink-3">Event</th>
              <th className="text-left px-4 py-2.5 text-[10px] tracking-[0.12em] uppercase text-ink-3">Detail</th>
              <th className="text-left px-4 py-2.5 text-[10px] tracking-[0.12em] uppercase text-ink-3">By</th>
            </tr>
          </thead>
          <tbody>
            {all.map((event, i) => {
              const label = EVENT_LABELS[event.event_type] ?? event.event_type
              const detail = event.kind === 'stage'
                ? `${event.project_views?.label ?? ''} - ${event.stage.replace('_', ' ')}`
                : ''

              return (
                <tr key={`${event.kind}-${event.id}`} className={i > 0 ? 'border-t border-line' : ''}>
                  <td className="px-4 py-2.5 text-[11px] text-ink-3 tabular-nums whitespace-nowrap">
                    {new Date(event.created_at).toLocaleString('en-US', {
                      month: 'short', day: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </td>
                  <td className="px-4 py-2.5 text-[12px] text-ink-2">
                    {event.projects?.name ?? '-'}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      event.kind === 'stage'
                        ? 'bg-elevated text-ink-2'
                        : 'bg-progress-bg text-progress-text'
                    }`}>
                      {label}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-[11px] text-ink-3">{detail}</td>
                  <td className="px-4 py-2.5 text-[11px] text-ink-3">
                    {event.users?.name ?? '-'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
