import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ProjectBadge, StageBadge } from '@/components/ui/Badge'
import { ProgressBar } from '@/components/ui/ProgressBar'
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

  const { data: project } = await supabase
    .from('projects')
    .select('*, clients ( id, name, contact_name, contact_email )')
    .eq('id', id)
    .single()

  if (!project) notFound()

  const { data: viewRounds } = await supabase
    .from('project_view_rounds')
    .select('*')
    .eq('project_id', id)
    .order('round_number')

  const { data: views } = await supabase
    .from('project_views')
    .select('*')
    .eq('project_id', id)
    .eq('active', true)
    .order('number')

  const activeRoundIds = (viewRounds ?? []).filter(r => r.status === 'active').map(r => r.id)

  const { data: stageStates } = activeRoundIds.length > 0
    ? await supabase
        .from('view_stage_states')
        .select('*, users ( name )')
        .in('project_view_round_id', activeRoundIds)
    : { data: [] }

  const progress = calculateProgress(stageStates ?? [])

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            {project.clients && (
              <span className="text-[13px] text-ink-3">{project.clients.name} /</span>
            )}
            <h1 className="text-[15px] font-medium text-ink">{project.name}</h1>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-ink-2">
            <ProjectBadge status={project.status} />
            <span className="text-ink-3">-</span>
            <span>{roundLabel(project.current_round_number)}</span>
            <span className="text-ink-3">-</span>
            <span>{project.view_count} views</span>
            <span className="text-ink-3">-</span>
            <span>{project.delivery_count} deliveries</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ProjectCleanupActions
            projectId={project.id}
            projectName={project.name}
            viewCount={project.view_count}
            afterDeleteHref="/admin/projects"
          />
          <Link href="/admin/projects" className="text-[12px] text-ink-3 hover:text-ink-2 transition-colors">
            &lt;- Back
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-surface border border-line rounded-md p-4">
          <div className="text-[10px] tracking-[0.12em] uppercase text-ink-3 mb-2">Delivery</div>
          <div className="text-[13px] text-ink">
            {formatDelivery(project.delivery_date, project.delivery_time_window)}
          </div>
        </div>
        <div className="bg-surface border border-line rounded-md p-4">
          <div className="text-[10px] tracking-[0.12em] uppercase text-ink-3 mb-2">Progress</div>
          <div className="mt-1">
            <ProgressBar value={progress} />
          </div>
        </div>
      </div>

      <ProjectDetailClient
        project={project}
        viewRounds={viewRounds ?? []}
        stageStates={stageStates ?? []}
        views={views ?? []}
      />

      {views && views.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[11px] tracking-[0.12em] uppercase text-ink-3">
              View stages
            </h2>
          </div>

          <div className="bg-surface border border-line rounded-md overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <th className="text-left px-4 py-2.5 text-[10px] tracking-[0.12em] uppercase text-ink-3 w-24">View</th>
                  {STAGE_ORDER.map(stage => (
                    <th key={stage} className="text-left px-4 py-2.5 text-[10px] tracking-[0.12em] uppercase text-ink-3">
                      {STAGE_LABELS[stage]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {views.map((view, i) => {
                  // Find the active round for this view
                  const activeRound = (viewRounds ?? []).find(
                    r => r.project_view_id === view.id && r.status === 'active'
                  )
                  return (
                    <tr key={view.id} className={i > 0 ? 'border-t border-line' : ''}>
                      <td className="px-4 py-2.5">
                        <div className="text-[12px] font-medium text-ink-2">{view.label}</div>
                        {activeRound && (
                          <div className="text-[10px] text-ink-3">{roundLabel(activeRound.round_number)}</div>
                        )}
                      </td>
                      {STAGE_ORDER.map(stage => {
                        const state = (stageStates ?? []).find(
                          s => s.project_view_id === view.id && s.stage === stage
                        )
                        return (
                          <td key={stage} className="px-4 py-2.5">
                            {state ? (
                              <div>
                                <StageBadge status={state.status} />
                                {state.status === 'blocked' && state.block_reason && (
                                  <div className="text-[10px] text-blocked-text mt-0.5">{state.block_reason}</div>
                                )}
                                {state.users?.name && state.status !== 'done' && state.status !== 'not_started' && (
                                  <div className="text-[10px] text-ink-3 mt-0.5">{state.users.name}</div>
                                )}
                                {state.latest_eta_date && state.status !== 'blocked' && state.status !== 'done' && (
                                  <div className="text-[10px] text-ink-3 mt-0.5">
                                    {formatDelivery(state.latest_eta_date, state.latest_eta_time_window)}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-[11px] text-ink-3">—</span>
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
        </div>
      )}
    </div>
  )
}
