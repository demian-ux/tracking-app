import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { ProjectBadge, StageBadge } from '@/components/ui/Badge'
import { formatDelivery, roundLabel } from '@/lib/utils/formatting'
import { STAGE_LABELS } from '@/lib/types/app'
import type { ProjectStatus, StageStatus, StageType, TimeWindow } from '@/lib/types/database'

interface ProjectSummary {
  id: string
  name: string
  status: ProjectStatus
  delivery_date: string | null
  delivery_time_window: TimeWindow | null
  current_round_number?: number
  clients: { name: string } | null
}

interface StageSummary {
  id: string
  stage: StageType
  status: StageStatus
  latest_eta_date?: string | null
  latest_eta_time_window?: TimeWindow | null
  block_reason?: string | null
  project_views: { id: string; label: string } | null
  projects: { id: string; name: string; clients: { name: string } | null } | null
  users: { name: string } | null
}

function SectionHeader({ children, count }: { children: React.ReactNode; count: number }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="text-[10px] tracking-[0.18em] uppercase text-ink-3">{children}</span>
      <span className="flex-1 border-t border-line" />
      <span className="text-[10px] text-ink-3 tabular-nums">{count}</span>
    </div>
  )
}

function ProjectRow({ project, href, meta }: { project: ProjectSummary; href: string; meta?: React.ReactNode }) {
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
  const now = new Date()
  const today = now.toISOString().split('T')[0]
  const sevenDaysFromNow = new Date(now)
  sevenDaysFromNow.setDate(now.getDate() + 7)
  const in7Days = sevenDaysFromNow.toISOString().split('T')[0]

  const [
    { data: dueSoonProjects },
    { data: stagesToday },
    { data: blockedStates },
    { data: feedbackProjects },
    { data: revisionProjects },
  ] = await Promise.all([
    supabase
      .from('projects')
      .select('id, name, status, delivery_date, delivery_time_window, clients ( name )')
      .lte('delivery_date', in7Days)
      .gte('delivery_date', today)
      .not('status', 'in', '("delivered","archived")')
      .order('delivery_date'),

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

    supabase
      .from('projects')
      .select('id, name, status, delivery_date, delivery_time_window, clients ( name )')
      .eq('status', 'waiting_for_feedback')
      .order('name'),

    supabase
      .from('projects')
      .select('id, name, status, current_round_number, delivery_date, delivery_time_window, clients ( name )')
      .eq('status', 'revision')
      .order('name'),
  ])

  const dueSoonRows = (dueSoonProjects ?? []) as unknown as ProjectSummary[]
  const stageRows = (stagesToday ?? []) as unknown as StageSummary[]
  const blockedRows = (blockedStates ?? []) as unknown as StageSummary[]
  const feedbackRows = (feedbackProjects ?? []) as unknown as ProjectSummary[]
  const revisionRows = (revisionProjects ?? []) as unknown as ProjectSummary[]

  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })

  const isEmpty =
    blockedRows.length === 0 &&
    stageRows.length === 0 &&
    dueSoonRows.length === 0 &&
    feedbackRows.length === 0 &&
    revisionRows.length === 0

  return (
    <div className="space-y-10">
      <div className="flex items-baseline justify-between">
        <h1 className="text-[15px] font-medium text-ink">Today</h1>
        <span className="text-[11px] text-ink-3">{dateStr}</span>
      </div>

      {blockedRows.length > 0 && (
        <section>
          <SectionHeader count={blockedRows.length}>Blocked</SectionHeader>
          <div className="space-y-1.5">
            {blockedRows.map(s => (
              <div key={s.id} className="flex items-center justify-between px-3 py-2.5 bg-blocked-bg border border-blocked-text/20 rounded-md">
                <div className="min-w-0">
                  <div className="text-[13px] text-ink truncate">
                    {s.projects?.clients?.name && (
                      <span className="text-ink-3">{s.projects.clients.name} / </span>
                    )}
                    {s.projects?.name}
                    <span className="text-ink-3 mx-1.5">-</span>
                    <span className="text-ink-2">{s.project_views?.label}</span>
                    <span className="text-ink-3 mx-1.5">-</span>
                    <span className="text-ink-2">{STAGE_LABELS[s.stage]}</span>
                  </div>
                  {s.block_reason && (
                    <div className="text-[11px] text-blocked-text mt-0.5">{s.block_reason}</div>
                  )}
                </div>
                <Link
                  href={`/admin/projects/${s.projects?.id}`}
                  className="ml-4 shrink-0 text-[11px] text-ink-3 hover:text-ink-2 transition-colors"
                >
                  Unblock -&gt;
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {stageRows.length > 0 && (
        <section>
          <SectionHeader count={stageRows.length}>Stages due today</SectionHeader>
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
                {stageRows.map((s, i) => (
                  <tr key={s.id} className={i > 0 ? 'border-t border-line' : ''}>
                    <td className="px-3 py-2.5">
                      <Link href={`/admin/projects/${s.projects?.id}`} className="text-[12px] text-ink hover:text-accent transition-colors">
                        {s.projects?.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-[12px] text-ink-2">{s.project_views?.label}</td>
                    <td className="px-3 py-2.5">
                      <StageBadge status={s.status} />
                      <span className="ml-1.5 text-[11px] text-ink-3">{STAGE_LABELS[s.stage]}</span>
                    </td>
                    <td className="px-3 py-2.5 text-[11px] text-ink-2 tabular-nums">
                      {formatDelivery(s.latest_eta_date ?? null, s.latest_eta_time_window ?? null)}
                    </td>
                    <td className="px-3 py-2.5 text-[11px] text-ink-3">{s.users?.name ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {dueSoonRows.length > 0 && (
        <section>
          <SectionHeader count={dueSoonRows.length}>Due this week</SectionHeader>
          <div className="space-y-1.5">
            {dueSoonRows.map(p => (
              <ProjectRow
                key={p.id}
                project={p}
                href={`/admin/projects/${p.id}`}
                meta={<span className="text-[11px] text-ink-3">{formatDelivery(p.delivery_date, p.delivery_time_window)}</span>}
              />
            ))}
          </div>
        </section>
      )}

      {feedbackRows.length > 0 && (
        <section>
          <SectionHeader count={feedbackRows.length}>Waiting for feedback</SectionHeader>
          <div className="space-y-1.5">
            {feedbackRows.map(p => (
              <ProjectRow
                key={p.id}
                project={p}
                href={`/admin/projects/${p.id}`}
                meta={<span className="text-[11px] text-ink-3">{formatDelivery(p.delivery_date, p.delivery_time_window)}</span>}
              />
            ))}
          </div>
        </section>
      )}

      {revisionRows.length > 0 && (
        <section>
          <SectionHeader count={revisionRows.length}>Active revisions</SectionHeader>
          <div className="space-y-1.5">
            {revisionRows.map(p => (
              <ProjectRow
                key={p.id}
                project={p}
                href={`/admin/projects/${p.id}`}
                meta={<span className="text-[11px] text-ink-3">{roundLabel(p.current_round_number ?? 0)}</span>}
              />
            ))}
          </div>
        </section>
      )}

      {isEmpty && (
        <div className="text-center py-20 text-ink-3 text-[13px]">All clear.</div>
      )}
    </div>
  )
}
