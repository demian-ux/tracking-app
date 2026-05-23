import { createClient } from '@/lib/supabase/server'
import { TimelineFilters } from '@/components/admin/TimelineFilters'
import { PageHead } from '@/components/ui/PageHead'

export default async function TimelinePage() {
  const supabase = await createClient()

  const [{ data: projects, error }, { data: clients }] = await Promise.all([
    supabase
      .from('projects')
      .select(`
        id, name, status, delivery_date, delivery_time_window,
        current_round_number,
        clients ( name ),
        project_views ( id, number, label, active ),
        project_view_rounds (
          id, round_number, status, project_view_id,
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
  ])

  return (
    <div>
      <PageHead title="Timeline" />

      {error && (
        <div className="mb-4 p-3 bg-blocked-bg border border-blocked-text/20 rounded-md">
          <p className="text-caption font-medium text-blocked-text">Query error</p>
          <p className="text-caption text-ink-2 font-mono mt-1">{error.message}</p>
        </div>
      )}

      <TimelineFilters
        projects={(projects ?? []) as unknown as Parameters<typeof TimelineFilters>[0]['projects']}
        clients={clients ?? []}
      />
    </div>
  )
}
