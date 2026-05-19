import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

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
        <h1 className="text-[15px] font-medium text-ink mb-6">Data Integrity</h1>
        <div className="p-4 bg-blocked-bg border border-blocked-text/20 rounded-md">
          <p className="text-[12px] text-blocked-text font-mono">{error.message}</p>
        </div>
      </div>
    )
  }

  const r = data as IntegrityResult

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
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-[15px] font-medium text-ink">Data Integrity</h1>
        <span className={`text-[11px] px-2.5 py-1 rounded-full font-medium ${
          totalIssues === 0 ? 'bg-done-bg text-done-text' : 'bg-blocked-bg text-blocked-text'
        }`}>
          {totalIssues === 0 ? 'All clear' : `${totalIssues} issue${totalIssues !== 1 ? 's' : ''}`}
        </span>
      </div>

      <div className="space-y-4">
        <CheckSection title="Active projects with no active views" count={r.projects_no_views.length}>
          {r.projects_no_views.map(p => (
            <Row key={p.id}>
              <Link href={`/admin/projects/${p.id}`} className="text-[12px] text-ink hover:text-accent transition-colors">
                {p.name}
              </Link>
              <Badge>{p.status}</Badge>
            </Row>
          ))}
        </CheckSection>

        <CheckSection title="Active views with no active round" count={r.views_no_active_round.length}>
          {r.views_no_active_round.map(v => (
            <Row key={v.view_id}>
              <Link href={`/admin/projects/${v.project_id}`} className="text-[12px] text-ink hover:text-accent transition-colors">
                {v.project_name}
              </Link>
              <span className="text-[11px] text-ink-3">View {String(v.view_number).padStart(2, '0')} · {v.view_label}</span>
            </Row>
          ))}
        </CheckSection>

        <CheckSection title="Views with multiple active rounds" count={r.views_multiple_active_rounds.length}>
          {r.views_multiple_active_rounds.map(v => (
            <Row key={v.view_id}>
              <Link href={`/admin/projects/${v.project_id}`} className="text-[12px] text-ink hover:text-accent transition-colors">
                {v.project_name}
              </Link>
              <span className="text-[11px] text-ink-3">View {String(v.view_number).padStart(2, '0')} · {v.view_label}</span>
              <span className="text-[11px] text-blocked-text">{v.active_round_count} active rounds</span>
            </Row>
          ))}
        </CheckSection>

        <CheckSection title="Active rounds missing stage states" count={r.rounds_missing_states.length}>
          {r.rounds_missing_states.map(v => (
            <Row key={v.round_id}>
              <Link href={`/admin/projects/${v.project_id}`} className="text-[12px] text-ink hover:text-accent transition-colors">
                {v.project_name}
              </Link>
              <span className="text-[11px] text-ink-3">View {String(v.view_number).padStart(2, '0')} · Round {v.round_number}</span>
              <span className="text-[11px] text-blocked-text">{v.state_count} / {v.expected_count} states</span>
            </Row>
          ))}
        </CheckSection>

        <CheckSection title="In-progress stages with no assignee" count={r.in_progress_no_assignee.length}>
          {r.in_progress_no_assignee.map(s => (
            <Row key={s.state_id}>
              <Link href={`/admin/projects/${s.project_id}`} className="text-[12px] text-ink hover:text-accent transition-colors">
                {s.project_name}
              </Link>
              <span className="text-[11px] text-ink-3">View {String(s.view_number).padStart(2, '0')} · {s.stage}</span>
            </Row>
          ))}
        </CheckSection>

        <CheckSection title="Blocked stages with no reason" count={r.blocked_no_reason.length}>
          {r.blocked_no_reason.map(s => (
            <Row key={s.state_id}>
              <Link href={`/admin/projects/${s.project_id}`} className="text-[12px] text-ink hover:text-accent transition-colors">
                {s.project_name}
              </Link>
              <span className="text-[11px] text-ink-3">View {String(s.view_number).padStart(2, '0')} · {s.stage}</span>
            </Row>
          ))}
        </CheckSection>

        <CheckSection title="Stage states with impossible timestamps" count={r.impossible_timestamps.length}>
          {r.impossible_timestamps.map(s => (
            <Row key={s.state_id}>
              <Link href={`/admin/projects/${s.project_id}`} className="text-[12px] text-ink hover:text-accent transition-colors">
                {s.project_name}
              </Link>
              <span className="text-[11px] text-ink-3">View {String(s.view_number).padStart(2, '0')} · {s.stage}</span>
              <span className="text-[11px] text-blocked-text font-mono">
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
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[11px] tracking-[0.1em] uppercase text-ink-3">{title}</h2>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
          count === 0 ? 'bg-done-bg text-done-text' : 'bg-blocked-bg text-blocked-text'
        }`}>
          {count === 0 ? 'OK' : count}
        </span>
      </div>
      {count > 0 && <div className="space-y-1.5">{children}</div>}
    </div>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-3 flex-wrap">{children}</div>
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] px-1.5 py-0.5 bg-elevated border border-line text-ink-3 rounded">
      {children}
    </span>
  )
}
