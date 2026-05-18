'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { StageBadge, ProjectBadge } from '@/components/ui/Badge'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { calculateProgress } from '@/lib/utils/progress'
import { formatDelivery, roundLabel } from '@/lib/utils/formatting'
import { STAGE_LABELS, STAGE_ORDER } from '@/lib/types/app'
import type { StageStatus, StageType, TimeWindow } from '@/lib/types/database'

interface TimelineProject {
  id: string
  name: string
  status: string
  delivery_date: string | null
  delivery_time_window: TimeWindow | null
  current_round_number: number
  clients: { name: string } | null
  project_views: { id: string; number: number; label: string; active: boolean }[]
  project_view_rounds: {
    id: string
    round_number: number
    status: string
    project_view_id: string
    view_stage_states: {
      id: string
      project_view_id: string
      stage: StageType
      status: StageStatus
      latest_eta_date: string | null
      latest_eta_time_window: TimeWindow | null
    }[]
  }[]
}

interface Props {
  projects: TimelineProject[]
  clients: { id: string; name: string }[]
}

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'waiting_for_feedback', label: 'Waiting for feedback' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'revision', label: 'Revision' },
]

function getThisWeekEnd() {
  const d = new Date()
  d.setDate(d.getDate() + (7 - d.getDay()))
  return d.toISOString().split('T')[0]
}

const selectClass = 'px-2.5 py-1.5 bg-surface border border-line rounded-md text-[12px] text-ink-2 focus:outline-none focus:border-accent transition-colors hover:border-line-strong'

export function TimelineFilters({ projects, clients }: Props) {
  const [activeOnly, setActiveOnly] = useState(false)
  const [dueThisWeek, setDueThisWeek] = useState(false)
  const [clientFilter, setClientFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [roundFilter, setRoundFilter] = useState('')

  const weekEnd = getThisWeekEnd()
  const today = new Date().toISOString().split('T')[0]

  // Collect all round numbers across projects
  const allRounds = useMemo(() => {
    const nums = new Set<number>()
    projects.forEach(p => p.project_view_rounds.forEach(r => nums.add(r.round_number)))
    return Array.from(nums).sort((a, b) => a - b)
  }, [projects])

  const filtered = useMemo(() => {
    return projects.filter(p => {
      if (activeOnly && (p.status === 'archived' || p.status === 'delivered')) return false
      if (dueThisWeek) {
        if (!p.delivery_date) return false
        if (p.delivery_date < today || p.delivery_date > weekEnd) return false
      }
      if (clientFilter && p.clients?.name !== clientFilter) return false
      if (statusFilter && p.status !== statusFilter) return false
      if (roundFilter !== '') {
        const rn = parseInt(roundFilter)
        const hasRound = p.project_view_rounds.some(r => r.round_number === rn && r.status === 'active')
        if (!hasRound) return false
      }
      return true
    })
  }, [projects, activeOnly, dueThisWeek, clientFilter, statusFilter, roundFilter, today, weekEnd])

  const filtersActive = activeOnly || dueThisWeek || clientFilter || statusFilter || roundFilter !== ''

  return (
    <div>
      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <button
          onClick={() => setActiveOnly(v => !v)}
          className={`px-2.5 py-1.5 rounded-md text-[12px] border transition-colors ${
            activeOnly
              ? 'bg-accent text-canvas border-accent'
              : 'bg-surface text-ink-2 border-line hover:border-line-strong'
          }`}
        >
          Active only
        </button>
        <button
          onClick={() => setDueThisWeek(v => !v)}
          className={`px-2.5 py-1.5 rounded-md text-[12px] border transition-colors ${
            dueThisWeek
              ? 'bg-accent text-canvas border-accent'
              : 'bg-surface text-ink-2 border-line hover:border-line-strong'
          }`}
        >
          Due this week
        </button>

        <select value={clientFilter} onChange={e => setClientFilter(e.target.value)} className={selectClass}>
          <option value="">All clients</option>
          {clients.map(c => (
            <option key={c.id} value={c.name}>{c.name}</option>
          ))}
        </select>

        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={selectClass}>
          {STATUS_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        {allRounds.length > 1 && (
          <select value={roundFilter} onChange={e => setRoundFilter(e.target.value)} className={selectClass}>
            <option value="">All rounds</option>
            {allRounds.map(n => (
              <option key={n} value={n}>{roundLabel(n)}</option>
            ))}
          </select>
        )}

        {filtersActive && (
          <button
            onClick={() => {
              setActiveOnly(false); setDueThisWeek(false)
              setClientFilter(''); setStatusFilter(''); setRoundFilter('')
            }}
            className="px-2.5 py-1.5 text-[12px] text-ink-3 hover:text-ink-2 transition-colors"
          >
            Clear
          </button>
        )}

        <span className="ml-auto text-[11px] text-ink-3">
          {filtered.length} project{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Timeline rows */}
      {filtered.length === 0 && (
        <div className="text-center py-16 text-ink-3 text-[13px]">No projects match these filters.</div>
      )}

      <div className="space-y-6">
        {filtered.map(project => {
          const activeRounds = project.project_view_rounds.filter(r => r.status === 'active')
          const activeViews = project.project_views.filter(v => v.active)
          const activeStates = activeRounds.flatMap(r => r.view_stage_states ?? [])
          const progress = calculateProgress(activeStates)
          const maxActiveRoundNumber = activeRounds.length > 0
            ? Math.max(...activeRounds.map(r => r.round_number))
            : null
          const deliveredRounds = project.project_view_rounds.filter(r => r.status === 'delivered')

          return (
            <div key={project.id} className="bg-surface border border-line rounded-md overflow-hidden">
              {/* Project header */}
              <div className="px-5 py-3 border-b border-line flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-1.5 text-[13px]">
                    {project.clients && (
                      <span className="text-ink-3">{project.clients.name} /</span>
                    )}
                    <Link
                      href={`/admin/projects/${project.id}`}
                      className="text-ink hover:text-accent transition-colors"
                    >
                      {project.name}
                    </Link>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <ProjectBadge status={project.status} />
                    <span className="text-[11px] text-ink-3">
                      {maxActiveRoundNumber !== null ? roundLabel(maxActiveRoundNumber) : '—'}
                    </span>
                    <span className="text-ink-3 text-[11px]">·</span>
                    <span className="text-[11px] text-ink-3">
                      {formatDelivery(project.delivery_date, project.delivery_time_window)}
                    </span>
                  </div>
                </div>
                <div className="w-28 shrink-0">
                  <ProgressBar value={progress} />
                </div>
              </div>

              {/* View-stage grid */}
              {activeRounds.length > 0 && activeViews.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-line bg-elevated">
                        <th className="text-left px-4 py-2 text-[10px] tracking-[0.12em] uppercase text-ink-3 w-20">View</th>
                        {STAGE_ORDER.map(stage => (
                          <th key={stage} className="text-left px-4 py-2 text-[10px] tracking-[0.12em] uppercase text-ink-3">
                            {STAGE_LABELS[stage]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {activeViews.map((view, i) => {
                        // Find active round states for this view
                        const viewActiveRound = activeRounds.find(r => r.project_view_id === view.id)
                        const viewStates = viewActiveRound?.view_stage_states ?? []
                        return (
                          <tr key={view.id} className={i > 0 ? 'border-t border-line' : ''}>
                            <td className="px-4 py-2.5 text-[11px] font-medium text-ink-2">{view.label}</td>
                            {STAGE_ORDER.map(stage => {
                              const state = viewStates.find(
                                s => s.project_view_id === view.id && s.stage === stage
                              )
                              return (
                                <td key={stage} className="px-4 py-2.5">
                                  {state ? (
                                    <div>
                                      <StageBadge status={state.status} />
                                      {state.latest_eta_date && (
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
              )}

              {/* Round history pills — show delivered view rounds */}
              {deliveredRounds.length > 0 && (
                <div className="px-5 py-2.5 border-t border-line flex gap-2 flex-wrap">
                  {Array.from(new Set(deliveredRounds.map(r => r.round_number))).sort().map(rn => (
                    <span
                      key={rn}
                      className="text-[10px] px-2 py-0.5 rounded-full bg-done-bg text-done-text"
                    >
                      {roundLabel(rn)} ✓
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
