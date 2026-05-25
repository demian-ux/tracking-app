import { createClient } from '@/lib/supabase/server'
import { TimelineFilters } from '@/components/admin/TimelineFilters'
import { DeliveriesHistory, type DeliveryGroup } from '@/components/admin/DeliveriesHistory'
import { PageHead } from '@/components/ui/PageHead'

interface DeliveredRoundRow {
  id: string
  delivered_at: string
  round_number: number
  project_view_id: string
  project_id: string
  project_views: { label: string } | null
  projects: { name: string; clients: { name: string } | null } | null
}

export default async function TimelinePage() {
  const supabase = await createClient()

  const [{ data: projects, error }, { data: clients }, { data: deliveredRounds }] = await Promise.all([
    supabase
      .from('projects')
      .select(`
        id, name, status, delivery_date, delivery_time_window,
        clients ( name ),
        project_views ( id, number, label, active ),
        project_view_rounds (
          id, round_number, status, project_view_id, delivered_at,
          view_stage_states (
            id, project_view_id, stage, status,
            latest_eta_date, latest_eta_time_window
          )
        )
      `)
      .not('status', 'eq', 'archived')
      .order('name'),
    supabase
      .from('clients')
      .select('id, name')
      .order('name'),
    supabase
      .from('project_view_rounds')
      .select(`
        id, delivered_at, round_number, project_view_id, project_id,
        project_views ( label ),
        projects ( name, clients ( name ) )
      `)
      .eq('status', 'delivered')
      .not('delivered_at', 'is', null)
      .order('delivered_at', { ascending: false })
      .limit(200),
  ])

  // Group delivered rounds by (project_id, delivered_at) — these come from a single
  // markDeliverySent call, so we want to undo them together.
  const rows = (deliveredRounds ?? []) as unknown as DeliveredRoundRow[]
  const groupMap = new Map<string, DeliveryGroup>()
  for (const r of rows) {
    if (!r.delivered_at || !r.projects) continue
    const key = `${r.project_id}::${r.delivered_at}`
    const existing = groupMap.get(key)
    if (existing) {
      existing.views.push({ id: r.project_view_id, label: r.project_views?.label ?? '?', roundNumber: r.round_number })
    } else {
      groupMap.set(key, {
        projectId: r.project_id,
        deliveredAt: r.delivered_at,
        projectName: r.projects.name,
        clientName: r.projects.clients?.name ?? null,
        views: [{ id: r.project_view_id, label: r.project_views?.label ?? '?', roundNumber: r.round_number }],
      })
    }
  }
  const deliveryGroups = Array.from(groupMap.values()).sort((a, b) =>
    a.deliveredAt < b.deliveredAt ? 1 : a.deliveredAt > b.deliveredAt ? -1 : 0
  )

  return (
    <div>
      <PageHead title="Timeline" />

      {error && (
        <div className="mb-4 p-3 bg-blocked-bg border border-blocked-text/20 rounded-md">
          <p className="text-caption font-medium text-blocked-text">Query error</p>
          <p className="text-caption text-ink-2 font-mono mt-1">{error.message}</p>
        </div>
      )}

      <DeliveriesHistory groups={deliveryGroups} />

      <TimelineFilters
        projects={(projects ?? []) as unknown as Parameters<typeof TimelineFilters>[0]['projects']}
        clients={clients ?? []}
      />
    </div>
  )
}
