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

interface WidgetClientProps {
  projects: Project[]
  userId: string
  userRole: string
  hasError?: boolean
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] tracking-[0.18em] uppercase text-ink-3 mb-2.5 flex items-center gap-2">
      <span>{children}</span>
      <span className="flex-1 border-t border-line" />
    </div>
  )
}

export function WidgetClient({ projects, userId, userRole, hasError }: WidgetClientProps) {
  const supabase = useMemo(() => createClient(), [])
  const [isPending, startTransition] = useTransition()

  const [projectId, setProjectId] = useState('')
  const [stage, setStage] = useState<StageType | ''>('')
  const [selectedViewIds, setSelectedViewIds] = useState<string[]>([])
  const [etaDate, setEtaDate] = useState('')
  const [etaWindow, setEtaWindow] = useState<TimeWindow | ''>('')

  const [views, setViews] = useState<View[]>([])
  const [viewRounds, setViewRounds] = useState<ViewRound[]>([])
  const [roundLoading, setRoundLoading] = useState(false)
  const [workflowError, setWorkflowError] = useState<string | null>(null)
  const [states, setStates] = useState<ViewState[]>([])
  const [conflictViewIds, setConflictViewIds] = useState<string[]>([])
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)

  // Block flow state
  const [showBlockPanel, setShowBlockPanel] = useState(false)
  const [blockReason, setBlockReason] = useState('')

  const project = projects.find(p => p.id === projectId) ?? null

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

      console.log('ensureProjectWorkflow result:', workflow)

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

  // ── Stage order enforcement ─────────────────────────────────────────────────
  // Admins bypass stage order. Team members must complete previous stages first.
  const isAdmin = userRole === 'admin'

  function prereqBlockedForView(viewId: string): boolean {
    if (!stage || isAdmin) return false
    const idx = STAGE_ORDER.indexOf(stage as StageType)
    if (idx === 0) return false
    const prev = STAGE_ORDER[idx - 1]
    const prevState = getState(viewId, prev)
    return !prevState || prevState.status !== 'done'
  }

  // Auto-deselect views that become prereq-blocked when stage or states change
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

  // Human-readable reason for why Start is disabled (shown below buttons)
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
        setFeedback({ ok: true, msg: 'Stage started.' })
        setSelectedViewIds([])
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
        setFeedback({ ok: true, msg: 'Stage marked done.' })
        setSelectedViewIds([])
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
        setSelectedViewIds([])
        setShowBlockPanel(false)
        setBlockReason('')
        await reloadStates()
      }
    })
  }

  if (!projects.length && !hasError) {
    return <p className="text-[13px] text-ink-3">No active projects. An admin needs to create one.</p>
  }

  return (
    <div className="space-y-6">

      {/* Project */}
      <div>
        <SectionLabel>Project</SectionLabel>
        <select
          value={projectId}
          onChange={e => {
            const next = e.target.value
            setProjectId(next)
            setSelectedViewIds([])
            setConflictViewIds([])
            setShowBlockPanel(false)
            setBlockReason('')
            setStage('')
            setEtaDate('')
            setEtaWindow('')
            setFeedback(null)
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

      {/* Loading indicator */}
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
                  setSelectedViewIds([])
                  setFeedback(null)
                  setShowBlockPanel(false)
                  setBlockReason('')
                  setConflictViewIds([])
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
          <SectionLabel>Views</SectionLabel>
          <div className="grid grid-cols-5 gap-1.5">
            {views.map(view => {
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

              return (
                <button
                  key={view.id}
                  onClick={() => !prereqBlocked && toggleView(view.id)}
                  disabled={prereqBlocked}
                  title={statusLine}
                  className={[
                    'h-10 flex flex-col items-center justify-center text-[11px] font-medium rounded border transition-colors',
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
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ETA — optional, shown whenever views are selected */}
      {selectedViewIds.length > 0 && !showBlockPanel && (
        <div>
          <SectionLabel>ETA <span className="normal-case tracking-normal text-ink-3 ml-1">— optional</span></SectionLabel>
          <div className="flex gap-2">
            <input
              type="date"
              value={etaDate}
              onChange={e => setEtaDate(e.target.value)}
              className="flex-1 px-3 py-2 bg-surface border border-line rounded-md text-[13px] text-ink focus:outline-none focus:border-accent transition-colors hover:border-line-strong [color-scheme:dark]"
            />
            <select
              value={etaWindow}
              onChange={e => setEtaWindow(e.target.value as TimeWindow)}
              className="w-28 px-3 py-2 bg-surface border border-line rounded-md text-[13px] text-ink focus:outline-none focus:border-accent transition-colors hover:border-line-strong"
            >
              <option value="">Time</option>
              {TIME_WINDOWS.map(w => <option key={w} value={w}>{w}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* Block reason panel */}
      {showBlockPanel && selectedViewIds.length > 0 && (
        <div>
          <SectionLabel>Block reason</SectionLabel>
          <select
            value={blockReason}
            onChange={e => setBlockReason(e.target.value)}
            className="w-full px-3 py-2 bg-surface border border-blocked-text/30 rounded-md text-[13px] text-ink focus:outline-none focus:border-blocked-text transition-colors"
          >
            <option value="">Select reason…</option>
            {BLOCK_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      )}

      {/* Feedback */}
      {feedback && (
        <p className={`text-[12px] ${feedback.ok ? 'text-done-text' : 'text-blocked-text'}`}>
          {feedback.msg}
        </p>
      )}

      {/* Actions */}
      {selectedViewIds.length > 0 && !showBlockPanel && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <div className="flex-1 flex flex-col gap-1">
              <button
                onClick={handleStart}
                disabled={!canStart}
                className="w-full h-9 bg-accent text-canvas text-[13px] font-medium rounded-md hover:bg-accent-dim disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {isPending ? '…' : 'Start stage'}
              </button>
              {startDisabledReason && (
                <p className="text-[10px] text-ink-3 text-center">{startDisabledReason}</p>
              )}
            </div>
            <div className="flex-1 flex flex-col gap-1">
              <button
                onClick={handleFinish}
                disabled={!canFinish}
                className="w-full h-9 bg-surface text-ink text-[13px] border border-line-strong rounded-md hover:bg-elevated disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {isPending ? '…' : 'Mark done'}
              </button>
              {finishDisabledReason && (
                <p className="text-[10px] text-ink-3 text-center">{finishDisabledReason}</p>
              )}
            </div>
            {canBlock && (
              <button
                onClick={() => setShowBlockPanel(true)}
                disabled={isPending}
                className="h-9 px-3 bg-surface text-blocked-text text-[13px] border border-blocked-text/30 rounded-md hover:bg-blocked-bg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title="Report a blocker"
              >
                Block
              </button>
            )}
          </div>
        </div>
      )}

      {/* Block confirm */}
      {showBlockPanel && selectedViewIds.length > 0 && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={handleBlock}
            disabled={isPending || !blockReason}
            className="flex-1 h-9 bg-blocked-bg text-blocked-text text-[13px] font-medium border border-blocked-text/30 rounded-md hover:bg-blocked-bg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isPending ? '…' : 'Confirm block'}
          </button>
          <button
            onClick={() => { setShowBlockPanel(false); setBlockReason('') }}
            disabled={isPending}
            className="h-9 px-3 bg-surface text-ink-2 text-[13px] border border-line rounded-md hover:bg-elevated transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Dev debug panel */}
      {process.env.NODE_ENV === 'development' && (
        <div className="mt-4 p-3 bg-surface border border-line rounded-md font-mono text-[10px] text-ink-3 space-y-0.5">
          <div>project: {projectId || '—'}</div>
          <div>rounds: {viewRounds.length > 0 ? viewRounds.length : (roundLoading ? 'loading…' : '—')}</div>
          <div>stage:   {stage || '—'}</div>
          <div>views:   {selectedViewIds.length ? selectedViewIds.map(id => views.find(v => v.id === id)?.label ?? id).join(', ') : '—'}</div>
          <div>canStart: {String(canStart)} · canFinish: {String(canFinish)} · canBlock: {String(canBlock)}</div>
          {workflowError && <div className="text-blocked-text">workflow error: {workflowError}</div>}
          {startDisabledReason && <div>start blocked: {startDisabledReason}</div>}
          {finishDisabledReason && <div>finish blocked: {finishDisabledReason}</div>}
        </div>
      )}
    </div>
  )
}
