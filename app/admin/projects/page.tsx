import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { PageHead } from '@/components/ui/PageHead'
import { EmptyState } from '@/components/ui/EmptyState'
import { ButtonLink } from '@/components/ui/Button'
import { formatDelivery, roundLabel } from '@/lib/utils/formatting'
import { calculateProgress } from '@/lib/utils/progress'
import type { ProjectStatus, StageStatus, TimeWindow } from '@/lib/types/database'
import { ProjectCleanupActions } from '@/components/admin/ProjectCleanupActions'

interface ProjectListRow {
  id: string
  name: string
  status: ProjectStatus
  delivery_date: string | null
  delivery_time_window: TimeWindow | null
  current_round_number: number
  view_count: number
  clients: { name: string } | null
  project_view_rounds: {
    id: string
    status: string
    view_stage_states: { status: StageStatus }[]
  }[]
}

export default async function ProjectsPage() {
  const supabase = await createClient()

  const { data: projects, error } = await supabase
    .from('projects')
    .select(`
      id, name, status, delivery_date, delivery_time_window,
      current_round_number, view_count,
      clients ( name ),
      project_view_rounds (
        id, status,
        view_stage_states ( status )
      )
    `)
    .not('status', 'eq', 'archived')
    .order('created_at', { ascending: false })

  const projectRows = (projects ?? []) as unknown as ProjectListRow[]

  return (
    <div>
      <PageHead
        title="Projects"
        sub={projectRows.length > 0 ? `${projectRows.length} active` : undefined}
        actions={
          <ButtonLink href="/admin/projects/new" variant="primary" size="sm" leftIcon="plus">
            New project
          </ButtonLink>
        }
      />

      {error && (
        <div className="mb-4 p-3 bg-blocked-bg border border-blocked-text/20 rounded-md">
          <p className="text-caption font-medium text-blocked-text">Query error</p>
          <p className="text-caption text-ink-2 font-mono mt-1">{error.message}</p>
        </div>
      )}

      {!error && projectRows.length === 0 && (
        <EmptyState
          icon="folder"
          title="No projects yet"
          sub="Create your first project to get started."
          action={
            <ButtonLink href="/admin/projects/new" variant="primary" size="sm" leftIcon="plus">
              New project
            </ButtonLink>
          }
        />
      )}

      <div className="space-y-2">
        {projectRows.map(project => {
          const activeStates =
            project.project_view_rounds
              ?.filter(r => r.status === 'active')
              .flatMap(r => r.view_stage_states ?? []) ?? []
          const progress = calculateProgress(activeStates)

          return (
            <div
              key={project.id}
              className="flex items-center justify-between gap-4 bg-surface border border-line rounded-md px-4 py-3 hover:border-line-strong hover:bg-elevated transition-colors duration-100"
            >
              <Link href={`/admin/projects/${project.id}`} className="min-w-0 flex-1">
                <div className="text-body text-ink truncate">
                  {project.clients?.name && (
                    <span className="text-ink-3">{project.clients.name} / </span>
                  )}
                  {project.name}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 text-caption text-ink-2">
                  <span>{roundLabel(project.current_round_number)}</span>
                  <span className="text-ink-faint">·</span>
                  <span>{project.view_count} views</span>
                  <span className="text-ink-faint">·</span>
                  <span>{formatDelivery(project.delivery_date, project.delivery_time_window)}</span>
                </div>
              </Link>
              <div className="flex items-center gap-4 shrink-0">
                <div className="w-28">
                  <ProgressBar value={progress} />
                </div>
                <Badge status={project.status} dot />
                <ProjectCleanupActions
                  projectId={project.id}
                  projectName={project.name}
                  viewCount={project.view_count}
                  compact
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
