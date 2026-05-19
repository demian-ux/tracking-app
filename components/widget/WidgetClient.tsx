'use client'

import { useState, useEffect, useMemo, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { startStage, finishStage, blockStage, ensureProjectWorkflow } from '@/lib/actions/stages'
import type { StageType, TimeWindow } from '@/lib/types/database'
import { STAGE_LABELS, STAGE_ORDER, TIME_WINDOWS, BLOCK_REASONS } from '@/lib/types/app'
import { formatDelivery } from '@/lib/utils/formatting'

interface Project {
  id: string
  name: string
  status: string
  delivery_date: string | null
  delivery_time_window: TimeWindow | null
  current_round_number: number
  view_count: number
  clients: { name: string } | null
}

interface ViewState {
  id: string
  project_view_id: string
  stage: StageType
  status: string
  assigned_user_id: string | null
  latest_eta_date: string | null
  latest_eta_time_window: TimeWindow | null
  block_reason: string | null
}

interface View {
  id: string
  number: number
  label: string
}

interface ViewRound {
  id: string
  project_view_id: string
  round_number: number
  status: string
}

interface TeamMember {
  id: string
  name: string
}

interface WidgetClientProps {
  projects: Project[]
  userId: string
  userRole: string
  users: TeamMember[]
  hasError?: boolean
}

type ViewFilter = 'all' | 'mine' | 'available' | 'blocked' | 'done'

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] tracking-[0.18em] uppercase text-ink-3 mb-2.5 flex items-center gap-2">
      <span>{children}</span>
      <span className="flex-1 border-t border-line" />
    </div>
  )
}

function initials(name: string): string {
  return name.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

export function WidgetClient({ projects, userId, userRole, users, hasError }: WidgetClientProps) {
  const supabase = useMemo(() => createClient(), [])
  const [isPending, startTransition] = useTransition()

  const [projectId, setProjectId] = useState('')
  const [stage, setStage] = useState<StageType | ''>('')
  const [selectedViewIds, setSelectedViewIds] = useState<string[]>([])
  const [etaDate, setEtaDate] = useState('')
  const [etaWindow, setEtaWindow] = useState<TimeWindow | ''>('')
  const [viewFilter, setViewFilter] = useState<ViewFilter>('all')

  const [views, setViews] = useState<View[]>([])
  const [viewRounds, setViewRounds] = useState<ViewRound[]>([])
  const [roundLoading, setRoundLoading] = useState(false)
  const [workflowError, setWorkflowError] = useState<string | null>(null)
  const [states, setStates] = useState<ViewState[]>([])
  const [conflictViewIds, setConflictViewIds] = useState<string[]>([])
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)

  const [showBlockPanel, setShowBlockPanel] = useState(false)
  const [blockReason, setBlockReason] = useState('')

  const project = projects.find(p => p.id === projectId) ?? null
  const usersById = useMemo(() => Object.fromEntries(users.map(u => [u.id, u])), [users])

  // Load workflow when project changes
  useEffect(() => {
    if (!projectId) return
    let cancelled = false

    async function load() {
      const [viewsResult, workflow] = await Promise.all([
        supabase
          .from('project_views')
          .select('*')
          .eq('project_id', projectId)
          .eq('active', true)
          .order('number', { ascending: true }),
        ensureProjectWorkflow(projectId),
      ])

      if (cancelled) return
      setRoundLoading(false)

      if (viewsResult.error) {
        setFeedback({ ok: false, msg: viewsResult.error.message })
        return
      }

      setViews(viewsResult.data ?? [])

      if (workflow.error) {
        setWorkflowError(workflow.error)
        setViewRounds([])
        setStates([])
      } else if (workflow.data) {
        setWorkflowError(null)
        setViewRounds(workflow.data.rounds as ViewRound[])
        setStates((workflow.data.states ?? []) as ViewState[])
      } else {
        setWorkflowError('Workflow returned no data.')
        setViewRounds([])
        setStates([])
      }
    }

    load()
    return () => { cancelled = true }
  }, [projectId, supabase])

  async function reloadStates() {
    if (viewRounds.length === 0) return
    const roundIds = viewRounds.map(r => r.id)
    const { data } = await supabase
      .from('view_stage_states')
      .select('*')
      .in('project_view_round_id', roundIds)
    setStates((data ?? []) as ViewState[])
  }

  function getState(viewId: string, s: StageType) {
    return states.find(x => x.project_view_id === viewId && x.stage === s)
  }

  function toggleView(viewId: string) {
    setSelectedViewIds(prev =>
      prev.includes(viewId) ? prev.filter(id => id !== viewId) : [...prev, viewId]
    )
    setConflictViewIds([])
    setFeedback(null)
    setShowBlockPanel(false)
    setBlockReason('')
  }

  function clearSelection() {
    setSelectedViewIds([])
    setConflictViewIds([])
    setFeedback(null)
    setShowBlockPanel(false)
    setBlockReason('')
    setEtaDate('')
    setEtaWindow('')
  }

  // ── Stage order enforcement ─────────────────────────────────────────────────
  const isAdmin = userRole === 'admin'

  function prereqBlockedForView(viewId: string): boolean {
    if (!stage || isAdmin) return false
    const idx = STAGE_ORDER.indexOf(stage as StageType)
    if (idx === 0) return false
    const prev = STAGE_ORDER[idx - 1]
    const prevState = getState(viewId, prev)
    return !prevState || prevState.status !== 'done'
  }

  useEffect(() => {
    if (!stage || isAdmin) return
    const idx = STAGE_ORDER.indexOf(stage as StageType)
    if (idx === 0) return
    const prev = STAGE_ORDER[idx - 1]
    setSelectedViewIds(ids =>
      ids.filter(vid => {
        const s = states.find(x => x.project_view_id === vid && x.stage === prev)
        return s?.status === 'done'
      })
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, states])

  const stageOrderBlock = (() => {
    if (!stage || selectedViewIds.length === 0 || isAdmin) return null
    const idx = STAGE_ORDER.indexOf(stage as StageType)
    if (idx === 0) return null
    const prev = STAGE_ORDER[idx - 1]
    const blocked = selectedViewIds.filter(vid => {
      const s = getState(vid, prev)
      return !s || s.status !== 'done'
    })
    if (blocked.length === 0) return null
    const labels = blocked.map(vid => views.find(v => v.id === vid)?.label ?? vid)
    return `Finish ${STAGE_LABELS[prev]} first for: ${labels.join(', ')}`
  })()

  // ── Quick filter ────────────────────────────────────────────────────────────
  const filteredViews = views.filter(view => {
    if (!stage || viewFilter === 'all') return true
    const s = getState(view.id, stage as StageType)
    switch (viewFilter) {
      case 'mine':      return s?.status === 'in_progress' && s.assigned_user_id === userId
      case 'available': return s?.status === 'not_started' || s?.status === 'reopened'
      case 'blocked':   return s?.status === 'blocked'
      case 'done':      return s?.status === 'done'
      default:          return true
    }
  })

  // ── Action eligibility ──────────────────────────────────────────────────────
  const selectedStates = selectedViewIds
    .map(id => (stage ? getState(id, stage as StageType) : undefined))
    .filter((s): s is ViewState => s !== undefined)

  const allSelectedHaveState =
    stage !== '' &&
    selectedStates.length === selectedViewIds.length &&
    selectedViewIds.length > 0

  const canStart =
    !isPending &&
    viewRounds.length > 0 &&
    !roundLoading &&
    !!stage &&
    allSelectedHaveState &&
    !stageOrderBlock &&
    selectedStates.every(s => s.status === 'not_started' || s.status === 'reopened')

  const canFinish =
    !isPending &&
    viewRounds.length > 0 &&
    !roundLoading &&
    !!stage &&
    allSelectedHaveState &&
    selectedStates.every(
      s => s.status === 'in_progress' && s.assigned_user_id === userId
    )

  const canBlock =
    !isPending &&
    viewRounds.length > 0 &&
    !roundLoading &&
    !!stage &&
    allSelectedHaveState &&
    selectedStates.every(
      s => s.status === 'in_progress' && s.assigned_user_id === userId
    )

  const startDisabledReason: string | null = (() => {
    if (isPending) return null
    if (!projectId) return null
    if (roundLoading) return 'Loading workflow…'
    if (workflowError) return workflowError
    if (viewRounds.length === 0) return 'Could not load active rounds'
    if (!stage) return null
    if (selectedViewIds.length === 0) return null
    if (stageOrderBlock) return stageOrderBlock
    if (!allSelectedHaveState) return 'Stage data still loading'
    if (selectedStates.some(s => s.status === 'done')) return 'Already done'
    if (selectedStates.some(s => s.status === 'blocked')) return 'Blocked — ask admin to unblock'
    if (selectedStates.some(s => s.status === 'in_progress')) return 'Already in progress'
    return null
  })()

  const finishDisabledReason: string | null = (() => {
    if (isPending || viewRounds.length === 0 || roundLoading || !stage || selectedViewIds.length === 0) return null
    if (!allSelectedHaveState) return 'Stage data still loading'
    if (selectedStates.some(s => s.status !== 'in_progress')) return 'Start this stage first'
    if (selectedStates.some(s => s.assigned_user_id !== userId)) return 'Assigned to someone else'
    return null
  })()

  const progress = states.length > 0
    ? Math.round(states.filter(s => s.status === 'done').length / states.length * 100)
    : 0

  // ── Handlers ────────────────────────────────────────────────────────────────
  function handleStart() {
    if (!canStart) return
    setFeedback(null)
    startTransition(async () => {
      const result = await startStage({
        projectId,
        viewIds: selectedViewIds,
        stage: stage as StageType,
        etaDate: etaDate || null,
        etaTimeWindow: (etaWindow || null) as TimeWindow | null,
      })
      if (result.error === 'conflict') {
        setConflictViewIds('conflictingViewIds' in result ? result.conflictingViewIds ?? [] : [])
        setFeedback({ ok: false, msg: 'Conflict — those views are already in progress by someone else.' })
      } else if (result.error) {
        setFeedback({ ok: false, msg: result.error })
      } else {
        setFeedback({ ok: true, msg: `Started ${selectedViewIds.length} view${selectedViewIds.length > 1 ? 's' : ''}.` })
        clearSelection()
        await reloadStates()
      }
    })
  }

  function handleFinish() {
    if (!canFinish) return
    setFeedback(null)
    startTransition(async () => {
      const result = await finishStage({
        projectId,
        viewIds: selectedViewIds,
        stage: stage as StageType,
      })
      if (result.error) {
        setFeedback({ ok: false, msg: result.error })
      } else {
        setFeedback({ ok: true, msg: `Marked ${selectedViewIds.length} view${selectedViewIds.length > 1 ? 's' : ''} done.` })
        clearSelection()
        await reloadStates()
      }
    })
  }

  function handleBlock() {
    if (!canBlock || !blockReason) return
    setFeedback(null)
    startTransition(async () => {
      const result = await blockStage(
        projectId, selectedViewIds, stage as StageType, blockReason,
      )
      if (result.error) {
        setFeedback({ ok: false, msg: result.error })
      } else {
        setFeedback({ ok: true, msg: 'Marked as blocked.' })
        clearSelection()
        await reloadStates()
      }
    })
  }

  const barVisible = selectedViewIds.length > 0

  if (!projects.length && !hasError) {
    return <p className="text-[13px] text-ink-3">No active projects. An admin needs to create one.</p>
  }

  return (
    <div className={barVisible ? 'space-y-6 pb-52' : 'space-y-6'}>

      {/* Project */}
      <div>
        <SectionLabel>Project</SectionLabel>
        <select
          value={projectId}
          onChange={e => {
            const next = e.target.value
            setProjectId(next)
            clearSelection()
            setStage('')
            setViewFilter('all')
            setWorkflowError(null)
            setViewRounds([])
            setStates([])
            setViews([])
            setRoundLoading(!!next)
          }}
          className="w-full px-3 py-2 bg-surface border border-line rounded-md text-[13px] text-ink focus:outline-none focus:border-accent transition-colors hover:border-line-strong"
        >
          <option value="">Select project…</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>
              {p.clients?.name ? `${p.clients.name} / ` : ''}{p.name}
            </option>
          ))}
        </select>
      </div>

      {roundLoading && (
        <p className="text-[11px] text-ink-3">Loading workflow…</p>
      )}

      {/* Project info strip */}
      {project && viewRounds.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-4 text-[11px] text-ink-2">
            <span>{formatDelivery(project.delivery_date, project.delivery_time_window)}</span>
            <span className="text-ink-3">·</span>
            <span>{project.view_count} views</span>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="flex-1 bg-line-strong rounded-full h-[2px]">
              <div
                className="bg-accent h-[2px] rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-[10px] text-ink-3 tabular-nums w-7 text-right shrink-0">{progress}%</span>
          </div>
        </div>
      )}

      {/* Stage */}
      {projectId && !roundLoading && (
        <div>
          <SectionLabel>Stage</SectionLabel>
          <div className="flex gap-1.5">
            {STAGE_ORDER.map(s => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setStage(s)
                  clearSelection()
                  setViewFilter('all')
                }}
                className={[
                  'flex-1 py-2 text-[12px] font-medium rounded-md border transition-colors',
                  stage === s
                    ? 'bg-accent text-canvas border-accent'
                    : 'bg-surface text-ink-2 border-line hover:border-line-strong hover:text-ink',
                ].join(' ')}
              >
                {STAGE_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Views */}
      {stage && views.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <div className="text-[10px] tracking-[0.18em] uppercase text-ink-3 flex items-center gap-2">
              <span>Views</span>
              <span className="flex-1 border-t border-line w-4" />
            </div>
            {/* Quick filters */}
            <div className="flex gap-1">
              {(['all', 'mine', 'available', 'blocked', 'done'] as ViewFilter[]).map(f => (
                <button
                  key={f}
                  onClick={() => {
                    setViewFilter(f)
                    setSelectedViewIds(ids => ids.filter(id => {
                      if (f === 'all') return true
                      const s = getState(id, stage as StageType)
                      switch (f) {
                        case 'mine':      return s?.status === 'in_progress' && s.assigned_user_id === userId
                        case 'available': return s?.status === 'not_started' || s?.status === 'reopened'
                        case 'blocked':   return s?.status === 'blocked'
                        case 'done':      return s?.status === 'done'
                        default:          return true
                      }
                    }))
                  }}
                  className={[
                    'px-2 py-0.5 text-[10px] rounded transition-colors',
                    viewFilter === f
                      ? 'bg-elevated text-ink border border-line-strong'
                      : 'text-ink-3 hover:text-ink-2',
                  ].join(' ')}
                >
                  {f === 'all' ? 'All' : f === 'mine' ? 'Mine' : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-5 gap-1.5">
            {filteredViews.map(view => {
              const s = getState(view.id, stage as StageType)
              const selected = selectedViewIds.includes(view.id)
              const conflict = conflictViewIds.includes(view.id)
              const prereqBlocked = prereqBlockedForView(view.id)
              const isDone = s?.status === 'done'
              const isMine = s?.status === 'in_progress' && s.assigned_user_id === userId
              const isOther = s?.status === 'in_progress' && s.assigned_user_id !== userId
              const isBlocked = s?.status === 'blocked'
              const isReopened = s?.status === 'reopened'

              const idx = STAGE_ORDER.indexOf(stage as StageType)
              const prevStage = idx > 0 ? STAGE_ORDER[idx - 1] : null
              const prereqTitle = prereqBlocked && prevStage
                ? `Finish ${STAGE_LABELS[prevStage]} first`
                : null

              const statusLine = prereqBlocked
                ? (prereqTitle ?? 'Prerequisite incomplete')
                : isDone ? 'Done'
                : isMine ? 'In progress · you'
                : isOther ? 'In progress · other'
                : isBlocked ? (s?.block_reason ?? 'Blocked')
                : isReopened ? 'Reopened'
                : 'Not started'

              // Avatar: show initials for whoever is working on this view
              const assigneeId = s?.assigned_user_id
              const assignee = assigneeId ? usersById[assigneeId] : null
              const showAvatar = (isMine || isOther) && assignee && !selected

              return (
                <button
                  key={view.id}
                  onClick={() => !prereqBlocked && toggleView(view.id)}
                  disabled={prereqBlocked}
                  title={statusLine}
                  className={[
                    'relative h-10 flex flex-col items-center justify-center text-[11px] font-medium rounded border transition-colors',
                    prereqBlocked
                      ? 'bg-surface text-ink-3 border-line opacity-50 cursor-not-allowed'
                      : selected
                        ? 'bg-accent text-canvas border-accent'
                        : conflict
                          ? 'bg-blocked-bg text-blocked-text border-blocked-text/30'
                          : isDone
                            ? 'bg-done-bg text-done-text border-done-text/20'
                            : isMine
                              ? 'bg-surface text-accent border-accent/40'
                              : isBlocked
                                ? 'bg-blocked-bg text-blocked-text border-blocked-text/30'
                                : isReopened
                                  ? 'bg-warn-bg text-warn-text border-warn-text/30'
                                  : isOther
                                    ? 'bg-surface text-ink-3 border-warn-text/30'
                                    : 'bg-surface text-ink-2 border-line hover:border-line-strong hover:text-ink',
                  ].join(' ')}
                >
                  <span>{String(view.number).padStart(2, '0')}</span>
                  {prereqBlocked && <span className="text-[8px] mt-0.5 opacity-60">—</span>}
                  {!prereqBlocked && isDone && !selected && <span className="text-[8px] mt-0.5">✓</span>}
                  {!prereqBlocked && isBlocked && !selected && <span className="text-[8px] mt-0.5">!</span>}
                  {!prereqBlocked && isReopened && !selected && <span className="text-[8px] mt-0.5">↩</span>}

                  {/* Avatar badge */}
                  {showAvatar && (
                    <span className={[
                      'absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full text-[8px] font-bold flex items-center justify-center leading-none',
                      isMine
                        ? 'bg-accent text-canvas'
                        : 'bg-warn-text text-canvas',
                    ].join(' ')}>
                      {initials(assignee.name)}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {filteredViews.length === 0 && viewFilter !== 'all' && (
            <p className="text-[11px] text-ink-3 text-center py-3">No views match this filter.</p>
          )}
        </div>
      )}

      {/* Dev debug panel */}
      {process.env.NODE_ENV === 'development' && (
        <div className="mt-4 p-3 bg-surface border border-line rounded-md font-mono text-[10px] text-ink-3 space-y-0.5">
          <div>project: {projectId || '—'}</div>
          <div>rounds: {viewRounds.length > 0 ? viewRounds.length : (roundLoading ? 'loading…' : '—')}</div>
          <div>stage:   {stage || '—'}</div>
          <div>filter:  {viewFilter}</div>
          <div>views:   {selectedViewIds.length ? selectedViewIds.map(id => views.find(v => v.id === id)?.label ?? id).join(', ') : '—'}</div>
          <div>canStart: {String(canStart)} · canFinish: {String(canFinish)} · canBlock: {String(canBlock)}</div>
          {workflowError && <div className="text-blocked-text">workflow error: {workflowError}</div>}
        </div>
      )}

      {/* ── Sticky action bar ──────────────────────────────────────────────── */}
      {barVisible && (
        <div className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none">
          <div className="max-w-[460px] mx-auto px-6 pb-6 pointer-events-auto">
            <div className="bg-elevated border border-line-strong rounded-xl shadow-2xl overflow-hidden">

              {/* Bar header */}
              <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-line">
                <div className="flex items-center gap-2 text-[12px]">
                  <span className="font-medium text-ink">
                    {selectedViewIds.length} view{selectedViewIds.length > 1 ? 's' : ''}
                  </span>
                  {stage && (
                    <>
                      <span className="text-ink-3">·</span>
                      <span className="text-ink-2">{STAGE_LABELS[stage as StageType]}</span>
                    </>
                  )}
                </div>
                <button
                  onClick={clearSelection}
                  className="text-[11px] text-ink-3 hover:text-ink-2 transition-colors px-1.5 py-0.5 rounded hover:bg-surface"
                >
                  Clear
                </button>
              </div>

              <div className="px-4 py-3 space-y-3">
                {/* Feedback */}
                {feedback && (
                  <p className={`text-[11px] ${feedback.ok ? 'text-done-text' : 'text-blocked-text'}`}>
                    {feedback.msg}
                  </p>
                )}

                {/* ETA row (normal mode) */}
                {!showBlockPanel && (
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={etaDate}
                      onChange={e => setEtaDate(e.target.value)}
                      className="flex-1 px-2.5 py-1.5 bg-surface border border-line rounded-md text-[12px] text-ink focus:outline-none focus:border-accent transition-colors [color-scheme:dark]"
                      placeholder="ETA date"
                    />
                    <select
                      value={etaWindow}
                      onChange={e => setEtaWindow(e.target.value as TimeWindow)}
                      className="w-28 px-2.5 py-1.5 bg-surface border border-line rounded-md text-[12px] text-ink focus:outline-none focus:border-accent transition-colors"
                    >
                      <option value="">Time</option>
                      {TIME_WINDOWS.map(w => <option key={w} value={w}>{w}</option>)}
                    </select>
                  </div>
                )}

                {/* Block reason (block mode) */}
                {showBlockPanel && (
                  <select
                    value={blockReason}
                    onChange={e => setBlockReason(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-surface border border-blocked-text/30 rounded-md text-[12px] text-ink focus:outline-none focus:border-blocked-text transition-colors"
                  >
                    <option value="">Select reason…</option>
                    {BLOCK_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                )}

                {/* Disabled reason hint */}
                {!showBlockPanel && !canStart && startDisabledReason && selectedViewIds.length > 0 && (
                  <p className="text-[10px] text-ink-3">{startDisabledReason}</p>
                )}
                {!showBlockPanel && !canFinish && finishDisabledReason && selectedViewIds.length > 0 && (
                  <p className="text-[10px] text-ink-3">{finishDisabledReason}</p>
                )}

                {/* Action buttons */}
                {!showBlockPanel ? (
                  <div className="flex gap-2">
                    <button
                      onClick={handleStart}
                      disabled={!canStart}
                      className="flex-1 h-9 bg-accent text-canvas text-[13px] font-medium rounded-lg hover:bg-accent-dim disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {isPending ? '…' : 'Start'}
                    </button>
                    <button
                      onClick={handleFinish}
                      disabled={!canFinish}
                      className="flex-1 h-9 bg-surface text-ink text-[13px] border border-line-strong rounded-lg hover:bg-canvas disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {isPending ? '…' : 'Mark done'}
                    </button>
                    {canBlock && (
                      <button
                        onClick={() => setShowBlockPanel(true)}
                        disabled={isPending}
                        className="h-9 px-3 bg-surface text-blocked-text text-[13px] border border-blocked-text/30 rounded-lg hover:bg-blocked-bg disabled:opacity-40 transition-colors"
                      >
                        Block
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={handleBlock}
                      disabled={isPending || !blockReason}
                      className="flex-1 h-9 bg-blocked-bg text-blocked-text text-[13px] font-medium border border-blocked-text/30 rounded-lg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {isPending ? '…' : 'Confirm block'}
                    </button>
                    <button
                      onClick={() => { setShowBlockPanel(false); setBlockReason('') }}
                      disabled={isPending}
                      className="h-9 px-3 bg-surface text-ink-2 text-[13px] border border-line rounded-lg hover:bg-canvas transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
