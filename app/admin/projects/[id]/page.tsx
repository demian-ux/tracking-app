import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'
import { Icon } from '@/components/ui/Icon'
import { SectionLabel } from '@/components/ui/SectionLabel'
import { PageHead } from '@/components/ui/PageHead'
import { calculateProgress } from '@/lib/utils/progress'
import { formatDelivery, roundLabel } from '@/lib/utils/formatting'
import { ProjectDetailClient } from '@/components/admin/ProjectDetailClient'
import { STAGE_LABELS, STAGE_ORDER } from '@/lib/types/app'
import { ProjectCleanupActions } from '@/components/admin/ProjectCleanupActions'

interface Props {
  params: Promise<{ id: string }>
}

export default async function ProjectDetailPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()

  // Three independent reads in parallel — used to be sequential
  const [projectResult, viewRoundsResult, viewsResult] = await Promise.all([
    supabase
      .from('projects')
      .select('*, clients ( id, name, contact_name, contact_email )')
      .eq('id', id)
      .single(),
    supabase
      .from('project_view_rounds')
      .select('*')
      .eq('project_id', id)
      .order('round_number'),
    supabase
      .from('project_views')
      .select('*')
      .eq('project_id', id)
      .eq('active', true)
      .order('number'),
  ])

  const project = projectResult.data
  if (!project) notFound()
  const viewRounds = viewRoundsResult.data
  const views = viewsResult.data

  const activeRoundIds = (viewRounds ?? []).filter(r => r.status === 'active').map(r => r.id)

  const { data: stageStates } = activeRoundIds.length > 0
    ? await supabase
        .from('view_stage_states')
        .select('*, users ( name )')
        .in('project_view_round_id', activeRoundIds)
    : { data: [] }

  // O(1) lookup maps for the table render below — replaces .find() per cell
  type StageState = NonNullable<typeof stageStates>[number]
  type ViewRound = NonNullable<typeof viewRounds>[number]
  const stateMap = new Map<string, StageState>()
  for (const s of stageStates ?? []) {
    stateMap.set(`${s.project_view_id}:${s.stage}`, s)
  }
  const activeRoundByView = new Map<string, ViewRound>()
  for (const r of viewRounds ?? []) {
    if (r.status === 'active') activeRoundByView.set(r.project_view_id, r)
  }

  const progress = calculateProgress(stageStates ?? [])

  return (
    <div>
      <Link
        href="/admin/projects"
        className="inline-flex items-center gap-1.5 text-caption text-ink-2 hover:text-ink mb-3 transition-colors"
      >
        <Icon name="arrow-left" size={12} />
        Projects
      </Link>

      <PageHead
        title={
          <>
            {project.clients && (
              <span className="font-normal text-ink-3">{project.clients.name} / </span>
            )}
            {project.name}
          </>
        }
        sub={`${roundLabel(project.current_round_number)} · ${project.view_count} views · ${project.delivery_count} ${project.delivery_count === 1 ? 'delivery' : 'deliveries'}`}
      />

      <ProjectDetailClient
        project={project}
        viewRounds={viewRounds ?? []}
        stageStates={stageStates ?? []}
        views={views ?? []}
        progress={progress}
      />

      {views && views.length > 0 && (
        <section className="mt-8">
          <SectionLabel count={views.length}>View stages</SectionLabel>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>View</th>
                  {STAGE_ORDER.map(stage => (
                    <th key={stage}>{STAGE_LABELS[stage]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {views.map(view => {
                  const activeRound = activeRoundByView.get(view.id)
                  return (
                    <tr key={view.id}>
                      <td className="primary">
                        <div>{view.label}</div>
                        {activeRound && (
                          <div className="text-caption text-ink-3">{roundLabel(activeRound.round_number)}</div>
                        )}
                      </td>
                      {STAGE_ORDER.map(stage => {
                        const state = stateMap.get(`${view.id}:${stage}`)
                        return (
                          <td key={stage}>
                            {state ? (
                              <div className="flex flex-col items-start gap-1">
                                <Badge status={state.status} />
                                {state.status === 'blocked' && state.block_reason && (
                                  <span className="text-caption text-blocked-text">{state.block_reason}</span>
                                )}
                                {state.users?.name && state.status !== 'done' && state.status !== 'not_started' && (
                                  <span className="text-caption text-ink-3">{state.users.name}</span>
                                )}
                                {state.latest_eta_date && state.status !== 'blocked' && state.status !== 'done' && (
                                  <span className="text-caption text-ink-3 tabular-nums">
                                    {formatDelivery(state.latest_eta_date, state.latest_eta_time_window)}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-ink-faint">—</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="mt-8">
        <SectionLabel>Project actions</SectionLabel>
        <ProjectCleanupActions
          projectId={project.id}
          projectName={project.name}
          viewCount={project.view_count}
          afterDeleteHref="/admin/projects"
          prominent
        />
      </section>
    </div>
  )
}
