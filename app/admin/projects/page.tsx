// @ts-nocheck
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { ProjectBadge } from '@/components/ui/Badge'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { formatDelivery, roundLabel } from '@/lib/utils/formatting'
import { calculateProgress } from '@/lib/utils/progress'

export default async function ProjectsPage() {
  const supabase = await createClient()

  const { data: projects, error } = await supabase
    .from('projects')
    .select(`
      id, name, status, delivery_date, delivery_time_window,
      current_round_number, view_count,
      clients ( name ),
      delivery_rounds (
        id, status,
        view_stage_states ( status )
      )
    `)
    .not('status', 'eq', 'archived')
    .order('created_at', { ascending: false })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-[15px] font-medium text-ink">Projects</h1>
        <Link
          href="/admin/projects/new"
          className="px-3 py-1.5 bg-accent text-canvas text-[12px] font-medium rounded hover:bg-accent-dim transition-colors"
        >
          New project
        </Link>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-blocked-bg border border-blocked-text/20 rounded-md">
          <p className="text-[11px] text-blocked-text font-medium">Query error</p>
          <p className="text-[11px] text-ink-2 font-mono mt-1">{error.message}</p>
        </div>
      )}

      {!error && !projects?.length && (
        <div className="text-center py-16 text-ink-3 text-[13px]">
          No projects yet. Create your first one.
        </div>
      )}

      <div className="space-y-1.5">
        {(projects as any[])?.map((project: any) => {
          const activeRound = project.delivery_rounds?.find((r: any) => r.status === 'active')
          const activeStates = activeRound?.view_stage_states ?? []
          const progress = calculateProgress(activeStates)

          return (
            <Link
              key={project.id}
              href={`/admin/projects/${project.id}`}
              className="flex items-center justify-between gap-4 bg-surface border border-line rounded-md px-4 py-3 hover:border-line-strong hover:bg-elevated transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-ink truncate">
                  {project.clients?.name && (
                    <span className="text-ink-3">{project.clients.name} / </span>
                  )}
                  {project.name}
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-ink-3">
                  <span>{roundLabel(project.current_round_number)}</span>
                  <span>·</span>
                  <span>{project.view_count} views</span>
                  <span>·</span>
                  <span>{formatDelivery(project.delivery_date, project.delivery_time_window)}</span>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="w-20">
                  <ProgressBar value={progress} />
                </div>
                <ProjectBadge status={project.status} />
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
