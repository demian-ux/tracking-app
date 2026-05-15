// @ts-nocheck
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { ProjectBadge, StageBadge } from '@/components/ui/Badge'
import { formatDelivery, roundLabel } from '@/lib/utils/formatting'
import { STAGE_LABELS } from '@/lib/types/app'
import type { StageType } from '@/lib/types/database'

function SectionHeader({ children, count }: { children: React.ReactNode; count: number }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="text-[10px] tracking-[0.18em] uppercase text-ink-3">{children}</span>
      <span className="flex-1 border-t border-line" />
      <span className="text-[10px] text-ink-3 tabular-nums">{count}</span>
    </div>
  )
}

function ProjectRow({ project, href, meta }: { project: any; href: string; meta?: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between px-3 py-2.5 bg-surface border border-line rounded-md hover:border-line-strong hover:bg-elevated transition-colors"
    >
      <div className="min-w-0">
        <div className="text-[13px] text-ink truncate">
          {project.clients?.name && (
            <span className="text-ink-3">{project.clients.name} / </span>
          )}
          {project.name}
        </div>
        {meta && <div className="mt-0.5">{meta}</div>}
      </div>
      <ProjectBadge status={project.status} />
    </Link>
  )
}

export default async function TodayPage() {
  const supabase = await createClient()
  const today = new Date().toISOString().split('T')[0]
  const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const [
    { data: dueSoonProjects },
    { data: stagesToday },
    { data: readyProjects },
    { data: blockedStates },
    { data: feedbackProjects },
    { data: revisionProjects },
  ] = await Promise.all([
    // Due within 7 days, not done
    supabase
      .from('projects')
      .select('id, name, status, delivery_date, delivery_time_window, clients ( name )')
      .lte('delivery_date', in7Days)
      .gte('delivery_date', today)
      .not('status', 'in', '("delivered","archived")')
      .order('delivery_date'),

    // Stages with ETA today, in_progress
    supabase
      .from('view_stage_states')
      .select(`
        id, stage, status, latest_eta_date, latest_eta_time_window, block_reason,
        project_views ( id, label ),
        projects ( id, name, clients ( name ) ),
        users ( name )
      `)
      .eq('latest_eta_date', today)
      .eq('status', 'in_progress')
      .order('latest_eta_date'),

    // Ready to deliver (round in ready_for_admin_review OR project status = ready_to_deliver)
    supabase
      .from('projects')
      .select(`
        id, name, status, delivery_date, delivery_time_window,
        current_round_number, clients ( name ),
        delivery_rounds ( id, round_number, status )
      `)
      .eq('status', 'ready_to_deliver')
      .order('name'),

    // Blocked stages
    supabase
      .from('view_stage_states')
      .select(`
        id, stage, status, block_reason,
        project_views ( id, label ),
        projects ( id, name, clients ( name ) ),
        users ( name )
      `)
      .eq('status', 'blocked')
      .order('updated_at', { ascending: false }),

    // Waiting for client feedback
    supabase
      .from('projects')
      .select('id, name, status, delivery_date, delivery_time_window, clients ( name )')
      .eq('status', 'waiting_for_feedback')
      .order('name'),

    // Active revisions
    supabase
      .from('projects')
      .select('id, name, status, current_round_number, delivery_date, delivery_time_window, clients ( name )')
      .eq('status', 'revision_in_progress')
      .order('name'),
  ])

  const totalActionable =
    (readyProjects?.length ?? 0) +
    (blockedStates?.length ?? 0)

  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })

  return (
    <div className="space-y-10">
      <div className="flex items-baseline justify-between">
        <h1 className="text-[15px] font-medium text-ink">Today</h1>
        <span className="text-[11px] text-ink-3">{dateStr}</span>
      </div>

      {/* Ready to deliver — highest priority */}
      {(readyProjects?.length ?? 0) > 0 && (
        <section>
          <SectionHeader count={readyProjects!.length}>Ready to deliver</SectionHeader>
          <div className="space-y-1.5">
            {readyProjects!.map((p: any) => {
              const activeRound = p.delivery_rounds?.find((r: any) => r.status === 'ready_for_admin_review')
              return (
                <div key={p.id} className="flex items-center justify-between px-3 py-2.5 bg-surface border border-accent/30 rounded-md">
                  <div className="min-w-0">
                    <div className="text-[13px] text-ink truncate">
                      {p.clients?.name && <span className="text-ink-3">{p.clients.name} / </span>}
                      {p.name}
                    </div>
                    <div className="text-[11px] text-ink-3 mt-0.5">
                      {roundLabel(p.current_round_number)} · {formatDelivery(p.delivery_date, p.delivery_time_window)}
                    </div>
                  </div>
                  <Link
                    href={`/admin/projects/${p.id}`}
                    className="ml-4 shrink-0 px-3 py-1 bg-accent text-canvas text-[11px] font-medium rounded hover:bg-accent-dim transition-colors"
                  >
                    Review →
                  </Link>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Blocked stages */}
      {(blockedStates?.length ?? 0) > 0 && (
        <section>
          <SectionHeader count={blockedStates!.length}>Blocked</SectionHeader>
          <div className="space-y-1.5">
            {blockedStates!.map((s: any) => (
              <div key={s.id} className="flex items-center justify-between px-3 py-2.5 bg-blocked-bg border border-blocked-text/20 rounded-md">
                <div className="min-w-0">
                  <div className="text-[13px] text-ink truncate">
                    {s.projects?.clients?.name && (
                      <span className="text-ink-3">{s.projects.clients.name} / </span>
                    )}
                    {s.projects?.name}
                    <span className="text-ink-3 mx-1.5">·</span>
                    <span className="text-ink-2">{s.project_views?.label}</span>
                    <span className="text-ink-3 mx-1.5">·</span>
                    <span className="text-ink-2">{STAGE_LABELS[s.stage as StageType]}</span>
                  </div>
                  {s.block_reason && (
                    <div className="text-[11px] text-blocked-text mt-0.5">{s.block_reason}</div>
                  )}
                </div>
                <Link
                  href={`/admin/projects/${s.projects?.id}`}
                  className="ml-4 shrink-0 text-[11px] text-ink-3 hover:text-ink-2 transition-colors"
                >
                  Unblock →
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Stages due today */}
      {(stagesToday?.length ?? 0) > 0 && (
        <section>
          <SectionHeader count={stagesToday!.length}>Stages due today</SectionHeader>
          <div className="bg-surface border border-line rounded-md overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line bg-elevated">
                  <th className="text-left px-3 py-2 text-[10px] tracking-[0.12em] uppercase text-ink-3">Project</th>
                  <th className="text-left px-3 py-2 text-[10px] tracking-[0.12em] uppercase text-ink-3">View</th>
                  <th className="text-left px-3 py-2 text-[10px] tracking-[0.12em] uppercase text-ink-3">Stage</th>
                  <th className="text-left px-3 py-2 text-[10px] tracking-[0.12em] uppercase text-ink-3">ETA</th>
                  <th className="text-left px-3 py-2 text-[10px] tracking-[0.12em] uppercase text-ink-3">Who</th>
                </tr>
              </thead>
              <tbody>
                {stagesToday!.map((s: any, i: number) => (
                  <tr key={s.id} className={i > 0 ? 'border-t border-line' : ''}>
                    <td className="px-3 py-2.5">
                      <Link href={`/admin/projects/${s.projects?.id}`} className="text-[12px] text-ink hover:text-accent transition-colors">
                        {s.projects?.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-[12px] text-ink-2">{s.project_views?.label}</td>
                    <td className="px-3 py-2.5">
                      <StageBadge status={s.status} />
                      <span className="ml-1.5 text-[11px] text-ink-3">{STAGE_LABELS[s.stage as StageType]}</span>
                    </td>
                    <td className="px-3 py-2.5 text-[11px] text-ink-2 tabular-nums">
                      {formatDelivery(s.latest_eta_date, s.latest_eta_time_window)}
                    </td>
                    <td className="px-3 py-2.5 text-[11px] text-ink-3">{s.users?.name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Due this week */}
      {(dueSoonProjects?.length ?? 0) > 0 && (
        <section>
          <SectionHeader count={dueSoonProjects!.length}>Due this week</SectionHeader>
          <div className="space-y-1.5">
            {dueSoonProjects!.map((p: any) => (
              <ProjectRow
                key={p.id}
                project={p}
                href={`/admin/projects/${p.id}`}
                meta={
                  <span className="text-[11px] text-ink-3">
                    {formatDelivery(p.delivery_date, p.delivery_time_window)}
                  </span>
                }
              />
            ))}
          </div>
        </section>
      )}

      {/* Waiting for feedback */}
      {(feedbackProjects?.length ?? 0) > 0 && (
        <section>
          <SectionHeader count={feedbackProjects!.length}>Waiting for feedback</SectionHeader>
          <div className="space-y-1.5">
            {feedbackProjects!.map((p: any) => (
              <ProjectRow
                key={p.id}
                project={p}
                href={`/admin/projects/${p.id}`}
                meta={
                  <span className="text-[11px] text-ink-3">
                    {formatDelivery(p.delivery_date, p.delivery_time_window)}
                  </span>
                }
              />
            ))}
          </div>
        </section>
      )}

      {/* Active revisions */}
      {(revisionProjects?.length ?? 0) > 0 && (
        <section>
          <SectionHeader count={revisionProjects!.length}>Active revisions</SectionHeader>
          <div className="space-y-1.5">
            {revisionProjects!.map((p: any) => (
              <ProjectRow
                key={p.id}
                project={p}
                href={`/admin/projects/${p.id}`}
                meta={
                  <span className="text-[11px] text-ink-3">
                    {roundLabel(p.current_round_number)}
                  </span>
                }
              />
            ))}
          </div>
        </section>
      )}

      {/* All quiet */}
      {totalActionable === 0 &&
        (stagesToday?.length ?? 0) === 0 &&
        (dueSoonProjects?.length ?? 0) === 0 &&
        (feedbackProjects?.length ?? 0) === 0 &&
        (revisionProjects?.length ?? 0) === 0 && (
          <div className="text-center py-20 text-ink-3 text-[13px]">All clear.</div>
        )}
    </div>
  )
}
