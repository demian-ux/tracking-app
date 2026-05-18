import { createClient } from '@/lib/supabase/server'

interface IntegrityResult {
  ok: boolean
  projects_no_views: { id: string; name: string; status: string }[]
  projects_no_rounds: { id: string; name: string; status: string }[]
  multiple_active_rounds: { project_id: string; project_name: string; active_round_count: number }[]
  rounds_missing_states: { round_id: string; project_name: string; round_number: number; state_count: number; expected_count: number }[]
  impossible_timestamps: { id: string; project_id: string; stage: string; status: string; started_at: string; completed_at: string }[]
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

  const result = data as IntegrityResult

  const totalIssues =
    result.projects_no_views.length +
    result.projects_no_rounds.length +
    result.multiple_active_rounds.length +
    result.rounds_missing_states.length +
    result.impossible_timestamps.length

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-[15px] font-medium text-ink">Data Integrity</h1>
        <span className={`text-[11px] px-2.5 py-1 rounded-full font-medium ${
          totalIssues === 0
            ? 'bg-done-bg text-done-text'
            : 'bg-blocked-bg text-blocked-text'
        }`}>
          {totalIssues === 0 ? 'All clear' : `${totalIssues} issue${totalIssues > 1 ? 's' : ''}`}
        </span>
      </div>

      <div className="space-y-4">
        <CheckSection
          title="Projects with no active views"
          count={result.projects_no_views.length}
        >
          {result.projects_no_views.map(p => (
            <Row key={p.id}>
              <a href={`/admin/projects/${p.id}`} className="text-[12px] text-ink hover:text-accent transition-colors">
                {p.name}
              </a>
              <Badge>{p.status}</Badge>
            </Row>
          ))}
        </CheckSection>

        <CheckSection
          title="Projects with no delivery rounds"
          count={result.projects_no_rounds.length}
        >
          {result.projects_no_rounds.map(p => (
            <Row key={p.id}>
              <a href={`/admin/projects/${p.id}`} className="text-[12px] text-ink hover:text-accent transition-colors">
                {p.name}
              </a>
              <Badge>{p.status}</Badge>
            </Row>
          ))}
        </CheckSection>

        <CheckSection
          title="Projects with multiple active rounds"
          count={result.multiple_active_rounds.length}
        >
          {result.multiple_active_rounds.map(r => (
            <Row key={r.project_id}>
              <a href={`/admin/projects/${r.project_id}`} className="text-[12px] text-ink hover:text-accent transition-colors">
                {r.project_name}
              </a>
              <span className="text-[11px] text-blocked-text">{r.active_round_count} active rounds</span>
            </Row>
          ))}
        </CheckSection>

        <CheckSection
          title="Active rounds with missing stage states"
          count={result.rounds_missing_states.length}
        >
          {result.rounds_missing_states.map(r => (
            <Row key={r.round_id}>
              <a href={`/admin/projects/${r.round_id}`} className="text-[12px] text-ink hover:text-accent transition-colors">
                {r.project_name}
              </a>
              <span className="text-[11px] text-ink-3">Round {r.round_number}</span>
              <span className="text-[11px] text-blocked-text">{r.state_count} / {r.expected_count} states</span>
            </Row>
          ))}
        </CheckSection>

        <CheckSection
          title="Stage states with impossible timestamps"
          count={result.impossible_timestamps.length}
        >
          {result.impossible_timestamps.map(s => (
            <Row key={s.id}>
              <span className="text-[12px] text-ink font-mono">{s.id.slice(0, 8)}…</span>
              <span className="text-[11px] text-ink-3">{s.stage}</span>
              <span className="text-[11px] text-blocked-text">
                started {s.started_at.slice(0, 16)} · completed {s.completed_at.slice(0, 16)}
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
      {count > 0 && (
        <div className="space-y-1.5">{children}</div>
      )}
    </div>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {children}
    </div>
  )
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] px-1.5 py-0.5 bg-elevated border border-line text-ink-3 rounded">
      {children}
    </span>
  )
}
