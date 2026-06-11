import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'
import { PageHead } from '@/components/ui/PageHead'

interface ViewRef {
  project_id: string
  project_name: string
  view_id: string
  view_label: string
  view_number: number
}

interface StateRef extends ViewRef {
  state_id: string
  stage: string
}

interface IntegrityResult {
  projects_no_views: { id: string; name: string; status: string }[]
  views_no_active_round: ViewRef[]
  views_multiple_active_rounds: (ViewRef & { active_round_count: number })[]
  rounds_missing_states: (ViewRef & { round_id: string; round_number: number; state_count: number; expected_count: number })[]
  in_progress_no_assignee: StateRef[]
  blocked_no_reason: StateRef[]
  impossible_timestamps: (StateRef & { started_at: string; completed_at: string })[]
}

export default async function IntegrityPage() {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('check_data_integrity_rpc')

  if (error) {
    return (
      <div>
        <PageHead title="Integrity" />
        <div className="p-4 bg-blocked-bg border border-blocked-text/20 rounded-md">
          <p className="text-sm text-blocked-text font-mono">{error.message}</p>
        </div>
      </div>
    )
  }

  const r = data as unknown as IntegrityResult

  const totalIssues =
    r.projects_no_views.length +
    r.views_no_active_round.length +
    r.views_multiple_active_rounds.length +
    r.rounds_missing_states.length +
    r.in_progress_no_assignee.length +
    r.blocked_no_reason.length +
    r.impossible_timestamps.length

  return (
    <div>
      <PageHead
        title="Integrity"
        sub="All checks"
        actions={
          <Badge
            status={totalIssues === 0 ? 'done' : 'blocked'}
            label={totalIssues === 0 ? 'All clear' : `${totalIssues} issue${totalIssues !== 1 ? 's' : ''}`}
            dot
          />
        }
      />

      <div className="space-y-3">
        <CheckSection title="Active projects with no active views" count={r.projects_no_views.length}>
          {r.projects_no_views.map(p => (
            <Row key={p.id}>
              <Link href={`/admin/projects/${p.id}`} className="text-sm text-ink hover:text-accent transition-colors">
                {p.name}
              </Link>
              <Badge status={p.status} />
            </Row>
          ))}
        </CheckSection>

        <CheckSection title="Active views with no active round" count={r.views_no_active_round.length}>
          {r.views_no_active_round.map(v => (
            <Row key={v.view_id}>
              <Link href={`/admin/projects/${v.project_id}`} className="text-sm text-ink hover:text-accent transition-colors">
                {v.project_name}
              </Link>
              <span>View {String(v.view_number).padStart(2, '0')} · {v.view_label}</span>
            </Row>
          ))}
        </CheckSection>

        <CheckSection title="Views with multiple active rounds" count={r.views_multiple_active_rounds.length}>
          {r.views_multiple_active_rounds.map(v => (
            <Row key={v.view_id}>
              <Link href={`/admin/projects/${v.project_id}`} className="text-sm text-ink hover:text-accent transition-colors">
                {v.project_name}
              </Link>
              <span>View {String(v.view_number).padStart(2, '0')} · {v.view_label}</span>
              <span className="text-blocked-text">{v.active_round_count} active rounds</span>
            </Row>
          ))}
        </CheckSection>

        <CheckSection title="Active rounds missing stage states" count={r.rounds_missing_states.length}>
          {r.rounds_missing_states.map(v => (
            <Row key={v.round_id}>
              <Link href={`/admin/projects/${v.project_id}`} className="text-sm text-ink hover:text-accent transition-colors">
                {v.project_name}
              </Link>
              <span>View {String(v.view_number).padStart(2, '0')} · Round {v.round_number}</span>
              <span className="text-blocked-text">{v.state_count} / {v.expected_count} states</span>
            </Row>
          ))}
        </CheckSection>

        <CheckSection title="In-progress stages with no assignee" count={r.in_progress_no_assignee.length}>
          {r.in_progress_no_assignee.map(s => (
            <Row key={s.state_id}>
              <Link href={`/admin/projects/${s.project_id}`} className="text-sm text-ink hover:text-accent transition-colors">
                {s.project_name}
              </Link>
              <span>View {String(s.view_number).padStart(2, '0')} · {s.stage}</span>
            </Row>
          ))}
        </CheckSection>

        <CheckSection title="Blocked stages with no reason" count={r.blocked_no_reason.length}>
          {r.blocked_no_reason.map(s => (
            <Row key={s.state_id}>
              <Link href={`/admin/projects/${s.project_id}`} className="text-sm text-ink hover:text-accent transition-colors">
                {s.project_name}
              </Link>
              <span>View {String(s.view_number).padStart(2, '0')} · {s.stage}</span>
            </Row>
          ))}
        </CheckSection>

        <CheckSection title="Stage states with impossible timestamps" count={r.impossible_timestamps.length}>
          {r.impossible_timestamps.map(s => (
            <Row key={s.state_id}>
              <Link href={`/admin/projects/${s.project_id}`} className="text-sm text-ink hover:text-accent transition-colors">
                {s.project_name}
              </Link>
              <span>View {String(s.view_number).padStart(2, '0')} · {s.stage}</span>
              <span className="text-blocked-text font-mono">
                {s.started_at.slice(0, 16)} → {s.completed_at.slice(0, 16)}
              </span>
            </Row>
          ))}
        </CheckSection>
      </div>
    </div>
  )
}

function CheckSection({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children: React.ReactNode
}) {
  return (
    <div className="bg-surface border border-line rounded-md p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <span className="text-label font-semibold uppercase text-ink-3">{title}</span>
        <Badge
          status={count === 0 ? 'done' : 'blocked'}
          label={count === 0 ? 'OK' : `${count} issue${count !== 1 ? 's' : ''}`}
        />
      </div>
      {count > 0 && <div className="space-y-2">{children}</div>}
    </div>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-3 flex-wrap text-caption text-ink-3">{children}</div>
}
