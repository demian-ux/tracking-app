'use client'

import { useState, useEffect, useMemo, useTransition, useCallback, memo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { startStage, finishStage, blockStage, ensureProjectWorkflow, undoStageAction, resetStage } from '@/lib/actions/stages'
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
type PendingAction = 'start' | 'done' | 'reset' | 'block' | 'undo' | null

interface UndoState {
  msg: string
  restores: { id: string; status: string; assigned_user_id: string | null }[]
  timerId: ReturnType<typeof setTimeout>
}

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

interface ViewCellProps {
  view: { id: string; number: number; label: string }
  state: ViewState | undefined
  selected: boolean
  conflict: boolean
  prereqBlocked: boolean
  prevStageName: string | null
  userId: string
  assignee: { name: string } | null
  onToggle: (viewId: string) => void
}

const ViewCell = memo(function ViewCell({
  view, state, selected, conflict, prereqBlocked, prevStageName, userId, assignee, onToggle,
}: ViewCellProps) {
  const isDone = state?.status === 'done'
  const isMine = state?.status === 'in_progress' && state.assigned_user_id === userId
  const isOther = state?.status === 'in_progress' && state.assigned_user_id !== userId
  const isBlocked = state?.status === 'blocked'
  const isReopened = state?.status === 'reopened'
  const showAvatar = (isMine || isOther) && assignee && !selected

  const statusLine = prereqBlocked
    ? (prevStageName ? `Finish ${prevStageName} first` : 'Prerequisite incomplete')
    : isDone ? 'Done'
    : isMine ? 'In progress · you'
    : isOther ? 'In progress · other'
    : isBlocked ? (state?.block_reason ?? 'Blocked')
    : isReopened ? 'Reopened'
    : 'Not started'

  return (
    <button
      type="button"
      onClick={() => !prereqBlocked && onToggle(view.id)}
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
      {showAvatar && (
        <span className={[
          'absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full text-[8px] font-bold flex items-center justify-center leading-none',
          isMine ? 'bg-accent text-canvas' : 'bg-warn-text text-canvas',
        ].join(' ')}>
          {initials(assignee.name)}
        </span>
      )}
    </button>
  )
})

export function WidgetClient({ projects, userId, userRole, users, hasError }: WidgetClientProps) {
  const supabase = useMemo(() => createClient(), [])
  const [isPending, startTransition] = useTransition()
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)

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
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [undoState, setUndoState] = useState<UndoState | null>(null)

  const project = projects.find(p => p.id === projectId) ?? null
  const usersById = useMemo(() => Object.fromEntries(users.map(u => [u.id, u])), [users])

  function debugLog(label: string, payload?: unknown) {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[Widget] ${label}`, payload ?? '')
    }
  }

  function debugError(label: string, error: unknown) {
    if (process.env.NODE_ENV === 'development') {
      console.error(`[Widget] ${label}`, error)
    }
  }

  function debugGate(action: string, reason: string | null) {
    debugLog(`${action} gate`, {
      reason,
      startDisabledReason,
      finishDisabledReason,
      pendingAction,
      projectId,
      rounds: viewRounds,
      stage,
      selectedViewIds,
    })
  }

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

  const stateByViewStage = useMemo(() => {
    const map = new Map<string, ViewState>()
    for (const s of states) {
      map.set(`${s.project_view_id}:${s.stage}`, s)
    }
    return map
  }, [states])

  function getState(viewId: string, s: StageType) {
    return stateByViewStage.get(`${viewId}:${s}`)
  }

  function mergeStates(updated: Partial<ViewState>[]) {
    const byId = new Map(updated.map(s => [s.id!, s]))
    setStates(prev => {
      const mergedStates = prev.map(s => {
        const u = byId.get(s.id)
        return u ? { ...s, ...u } : s
      })
      debugLog('Merged states', mergedStates)
      return mergedStates
    })
  }

  const toggleView = useCallback((viewId: string) => {
    setSelectedViewIds(prev =>
      prev.includes(viewId) ? prev.filter(id => id !== viewId) : [...prev, viewId]
    )
    setConflictViewIds([])
    setFeedback(null)
    setShowBlockPanel(false)
    setBlockReason('')
  }, [])

  function clearSelection() {
    setSelectedViewIds([])
    setConflictViewIds([])
    setFeedback(null)
    setShowBlockPanel(false)
    setBlockReason('')
    setShowResetConfirm(false)
    setEtaDate('')
    setEtaWindow('')
  }

  // ── Stage order enforcement ─────────────────────────────────────────────────
  const isAdmin = userRole === 'admin'

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
    !pendingAction &&
    viewRounds.length > 0 &&
    !roundLoading &&
    !!stage &&
    allSelectedHaveState &&
    !stageOrderBlock &&
    selectedStates.every(s => s.status === 'not_started' || s.status === 'reopened')

  const canFinish =
    !isPending &&
    !pendingAction &&
    viewRounds.length > 0 &&
    !roundLoading &&
    !!stage &&
    allSelectedHaveState &&
    selectedStates.every(
      s => s.status === 'in_progress' && s.assigned_user_id === userId
    )

  const canBlock =
    !isPending &&
    !pendingAction &&
    viewRounds.length > 0 &&
    !roundLoading &&
    !!stage &&
    allSelectedHaveState &&
    selectedStates.every(
      s => s.status === 'in_progress' && s.assigned_user_id === userId
    )

  const startDisabledReason: string | null = (() => {
    if (isPending) return null
    if (pendingAction) return `Waiting for ${pendingAction} to finish`
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
    if (pendingAction) return `Waiting for ${pendingAction} to finish`
    if (!allSelectedHaveState) return 'Stage data still loading'
    if (selectedStates.some(s => s.status !== 'in_progress')) return 'Start this stage first'
    if (selectedStates.some(s => s.assigned_user_id !== userId)) return 'Assigned to someone else'
    return null
  })()

  const canReset =
    !isPending &&
    !pendingAction &&
    viewRounds.length > 0 &&
    !!stage &&
    selectedViewIds.length > 0 &&
    allSelectedHaveState &&
    selectedStates.some(s => s.status !== 'not_started') &&
    (isAdmin || selectedStates.some(s => s.assigned_user_id === userId))

  // Stages later than selected that have non-not_started states in selected views
  const cascadeStages = (() => {
    if (!stage) return [] as typeof STAGE_ORDER
    const idx = STAGE_ORDER.indexOf(stage as StageType)
    return STAGE_ORDER.slice(idx + 1).filter(laterStage =>
      selectedViewIds.some(viewId => {
        const s = getState(viewId, laterStage)
        return s && s.status !== 'not_started'
      })
    )
  })()

  const progress = states.length > 0
    ? Math.round(states.filter(s => s.status === 'done').length / states.length * 100)
    : 0

  // ── Handlers ────────────────────────────────────────────────────────────────
  function armUndo(msg: string, restores: UndoState['restores']) {
    if (undoState) clearTimeout(undoState.timerId)
    const timerId = setTimeout(() => setUndoState(null), 12000)
    setUndoState({ msg, restores, timerId })
  }

  function rollback(snapshot: { id: string; status: string; assigned_user_id: string | null; block_reason?: string | null; latest_eta_date?: string | null; latest_eta_time_window?: TimeWindow | null }[]) {
    setStates(prev => prev.map(s => {
      const r = snapshot.find(x => x.id === s.id)
      if (!r) return s
      return {
        ...s,
        status: r.status as ViewState['status'],
        assigned_user_id: r.assigned_user_id,
        ...(r.block_reason !== undefined ? { block_reason: r.block_reason } : {}),
        ...(r.latest_eta_date !== undefined ? { latest_eta_date: r.latest_eta_date } : {}),
        ...(r.latest_eta_time_window !== undefined ? { latest_eta_time_window: r.latest_eta_time_window } : {}),
      }
    }))
  }

  function handleStart() {
    debugLog('START clicked')
    debugGate('START', canStart ? null : (startDisabledReason ?? 'Start is unavailable'))
    if (!canStart) {
      setFeedback({ ok: false, msg: startDisabledReason ?? 'Start is unavailable.' })
      return
    }
    setFeedback(null)
    const snapshot = selectedStates.map(s => ({
      id: s.id, status: s.status, assigned_user_id: s.assigned_user_id,
    }))
    const count = selectedViewIds.length
    const viewIdsCopy = [...selectedViewIds]
    const stageCopy = stage as StageType
    const etaDateCopy = etaDate || null
    const etaWindowCopy = (etaWindow || null) as TimeWindow | null

    setStates(prev => prev.map(s =>
      viewIdsCopy.includes(s.project_view_id) && s.stage === stageCopy
        ? { ...s, status: 'in_progress', assigned_user_id: userId, latest_eta_date: etaDateCopy, latest_eta_time_window: etaWindowCopy }
        : s
    ))
    clearSelection()
    setPendingAction('start')

    startTransition(async () => {
      try {
        debugLog('Calling startStage...', { projectId, viewIds: viewIdsCopy, stage: stageCopy, etaDate: etaDateCopy, etaTimeWindow: etaWindowCopy })
        const result = await startStage({
        projectId,
        viewIds: viewIdsCopy,
        stage: stageCopy,
        etaDate: etaDateCopy,
        etaTimeWindow: etaWindowCopy,
        })
        debugLog('startStage result', result)
      if (result.error === 'conflict') {
        rollback(snapshot)
        setConflictViewIds('conflictingViewIds' in result ? result.conflictingViewIds ?? [] : [])
        setFeedback({ ok: false, msg: 'Conflict — those views are already in progress by someone else.' })
      } else if (result.error) {
        rollback(snapshot)
        setFeedback({ ok: false, msg: result.error })
        debugError('startStage error', result.error)
      } else {
        if (result.data?.updatedStates?.length) mergeStates(result.data.updatedStates as Partial<ViewState>[])
        armUndo(`Started ${count} view${count > 1 ? 's' : ''}`, snapshot)
      }
      } catch (error) {
        rollback(snapshot)
        setFeedback({ ok: false, msg: error instanceof Error ? error.message : 'Start failed.' })
        debugError('startStage exception', error)
      } finally {
        setPendingAction(null)
      }
    })
  }

  function handleFinish() {
    debugLog('DONE clicked')
    debugGate('DONE', canFinish ? null : (finishDisabledReason ?? 'Mark done is unavailable'))
    if (!canFinish) {
      setFeedback({ ok: false, msg: finishDisabledReason ?? 'Mark done is unavailable.' })
      return
    }
    setFeedback(null)
    const snapshot = selectedStates.map(s => ({
      id: s.id, status: s.status, assigned_user_id: s.assigned_user_id,
    }))
    const count = selectedViewIds.length
    const viewIdsCopy = [...selectedViewIds]
    const stageCopy = stage as StageType

    setStates(prev => prev.map(s =>
      viewIdsCopy.includes(s.project_view_id) && s.stage === stageCopy
        ? { ...s, status: 'done' }
        : s
    ))
    clearSelection()
    setPendingAction('done')

    startTransition(async () => {
      try {
        debugLog('Calling finishStage...', { projectId, viewIds: viewIdsCopy, stage: stageCopy })
        const result = await finishStage({
        projectId,
        viewIds: viewIdsCopy,
        stage: stageCopy,
      })
        debugLog('finishStage result', result)
      if (result.error) {
        rollback(snapshot)
        setFeedback({ ok: false, msg: result.error })
        debugError('finishStage error', result.error)
      } else {
        if (result.data?.updatedStates?.length) mergeStates(result.data.updatedStates as Partial<ViewState>[])
        armUndo(`Marked ${count} view${count > 1 ? 's' : ''} done`, snapshot)
      }
      } catch (error) {
        rollback(snapshot)
        setFeedback({ ok: false, msg: error instanceof Error ? error.message : 'Mark done failed.' })
        debugError('finishStage exception', error)
      } finally {
        setPendingAction(null)
      }
    })
  }

  function handleReset() {
    debugLog('RESET clicked')
    debugGate('RESET', canReset ? null : 'Reset is unavailable')
    if (!canReset) {
      setFeedback({ ok: false, msg: 'Reset is unavailable for this selection.' })
      return
    }
    setFeedback(null)
    const stageIdx = STAGE_ORDER.indexOf(stage as StageType)
    const stagesToReset = STAGE_ORDER.slice(stageIdx)
    const snapshot = states
      .filter(s => selectedViewIds.includes(s.project_view_id) && stagesToReset.includes(s.stage))
      .map(s => ({ id: s.id, status: s.status, assigned_user_id: s.assigned_user_id, block_reason: s.block_reason, latest_eta_date: s.latest_eta_date, latest_eta_time_window: s.latest_eta_time_window }))
    const viewIdsCopy = [...selectedViewIds]
    const stageCopy = stage as StageType

    setStates(prev => prev.map(s =>
      viewIdsCopy.includes(s.project_view_id) && stagesToReset.includes(s.stage)
        ? { ...s, status: 'not_started', assigned_user_id: null, latest_eta_date: null, latest_eta_time_window: null, block_reason: null }
        : s
    ))
    setShowResetConfirm(false)
    setSelectedViewIds([])
    setPendingAction('reset')

    startTransition(async () => {
      try {
        debugLog('Calling resetStage...', { projectId, viewIds: viewIdsCopy, stage: stageCopy })
        const result = await resetStage(projectId, viewIdsCopy, stageCopy)
        debugLog('resetStage result', result)
        if (result.error) {
          rollback(snapshot)
          setFeedback({ ok: false, msg: result.error })
          debugError('resetStage error', result.error)
        } else if (result.data?.updatedStates?.length) {
          mergeStates(result.data.updatedStates as Partial<ViewState>[])
        }
      } catch (error) {
        rollback(snapshot)
        setFeedback({ ok: false, msg: error instanceof Error ? error.message : 'Reset failed.' })
        debugError('resetStage exception', error)
      } finally {
        setPendingAction(null)
      }
    })
  }

  async function handleUndo() {
    debugLog('UNDO clicked')
    if (!undoState) {
      debugGate('UNDO', 'No undo state')
      return
    }
    clearTimeout(undoState.timerId)
    const restoresCopy = undoState.restores
    setUndoState(null)
    rollback(restoresCopy)
    setPendingAction('undo')
    try {
      debugLog('Calling undoStageAction...', { projectId, restores: restoresCopy })
      const result = await undoStageAction(projectId, restoresCopy)
      debugLog('undoStageAction result', result)
      if (result.error) {
        setFeedback({ ok: false, msg: result.error })
        debugError('undoStageAction error', result.error)
        await reloadStates()
      }
    } catch (error) {
      setFeedback({ ok: false, msg: error instanceof Error ? error.message : 'Undo failed.' })
      debugError('undoStageAction exception', error)
      await reloadStates()
    } finally {
      setPendingAction(null)
    }
  }

  function handleBlock() {
    debugLog('BLOCK clicked')
    debugGate('BLOCK', canBlock && blockReason ? null : (!blockReason ? 'Select a block reason' : 'Block is unavailable'))
    if (!canBlock || !blockReason) {
      setFeedback({ ok: false, msg: !blockReason ? 'Select a block reason.' : 'Block is unavailable for this selection.' })
      return
    }
    setFeedback(null)
    const snapshot = selectedStates.map(s => ({
      id: s.id, status: s.status, assigned_user_id: s.assigned_user_id,
    }))
    const viewIdsCopy = [...selectedViewIds]
    const stageCopy = stage as StageType
    const reasonCopy = blockReason

    setStates(prev => prev.map(s =>
      viewIdsCopy.includes(s.project_view_id) && s.stage === stageCopy
        ? { ...s, status: 'blocked', block_reason: reasonCopy }
        : s
    ))
    clearSelection()
    setPendingAction('block')

    startTransition(async () => {
      try {
        debugLog('Calling blockStage...', { projectId, viewIds: viewIdsCopy, stage: stageCopy, reason: reasonCopy })
        const result = await blockStage(projectId, viewIdsCopy, stageCopy, reasonCopy)
        debugLog('blockStage result', result)
        if (result.error) {
          rollback(snapshot)
          setFeedback({ ok: false, msg: result.error })
          debugError('blockStage error', result.error)
        } else if (result.data?.updatedStates?.length) {
          mergeStates(result.data.updatedStates as Partial<ViewState>[])
        }
      } catch (error) {
        rollback(snapshot)
        setFeedback({ ok: false, msg: error instanceof Error ? error.message : 'Block failed.' })
        debugError('blockStage exception', error)
      } finally {
        setPendingAction(null)
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
          {/* Views header: label + select all + filters */}
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2">
              <span className="text-[10px] tracking-[0.18em] uppercase text-ink-3">Views</span>
              {(() => {
                const stageIdx = STAGE_ORDER.indexOf(stage as StageType)
                const prevStage = stageIdx > 0 ? STAGE_ORDER[stageIdx - 1] : null
                const eligible = filteredViews.filter(v => {
                  if (isAdmin || !prevStage) return true
                  const prereqState = getState(v.id, prevStage)
                  return prereqState?.status === 'done'
                })
                const allSelected = eligible.length > 0 && eligible.every(v => selectedViewIds.includes(v.id))
                return eligible.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (allSelected) {
                        setSelectedViewIds([])
                      } else {
                        setSelectedViewIds(eligible.map(v => v.id))
                        setConflictViewIds([])
                        setFeedback(null)
                      }
                    }}
                    className="text-[10px] text-ink-3 hover:text-ink-2 transition-colors"
                  >
                    {allSelected ? 'Clear' : 'Select all'}
                  </button>
                ) : null
              })()}
            </div>
            {/* Quick filters */}
            <div className="flex gap-1">
              {(['all', 'mine', 'available', 'blocked', 'done'] as ViewFilter[]).map(f => (
                <button
                  type="button"
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
              const stageIdx = STAGE_ORDER.indexOf(stage as StageType)
              const prevStage = stageIdx > 0 ? STAGE_ORDER[stageIdx - 1] : null
              const s = getState(view.id, stage as StageType)
              const prereqState = prevStage ? getState(view.id, prevStage) : null
              const prereqBlocked = !isAdmin && !!prevStage && (!prereqState || prereqState.status !== 'done')
              const assigneeId = s?.assigned_user_id
              const assignee = assigneeId ? usersById[assigneeId] : null
              return (
                <ViewCell
                  key={view.id}
                  view={view}
                  state={s}
                  selected={selectedViewIds.includes(view.id)}
                  conflict={conflictViewIds.includes(view.id)}
                  prereqBlocked={prereqBlocked}
                  prevStageName={prevStage ? STAGE_LABELS[prevStage] : null}
                  userId={userId}
                  assignee={assignee}
                  onToggle={toggleView}
                />
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
          <div>pending: {pendingAction ?? 'none'}</div>
          <div>disabled: {startDisabledReason ?? finishDisabledReason ?? 'none'}</div>
          {workflowError && <div className="text-blocked-text">workflow error: {workflowError}</div>}
        </div>
      )}

      {/* Undo toast */}
      {undoState && (
        <div className="fixed top-4 left-0 right-0 z-50 flex justify-center pointer-events-none">
          <div className="flex items-center gap-3 bg-elevated border border-line-strong rounded-lg px-4 py-2.5 shadow-xl pointer-events-auto">
            <span className="text-[12px] text-ink">{undoState.msg}</span>
            <button
              type="button"
              onClick={handleUndo}
              className="text-[12px] text-accent font-medium hover:text-accent-dim transition-colors"
            >
              Undo
            </button>
            <button
              type="button"
              onClick={() => { clearTimeout(undoState.timerId); setUndoState(null) }}
              className="text-[11px] text-ink-3 hover:text-ink-2 transition-colors"
            >
              ✕
            </button>
          </div>
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
                  type="button"
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
                {!showBlockPanel && !showResetConfirm && (
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
                {!showBlockPanel && !showResetConfirm && !canStart && startDisabledReason && selectedViewIds.length > 0 && (
                  <p className="text-[10px] text-ink-3">{startDisabledReason}</p>
                )}
                {!showBlockPanel && !showResetConfirm && !canFinish && finishDisabledReason && selectedViewIds.length > 0 && (
                  <p className="text-[10px] text-ink-3">{finishDisabledReason}</p>
                )}

                {/* Action buttons */}
                {!showBlockPanel && !showResetConfirm && (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleStart}
                        disabled={!canStart}
                        className="flex-1 h-9 bg-accent text-canvas text-[13px] font-medium rounded-lg hover:bg-accent-dim disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        {isPending ? '…' : 'Start'}
                      </button>
                      <button
                        type="button"
                        onClick={handleFinish}
                        disabled={!canFinish}
                        className="flex-1 h-9 bg-surface text-ink text-[13px] border border-line-strong rounded-lg hover:bg-canvas disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        {isPending ? '…' : 'Mark done'}
                      </button>
                      {canBlock && (
                        <button
                          type="button"
                          onClick={() => setShowBlockPanel(true)}
                          disabled={isPending}
                          className="h-9 px-3 bg-surface text-blocked-text text-[13px] border border-blocked-text/30 rounded-lg hover:bg-blocked-bg disabled:opacity-40 transition-colors"
                        >
                          Block
                        </button>
                      )}
                    </div>
                    {canReset && (
                      <button
                        type="button"
                        onClick={() => setShowResetConfirm(true)}
                        disabled={isPending}
                        className="w-full h-8 bg-surface text-ink-2 text-[12px] border border-line rounded-lg hover:border-line-strong hover:text-ink disabled:opacity-40 transition-colors"
                      >
                        ↺ Reset selected
                      </button>
                    )}
                  </div>
                )}

                {/* Block confirm */}
                {showBlockPanel && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleBlock}
                      disabled={isPending || !blockReason}
                      className="flex-1 h-9 bg-blocked-bg text-blocked-text text-[13px] font-medium border border-blocked-text/30 rounded-lg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {isPending ? '…' : 'Confirm block'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowBlockPanel(false); setBlockReason('') }}
                      disabled={isPending}
                      className="h-9 px-3 bg-surface text-ink-2 text-[13px] border border-line rounded-lg hover:bg-canvas transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* Reset confirm */}
                {showResetConfirm && (
                  <div className="space-y-2">
                    <div className="text-[11px] text-ink-2">
                      <p>Return selected stages to <span className="font-medium text-ink">Not started</span>.</p>
                      {cascadeStages.length > 0 && (
                        <p className="mt-1 text-warn-text">
                          Will also reset: {cascadeStages.map(s => STAGE_LABELS[s]).join(', ')}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleReset}
                        disabled={isPending}
                        className="flex-1 h-9 bg-surface text-ink text-[13px] font-medium border border-line-strong rounded-lg hover:bg-elevated disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        {isPending ? '…' : 'Reset stages'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowResetConfirm(false)}
                        disabled={isPending}
                        className="h-9 px-3 bg-surface text-ink-2 text-[13px] border border-line rounded-lg hover:bg-canvas transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
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
