'use client'

import { useState, useEffect, useMemo, useTransition, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { startStage, finishStage, blockStage, ensureProjectWorkflow, undoStageAction, resetStage } from '@/lib/actions/stages'
import type { StageType, TimeWindow } from '@/lib/types/database'
import { STAGE_LABELS, STAGE_ORDER, TIME_WINDOWS, BLOCK_REASONS } from '@/lib/types/app'
import { formatDelivery } from '@/lib/utils/formatting'
import { ViewCell, type ViewState, type View } from './ViewCell'
import { SectionLabel } from '@/components/ui/SectionLabel'
import { EmptyState } from '@/components/ui/EmptyState'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { FilterChip } from '@/components/ui/FilterChip'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { Icon } from '@/components/ui/Icon'

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

const FILTER_LABELS: Record<ViewFilter, string> = {
  all: 'All',
  mine: 'Mine',
  available: 'Available',
  blocked: 'Blocked',
  done: 'Done',
}

function CellLegend() {
  const items = [
    { key: 'not_started', label: 'Idle', cls: 'bg-surface border-line' },
    { key: 'mine',        label: 'You', cls: 'bg-surface border-accent/45' },
    { key: 'other',       label: 'Other', cls: 'bg-surface border-warn-text/35' },
    { key: 'done',        label: 'Done', cls: 'bg-done-bg border-done-text/25' },
    { key: 'blocked',     label: 'Blocked', cls: 'bg-blocked-bg border-blocked-text/30' },
    { key: 'reopened',    label: 'Reopened', cls: 'bg-reopened-bg border-reopened-text/35' },
  ]
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-3 text-[10px] font-semibold uppercase text-ink-3 tracking-[0.06em]">
      {items.map(it => (
        <span key={it.key} className="inline-flex items-center gap-1.5">
          <span className={`inline-block w-2 h-2 rounded-sm border ${it.cls}`} />
          {it.label}
        </span>
      ))}
    </div>
  )
}

export function WidgetClient({ projects, userId, userRole, users, hasError }: WidgetClientProps) {
  const supabase = useMemo(() => createClient(), [])
  const [isPending, startTransition] = useTransition()
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [pendingViewIds, setPendingViewIds] = useState<string[]>([])

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
  const isAdmin = userRole === 'admin'

  function debugLog(label: string, payload?: unknown) {
    if (process.env.NODE_ENV === 'development') console.log(`[Widget] ${label}`, payload ?? '')
  }
  function debugError(label: string, error: unknown) {
    if (process.env.NODE_ENV === 'development') console.error(`[Widget] ${label}`, error)
  }

  // ── Load workflow when project changes ──────────────────────────────────────
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

  // ── Initial stage is whole-project: auto-select all views ───────────────────
  useEffect(() => {
    if (stage !== 'initial' || views.length === 0) return
    setSelectedViewIds(prev => {
      const allIds = views.map(v => v.id)
      if (prev.length === allIds.length && prev.every((id, i) => id === allIds[i])) return prev
      return allIds
    })
  }, [stage, views])

  async function reloadStates() {
    if (viewRounds.length === 0) return
    const roundIds = viewRounds.map(r => r.id)
    const { data } = await supabase.from('view_stage_states').select('*').in('project_view_round_id', roundIds)
    setStates((data ?? []) as ViewState[])
  }

  const stateByViewStage = useMemo(() => {
    const map = new Map<string, ViewState>()
    for (const s of states) map.set(`${s.project_view_id}:${s.stage}`, s)
    return map
  }, [states])

  function getState(viewId: string, s: StageType) {
    return stateByViewStage.get(`${viewId}:${s}`)
  }

  function mergeStates(updated: Partial<ViewState>[]) {
    const byId = new Map(updated.map(s => [s.id!, s]))
    setStates(prev => prev.map(s => {
      const u = byId.get(s.id)
      return u ? { ...s, ...u } : s
    }))
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

  function handleStageChange(newStage: StageType) {
    setStage(newStage)
    setConflictViewIds([])
    setFeedback(null)
    setShowBlockPanel(false)
    setBlockReason('')
    setShowResetConfirm(false)
    setViewFilter('all')
    if (newStage === 'initial') {
      setSelectedViewIds(views.map(v => v.id))
    } else {
      setSelectedViewIds([])
    }
  }

  // ── Stage order enforcement ─────────────────────────────────────────────────
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

  // counts per filter for chip badges
  const filterCounts = useMemo(() => {
    if (!stage) return { all: 0, mine: 0, available: 0, blocked: 0, done: 0 } as Record<ViewFilter, number>
    const c: Record<ViewFilter, number> = { all: views.length, mine: 0, available: 0, blocked: 0, done: 0 }
    for (const v of views) {
      const s = getState(v.id, stage as StageType)
      if (s?.status === 'in_progress' && s.assigned_user_id === userId) c.mine++
      if (!s || s.status === 'not_started' || s.status === 'reopened') c.available++
      if (s?.status === 'blocked') c.blocked++
      if (s?.status === 'done') c.done++
    }
    return c
  }, [views, stage, stateByViewStage, userId])

  // ── Action eligibility ──────────────────────────────────────────────────────
  const selectedStates = selectedViewIds
    .map(id => (stage ? getState(id, stage as StageType) : undefined))
    .filter((s): s is ViewState => s !== undefined)

  const allSelectedHaveState =
    stage !== '' &&
    selectedStates.length === selectedViewIds.length &&
    selectedViewIds.length > 0

  const canStart =
    !isPending && !pendingAction && viewRounds.length > 0 && !roundLoading && !!stage &&
    allSelectedHaveState && !stageOrderBlock &&
    selectedStates.every(s => s.status === 'not_started' || s.status === 'reopened')

  const canFinish =
    !isPending && !pendingAction && viewRounds.length > 0 && !roundLoading && !!stage &&
    allSelectedHaveState &&
    selectedStates.every(s => s.status === 'in_progress' && s.assigned_user_id === userId)

  const canBlock =
    !isPending && !pendingAction && viewRounds.length > 0 && !roundLoading && !!stage &&
    allSelectedHaveState &&
    selectedStates.every(s => s.status === 'in_progress' && s.assigned_user_id === userId)

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
    !isPending && !pendingAction && viewRounds.length > 0 && !!stage &&
    selectedViewIds.length > 0 && allSelectedHaveState &&
    selectedStates.some(s => s.status !== 'not_started') &&
    (isAdmin || selectedStates.some(s => s.assigned_user_id === userId))

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
    if (!canStart) {
      setFeedback({ ok: false, msg: startDisabledReason ?? 'Start is unavailable.' })
      return
    }
    setFeedback(null)
    const snapshot = selectedStates.map(s => ({ id: s.id, status: s.status, assigned_user_id: s.assigned_user_id }))
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
    setPendingViewIds(viewIdsCopy)
    if (stage !== 'initial') clearSelection()
    setPendingAction('start')

    startTransition(async () => {
      try {
        const result = await startStage({ projectId, viewIds: viewIdsCopy, stage: stageCopy, etaDate: etaDateCopy, etaTimeWindow: etaWindowCopy })
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
        setPendingViewIds([])
      }
    })
  }

  function handleFinish() {
    if (!canFinish) {
      setFeedback({ ok: false, msg: finishDisabledReason ?? 'Mark done is unavailable.' })
      return
    }
    setFeedback(null)
    const snapshot = selectedStates.map(s => ({ id: s.id, status: s.status, assigned_user_id: s.assigned_user_id }))
    const count = selectedViewIds.length
    const viewIdsCopy = [...selectedViewIds]
    const stageCopy = stage as StageType

    setStates(prev => prev.map(s =>
      viewIdsCopy.includes(s.project_view_id) && s.stage === stageCopy
        ? { ...s, status: 'done' }
        : s
    ))
    setPendingViewIds(viewIdsCopy)
    if (stage !== 'initial') clearSelection()
    setPendingAction('done')

    startTransition(async () => {
      try {
        const result = await finishStage({ projectId, viewIds: viewIdsCopy, stage: stageCopy })
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
        setPendingViewIds([])
      }
    })
  }

  function handleReset() {
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
    setPendingViewIds(viewIdsCopy)
    if (stage !== 'initial') setSelectedViewIds([])
    setPendingAction('reset')

    startTransition(async () => {
      try {
        const result = await resetStage(projectId, viewIdsCopy, stageCopy)
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
        setPendingViewIds([])
      }
    })
  }

  async function handleUndo() {
    if (!undoState) return
    clearTimeout(undoState.timerId)
    const restoresCopy = undoState.restores
    setUndoState(null)
    rollback(restoresCopy)
    setPendingAction('undo')
    try {
      const result = await undoStageAction(projectId, restoresCopy)
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
    if (!canBlock || !blockReason) {
      setFeedback({ ok: false, msg: !blockReason ? 'Select a block reason.' : 'Block is unavailable for this selection.' })
      return
    }
    setFeedback(null)
    const snapshot = selectedStates.map(s => ({ id: s.id, status: s.status, assigned_user_id: s.assigned_user_id }))
    const viewIdsCopy = [...selectedViewIds]
    const stageCopy = stage as StageType
    const reasonCopy = blockReason

    setStates(prev => prev.map(s =>
      viewIdsCopy.includes(s.project_view_id) && s.stage === stageCopy
        ? { ...s, status: 'blocked', block_reason: reasonCopy }
        : s
    ))
    setPendingViewIds(viewIdsCopy)
    if (stage !== 'initial') clearSelection()
    setPendingAction('block')

    startTransition(async () => {
      try {
        const result = await blockStage(projectId, viewIdsCopy, stageCopy, reasonCopy)
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
        setPendingViewIds([])
      }
    })
  }

  const barVisible = selectedViewIds.length > 0
  const stageIsInitial = stage === 'initial'

  if (!projects.length && !hasError) {
    return <EmptyState icon="folder" title="No active projects" sub="An admin needs to create one." />
  }

  return (
    <div className={barVisible ? 'pb-52' : ''}>
      {!projectId ? (
        <div className="space-y-6">
          <div>
            <SectionLabel>Project</SectionLabel>
            <Select
              value=""
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
            >
              <option value="" disabled>Choose project…</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>
                  {p.clients?.name ? `${p.clients.name} / ` : ''}{p.name}
                </option>
              ))}
            </Select>
          </div>
          <EmptyState
            icon="folder"
            title="Select a project to begin"
            sub="Pick from your active or in-revision projects."
          />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Project select */}
          <div>
            <SectionLabel>Project</SectionLabel>
            <Select
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
            >
              {projects.map(p => (
                <option key={p.id} value={p.id}>
                  {p.clients?.name ? `${p.clients.name} / ` : ''}{p.name}
                </option>
              ))}
            </Select>
          </div>

          {/* Project info strip */}
          {project && viewRounds.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-caption text-ink-2 flex-wrap">
                <Icon name="calendar" size={11} className="text-ink-3" />
                <span>{formatDelivery(project.delivery_date, project.delivery_time_window)}</span>
                <span className="text-ink-faint">·</span>
                <span>{project.view_count} views</span>
              </div>
              <ProgressBar value={progress} />
            </div>
          )}

          {roundLoading && (
            <p className="inline-flex items-center gap-2 text-caption text-ink-3">
              <span className="w-3 h-3 rounded-full border-[1.5px] border-current border-r-transparent animate-spin" />
              Loading workflow…
            </p>
          )}

          {/* Stage segmented control */}
          {projectId && !roundLoading && viewRounds.length > 0 && (
            <div>
              <SectionLabel>Stage</SectionLabel>
              <div className="flex gap-0.5 bg-surface border border-line rounded-md p-0.5">
                {STAGE_ORDER.map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => handleStageChange(s)}
                    className={[
                      'flex-1 min-w-0 h-8 px-2 text-sm font-medium rounded-sm truncate',
                      'transition-colors duration-100 ease-out',
                      stage === s
                        ? 'bg-overlay text-ink ring-1 ring-inset ring-line-strong'
                        : 'text-ink-2 hover:text-ink',
                    ].join(' ')}
                  >
                    {STAGE_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Views grid + filters — hidden for Initial (whole-project) */}
          {stage && !stageIsInitial && views.length > 0 && (
            <div>
              {/* Filter chips */}
              <div className="flex gap-1.5 flex-wrap mb-3">
                {(['all', 'mine', 'available', 'blocked', 'done'] as ViewFilter[]).map(f => (
                  <FilterChip
                    key={f}
                    active={viewFilter === f}
                    count={filterCounts[f]}
                    onClick={() => {
                      setViewFilter(f)
                      setSelectedViewIds(ids => ids.filter(id => {
                        if (f === 'all') return true
                        const s = getState(id, stage as StageType)
                        switch (f) {
                          case 'mine':      return s?.status === 'in_progress' && s.assigned_user_id === userId
                          case 'available': return !s || s.status === 'not_started' || s.status === 'reopened'
                          case 'blocked':   return s?.status === 'blocked'
                          case 'done':      return s?.status === 'done'
                          default:          return true
                        }
                      }))
                    }}
                  >
                    {FILTER_LABELS[f]}
                  </FilterChip>
                ))}
              </div>

              {/* Views header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-label font-semibold uppercase text-ink-3">Views</span>
                  <span className="text-label font-semibold text-ink-3 tabular-nums px-2 py-0.5 bg-surface border border-line rounded-full">
                    {filteredViews.length}
                  </span>
                </div>
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
                        if (allSelected) setSelectedViewIds([])
                        else {
                          setSelectedViewIds(eligible.map(v => v.id))
                          setConflictViewIds([])
                          setFeedback(null)
                        }
                      }}
                      className="text-label font-semibold uppercase text-ink-2 hover:text-ink transition-colors px-2 py-0.5 border border-line rounded-sm hover:border-line-strong"
                    >
                      {allSelected ? 'Clear all' : 'Select all'}
                    </button>
                  ) : null
                })()}
              </div>

              {/* Grid */}
              <div className="grid grid-cols-5 gap-2">
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
                      pending={pendingViewIds.includes(view.id)}
                      onToggle={toggleView}
                    />
                  )
                })}
              </div>

              {filteredViews.length === 0 && viewFilter !== 'all' && (
                <p className="text-caption text-ink-2 text-center py-3">
                  No {viewFilter} views — try a different filter.
                </p>
              )}

              <CellLegend />
            </div>
          )}

          {/* Dev debug */}
          {process.env.NODE_ENV === 'development' && (
            <div className="p-3 bg-surface border border-line rounded-sm font-mono text-caption text-ink-3 space-y-0.5">
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
        </div>
      )}

      {/* Undo toast */}
      {undoState && (
        <div className="fixed top-4 left-0 right-0 z-50 flex justify-center pointer-events-none">
          <div className="flex items-center gap-3 bg-elevated border border-line-strong rounded-lg px-4 py-2.5 shadow-2xl pointer-events-auto">
            <span className="text-sm text-ink">{undoState.msg}</span>
            <button
              type="button"
              onClick={handleUndo}
              className="text-sm text-accent font-medium hover:text-accent-dim transition-colors"
            >
              Undo
            </button>
            <button
              type="button"
              onClick={() => { clearTimeout(undoState.timerId); setUndoState(null) }}
              className="text-ink-3 hover:text-ink-2 transition-colors p-0.5"
              title="Dismiss"
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        </div>
      )}

      {/* Sticky action bar */}
      {barVisible && (
        <div className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none">
          <div className="max-w-[460px] mx-auto px-6 pb-6 pointer-events-auto">
            <div className="bg-elevated border border-line-strong rounded-lg shadow-2xl overflow-hidden">
              {/* Bar header */}
              <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-line">
                <div className="flex items-center gap-2 text-sm">
                  {stageIsInitial ? (
                    <>
                      <span className="font-medium text-ink">All views</span>
                      <span className="text-ink-faint">·</span>
                      <span className="text-ink-2">{STAGE_LABELS.initial}</span>
                    </>
                  ) : (
                    <>
                      <span className="font-medium text-ink">
                        {selectedViewIds.length} view{selectedViewIds.length > 1 ? 's' : ''}
                      </span>
                      {stage && (
                        <>
                          <span className="text-ink-faint">·</span>
                          <span className="text-ink-2">{STAGE_LABELS[stage as StageType]}</span>
                        </>
                      )}
                    </>
                  )}
                </div>
                {!stageIsInitial && (
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="text-caption text-ink-3 hover:text-ink-2 transition-colors px-1.5 py-0.5 rounded-sm hover:bg-surface"
                  >
                    Clear
                  </button>
                )}
              </div>

              <div className="px-4 py-3 space-y-3">
                {/* Feedback */}
                {feedback && (
                  <p className={`text-caption ${feedback.ok ? 'text-done-text' : 'text-blocked-text'}`}>
                    {feedback.msg}
                  </p>
                )}

                {/* ETA row */}
                {!showBlockPanel && !showResetConfirm && (
                  <div className="flex gap-2">
                    <Input
                      type="date"
                      value={etaDate}
                      onChange={e => setEtaDate(e.target.value)}
                      className="h-8 flex-1 text-sm"
                      placeholder="ETA date"
                    />
                    <Select
                      value={etaWindow}
                      onChange={e => setEtaWindow(e.target.value as TimeWindow)}
                      className="h-8 w-24 text-sm"
                    >
                      <option value="">Time</option>
                      {TIME_WINDOWS.map(w => <option key={w} value={w}>{w}</option>)}
                    </Select>
                  </div>
                )}

                {/* Block reason picker */}
                {showBlockPanel && (
                  <Select
                    value={blockReason}
                    onChange={e => setBlockReason(e.target.value)}
                    className="border-blocked-text/30 focus:border-blocked-text"
                  >
                    <option value="">Select reason…</option>
                    {BLOCK_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </Select>
                )}

                {/* Disabled reason hints */}
                {!showBlockPanel && !showResetConfirm && !canStart && startDisabledReason && selectedViewIds.length > 0 && (
                  <p className="text-caption text-ink-2">{startDisabledReason}</p>
                )}
                {!showBlockPanel && !showResetConfirm && !canFinish && finishDisabledReason && selectedViewIds.length > 0 && (
                  <p className="text-caption text-ink-2">{finishDisabledReason}</p>
                )}

                {/* Action buttons */}
                {!showBlockPanel && !showResetConfirm && (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <Button
                        variant="primary"
                        onClick={handleStart}
                        disabled={!canStart}
                        loading={pendingAction === 'start'}
                        className="flex-1"
                      >
                        {pendingAction === 'start' ? 'Starting…' : 'Start'}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={handleFinish}
                        disabled={!canFinish}
                        loading={pendingAction === 'done'}
                        leftIcon={pendingAction === 'done' ? undefined : 'check'}
                        className="flex-1"
                      >
                        {pendingAction === 'done' ? 'Marking…' : 'Mark done'}
                      </Button>
                      {canBlock && (
                        <Button
                          variant="danger"
                          leftIcon="block"
                          onClick={() => setShowBlockPanel(true)}
                          disabled={isPending}
                        >
                          Block
                        </Button>
                      )}
                    </div>
                    {canReset && (
                      <Button
                        variant="ghost"
                        leftIcon="rotate"
                        onClick={() => setShowResetConfirm(true)}
                        disabled={isPending}
                        full
                      >
                        Reset selected
                      </Button>
                    )}
                  </div>
                )}

                {/* Block confirm */}
                {showBlockPanel && (
                  <div className="flex gap-2">
                    <Button
                      variant="danger"
                      onClick={handleBlock}
                      disabled={!blockReason || isPending}
                      loading={pendingAction === 'block'}
                      className="flex-1"
                    >
                      {pendingAction === 'block' ? 'Blocking…' : 'Confirm block'}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => { setShowBlockPanel(false); setBlockReason('') }}
                      disabled={isPending}
                    >
                      Cancel
                    </Button>
                  </div>
                )}

                {/* Reset confirm */}
                {showResetConfirm && (
                  <div className="space-y-2">
                    <div className="text-caption text-ink-2 space-y-1">
                      <p>
                        Return selected stages to{' '}
                        <span className="font-medium text-ink">Not started</span>.
                      </p>
                      {cascadeStages.length > 0 && (
                        <p className="text-warn-text">
                          Will also reset: {cascadeStages.map(s => STAGE_LABELS[s]).join(', ')}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        onClick={handleReset}
                        loading={pendingAction === 'reset'}
                        className="flex-1"
                      >
                        {pendingAction === 'reset' ? 'Resetting…' : 'Reset stages'}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => setShowResetConfirm(false)}
                        disabled={isPending}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                {/* ETA hint */}
                {!showBlockPanel && !showResetConfirm && (
                  <div className="flex items-center gap-1.5 text-caption text-ink-2">
                    <Icon name="dot" size={10} className="text-accent" />
                    <span>ETA is optional · teammates see this on Today.</span>
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
