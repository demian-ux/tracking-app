import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'
import { SectionLabel } from '@/components/ui/SectionLabel'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHead } from '@/components/ui/PageHead'
import { Icon } from '@/components/ui/Icon'
import { Avatar } from '@/components/ui/Avatar'
import { ButtonLink } from '@/components/ui/Button'
import { formatDelivery, roundLabel } from '@/lib/utils/formatting'
import { getTodayISOInTimeZone, getWeekEndISOInTimeZone } from '@/lib/utils/dates'
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

function ProjectRow({
  project,
  href,
  meta,
}: {
  project: ProjectSummary
  href: string
  meta?: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-4 px-4 py-3 bg-surface border border-line rounded-md hover:border-line-strong hover:bg-elevated transition-colors duration-100"
    >
      <div className="min-w-0">
        <div className="text-body text-ink truncate">
          {project.clients?.name && <span className="text-ink-3">{project.clients.name} / </span>}
          {project.name}
        </div>
        {meta && <div className="mt-0.5">{meta}</div>}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <Badge status={project.status} dot />
        <Icon name="arrow-right" size={12} className="text-ink-3" />
      </div>
    </Link>
  )
}

export default async function TodayPage() {
  const supabase = await createClient()
  const today = getTodayISOInTimeZone()
  const in7Days = getWeekEndISOInTimeZone(7)

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

  const dateStr = new Date().toLocaleDateString('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires',
    weekday: 'long', month: 'long', day: 'numeric',
  })

  const isEmpty =
    blockedRows.length === 0 &&
    stageRows.length === 0 &&
    dueSoonRows.length === 0 &&
    feedbackRows.length === 0 &&
    revisionRows.length === 0

  return (
    <div>
      <PageHead title="Today" sub={dateStr} />

      {isEmpty ? (
        <EmptyState
          icon="check"
          title="All clear."
          sub="Nothing blocked, due, or waiting. Enjoy the quiet."
        />
      ) : (
        <div className="space-y-8">
          {blockedRows.length > 0 && (
            <section>
              <SectionLabel count={blockedRows.length}>Blocked</SectionLabel>
              <div className="space-y-2">
                {blockedRows.map(s => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between gap-3 px-4 py-3 bg-blocked-bg border border-blocked-text/20 rounded-md"
                  >
                    <div className="min-w-0">
                      <div className="text-body text-ink truncate">
                        {s.projects?.clients?.name && (
                          <span className="text-ink-3">{s.projects.clients.name} / </span>
                        )}
                        {s.projects?.name}
                        <span className="text-ink-faint mx-1.5">·</span>
                        <span className="text-ink-2">{s.project_views?.label}</span>
                        <span className="text-ink-faint mx-1.5">·</span>
                        <span className="text-ink-2">{STAGE_LABELS[s.stage]}</span>
                      </div>
                      {s.block_reason && (
                        <div className="text-caption text-blocked-text mt-0.5">{s.block_reason}</div>
                      )}
                    </div>
                    <ButtonLink
                      href={`/admin/projects/${s.projects?.id}`}
                      variant="ghost"
                      size="sm"
                      rightIcon="arrow-right"
                      className="shrink-0"
                    >
                      Unblock
                    </ButtonLink>
                  </div>
                ))}
              </div>
            </section>
          )}

          {stageRows.length > 0 && (
            <section>
              <SectionLabel count={stageRows.length}>Stages due today</SectionLabel>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>View</th>
                      <th>Stage</th>
                      <th>ETA</th>
                      <th>Owner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stageRows.map(s => (
                      <tr key={s.id}>
                        <td className="primary">
                          <Link
                            href={`/admin/projects/${s.projects?.id}`}
                            className="hover:text-accent transition-colors"
                          >
                            {s.projects?.name}
                          </Link>
                        </td>
                        <td>{s.project_views?.label}</td>
                        <td>
                          <span className="inline-flex items-center gap-2">
                            <Badge status={s.status} />
                            <span className="text-ink-3">{STAGE_LABELS[s.stage]}</span>
                          </span>
                        </td>
                        <td className="tabular-nums">
                          {formatDelivery(s.latest_eta_date ?? null, s.latest_eta_time_window ?? null)}
                        </td>
                        <td>
                          {s.users?.name ? (
                            <span className="inline-flex items-center gap-2">
                              <Avatar name={s.users.name} size={18} />
                              {s.users.name}
                            </span>
                          ) : (
                            <span className="text-ink-faint">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {dueSoonRows.length > 0 && (
            <section>
              <SectionLabel count={dueSoonRows.length}>Due this week</SectionLabel>
              <div className="space-y-2">
                {dueSoonRows.map(p => (
                  <ProjectRow
                    key={p.id}
                    project={p}
                    href={`/admin/projects/${p.id}`}
                    meta={
                      <span className="text-caption text-ink-2 tabular-nums">
                        {formatDelivery(p.delivery_date, p.delivery_time_window)}
                      </span>
                    }
                  />
                ))}
              </div>
            </section>
          )}

          {feedbackRows.length > 0 && (
            <section>
              <SectionLabel count={feedbackRows.length}>Waiting for feedback</SectionLabel>
              <div className="space-y-2">
                {feedbackRows.map(p => (
                  <ProjectRow
                    key={p.id}
                    project={p}
                    href={`/admin/projects/${p.id}`}
                    meta={
                      <span className="text-caption text-ink-2">
                        {formatDelivery(p.delivery_date, p.delivery_time_window)}
                      </span>
                    }
                  />
                ))}
              </div>
            </section>
          )}

          {revisionRows.length > 0 && (
            <section>
              <SectionLabel count={revisionRows.length}>Active revisions</SectionLabel>
              <div className="space-y-2">
                {revisionRows.map(p => (
                  <ProjectRow
                    key={p.id}
                    project={p}
                    href={`/admin/projects/${p.id}`}
                    meta={
                      <span className="text-caption text-ink-2">
                        {roundLabel(p.current_round_number ?? 0)}
                      </span>
                    }
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
