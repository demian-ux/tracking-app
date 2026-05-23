'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Select } from '@/components/ui/Input'
import { FilterChip } from '@/components/ui/FilterChip'
import { EmptyState } from '@/components/ui/EmptyState'
import { Icon } from '@/components/ui/Icon'
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
        <FilterChip active={activeOnly} onClick={() => setActiveOnly(v => !v)}>
          Active only
        </FilterChip>
        <FilterChip active={dueThisWeek} onClick={() => setDueThisWeek(v => !v)}>
          Due this week
        </FilterChip>

        <Select
          value={clientFilter}
          onChange={e => setClientFilter(e.target.value)}
          className="h-8 w-auto text-sm"
        >
          <option value="">All clients</option>
          {clients.map(c => (
            <option key={c.id} value={c.name}>{c.name}</option>
          ))}
        </Select>

        <Select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="h-8 w-auto text-sm"
        >
          {STATUS_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>

        {allRounds.length > 1 && (
          <Select
            value={roundFilter}
            onChange={e => setRoundFilter(e.target.value)}
            className="h-8 w-auto text-sm"
          >
            <option value="">All rounds</option>
            {allRounds.map(n => (
              <option key={n} value={n}>{roundLabel(n)}</option>
            ))}
          </Select>
        )}

        {filtersActive && (
          <button
            onClick={() => {
              setActiveOnly(false); setDueThisWeek(false)
              setClientFilter(''); setStatusFilter(''); setRoundFilter('')
            }}
            className="text-sm text-ink-3 hover:text-ink-2 transition-colors px-1.5"
          >
            Clear
          </button>
        )}

        <span className="ml-auto text-caption text-ink-3">
          {filtered.length} project{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Timeline rows */}
      {filtered.length === 0 && (
        <EmptyState
          icon="calendar"
          title="No projects"
          sub="No projects match these filters."
        />
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
              <div className="px-5 py-3 border-b border-line flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-body truncate">
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
                    <Badge status={project.status} />
                    <span className="text-caption text-ink-3">
                      {maxActiveRoundNumber !== null ? roundLabel(maxActiveRoundNumber) : '—'}
                    </span>
                    <span className="text-ink-faint text-caption">·</span>
                    <span className="text-caption text-ink-3">
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
                  <table className="table">
                    <thead>
                      <tr>
                        <th className="w-20">View</th>
                        {STAGE_ORDER.map(stage => (
                          <th key={stage}>{STAGE_LABELS[stage]}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {activeViews.map(view => {
                        // Find active round states for this view
                        const viewActiveRound = activeRounds.find(r => r.project_view_id === view.id)
                        const viewStates = viewActiveRound?.view_stage_states ?? []
                        return (
                          <tr key={view.id}>
                            <td className="primary">{view.label}</td>
                            {STAGE_ORDER.map(stage => {
                              const state = viewStates.find(
                                s => s.project_view_id === view.id && s.stage === stage
                              )
                              return (
                                <td key={stage}>
                                  {state ? (
                                    <div>
                                      <Badge status={state.status} />
                                      {state.latest_eta_date && (
                                        <div className="text-caption text-ink-3 mt-0.5">
                                          {formatDelivery(state.latest_eta_date, state.latest_eta_time_window)}
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-ink-faint">—</span>
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
                <div className="px-5 py-2.5 border-t border-line flex items-center gap-2 flex-wrap">
                  {Array.from(new Set(deliveredRounds.map(r => r.round_number))).sort().map(rn => (
                    <span
                      key={rn}
                      className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-done-bg text-done-text"
                    >
                      {roundLabel(rn)}
                      <Icon name="check" size={10} />
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
