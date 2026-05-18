'use client'

import { useState, useEffect, useMemo, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { startStage, finishStage, blockStage, initializeRound } from '@/lib/actions/stages'
import type { StageType, TimeWindow } from '@/lib/types/database'
import { STAGE_LABELS, STAGE_ORDER, TIME_WINDOWS, BLOCK_REASONS, roundLabel } from '@/lib/types/app'
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

interface Round {
  id: string
  round_number: number
  status: string
}

interface WidgetClientProps {
  projects: Project[]
  userId: string
  isAdmin?: boolean
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

export function WidgetClient({ projects, userId, isAdmin, hasError }: WidgetClientProps) {
  const supabase = useMemo(() => createClient(), [])
  const [isPending, startTransition] = useTransition()

  const [projectId, setProjectId] = useState('')
  const [stage, setStage] = useState<StageType | ''>('')
  const [selectedViewIds, setSelectedViewIds] = useState<string[]>([])
  const [etaDate, setEtaDate] = useState('')
  const [etaWindow, setEtaWindow] = useState<TimeWindow | ''>('')

  const [views, setViews] = useState<View[]>([])
  const [round, setRound] = useState<Round | null>(null)
  const [states, setStates] = useState<ViewState[]>([])
  const [conflictViewIds, setConflictViewIds] = useState<string[]>([])
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)

  // Block flow state
  const [showBlockPanel, setShowBlockPanel] = useState(false)
  const [blockReason, setBlockReason] = useState('')

  const project = projects.find(p => p.id === projectId) ?? null

  useEffect(() => {
    if (!projectId) return
    let ignore = false
    ;(async () => {
      const [{ data: v }, { data: r }] = await Promise.all([
        supabase.from('project_views').select('*').eq('project_id', projectId).eq('active', true).order('number'),
        supabase.from('delivery_rounds').select('*').eq('project_id', projectId).in('status', ['active', 'ready_for_admin_review']).order('round_number', { ascending: false }).limit(1),
      ])
      if (ignore) return
      setViews(v ?? [])
      const activeRound = r?.[0] ?? null
      setRound(activeRound)
      if (activeRound) {
        const { data: s } = await supabase.from('view_stage_states').select('*').eq('delivery_round_id', activeRound.id)
        if (ignore) return
        setStates(s ?? [])
      } else {
        setStates([])
      }
    })()
    return () => {
      ignore = true
    }
  }, [projectId, supabase])

  async function reloadStates() {
    if (!round) return
    const { data } = await supabase.from('view_stage_states').select('*').eq('delivery_round_id', round.id)
    setStates(data ?? [])
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

  const stageWarning = (() => {
    if (!stage || selectedViewIds.length === 0) return null
    const idx = STAGE_ORDER.indexOf(stage as StageType)
    if (idx === 0) return null
    const prev = STAGE_ORDER[idx - 1]
    const count = selectedViewIds.filter(vid => {
      const s = getState(vid, prev)
      return !s || s.status !== 'done'
    }).length
    return count > 0 ? `${STAGE_LABELS[prev]} incomplete on ${count} view${count > 1 ? 's' : ''}` : null
  })()

  const progress = states.length > 0
    ? Math.round(states.filter(s => s.status === 'done').length / states.length * 100)
    : 0

  // Determine which actions are relevant based on selected view states
  const selectedStates = selectedViewIds.map(id => getState(id, stage as StageType)).filter(Boolean)
  const anyInProgress = selectedStates.some(s => s?.status === 'in_progress')
  const canBlock = anyInProgress && selectedViewIds.length > 0 && !!stage

  function handleStart() {
    if (!projectId || !stage || !selectedViewIds.length || !round) return
    setFeedback(null)
    startTransition(async () => {
      const result = await startStage({
        projectId, roundId: round.id, viewIds: selectedViewIds,
        stage: stage as StageType,
        etaDate: etaDate || null,
        etaTimeWindow: (etaWindow || null) as TimeWindow | null,
      })
      if (result.error === 'conflict') {
        setConflictViewIds('conflictingViewIds' in result ? result.conflictingViewIds ?? [] : [])
        setFeedback({ ok: false, msg: 'Conflict — those views are already in progress.' })
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
    if (!projectId || !stage || !selectedViewIds.length || !round) return
    setFeedback(null)
    startTransition(async () => {
      const result = await finishStage({
        projectId, roundId: round.id,
        viewIds: selectedViewIds, stage: stage as StageType,
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
    if (!projectId || !stage || !selectedViewIds.length || !round || !blockReason) return
    setFeedback(null)
    startTransition(async () => {
      const result = await blockStage(
        projectId, round.id, selectedViewIds, stage as string, blockReason,
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
            const nextProjectId = e.target.value
            setProjectId(nextProjectId)
            setSelectedViewIds([])
            setFeedback(null)
            setConflictViewIds([])
            setShowBlockPanel(false)
            if (!nextProjectId) {
              setViews([])
              setRound(null)
              setStates([])
              setStage('')
            }
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

      {/* Project info strip */}
      {project && round && (
        <div className="space-y-2">
          <div className="flex items-center gap-4 text-[11px] text-ink-2">
            <span>{formatDelivery(project.delivery_date, project.delivery_time_window)}</span>
            <span className="text-ink-3">·</span>
            <span>{roundLabel(round.round_number)}</span>
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
          {round.status === 'ready_for_admin_review' && (
            <p className="text-[11px] text-accent">All post-production done — awaiting admin review.</p>
          )}
        </div>
      )}

      {/* Stage */}
      {projectId && (
        <div>
          <SectionLabel>Stage</SectionLabel>
          <select
            value={stage}
            onChange={e => { setStage(e.target.value as StageType); setSelectedViewIds([]); setFeedback(null); setShowBlockPanel(false) }}
            className="w-full px-3 py-2 bg-surface border border-line rounded-md text-[13px] text-ink focus:outline-none focus:border-accent transition-colors hover:border-line-strong"
          >
            <option value="">Select stage…</option>
            {STAGE_ORDER.map(s => (
              <option key={s} value={s}>{STAGE_LABELS[s]}</option>
            ))}
          </select>
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
              const isDone = s?.status === 'done'
              const isMine = s?.status === 'in_progress' && s.assigned_user_id === userId
              const isOther = s?.status === 'in_progress' && s.assigned_user_id !== userId
              const isBlocked = s?.status === 'blocked'

              return (
                <button
                  key={view.id}
                  onClick={() => toggleView(view.id)}
                  title={
                    isDone ? 'Done' :
                    isMine ? 'In progress (you)' :
                    isOther ? 'In progress (other)' :
                    isBlocked ? (s?.block_reason ?? 'Blocked') :
                    conflict ? 'Conflict' :
                    view.label
                  }
                  className={[
                    'h-9 flex items-center justify-center text-[11px] font-medium rounded border transition-colors',
                    selected
                      ? 'bg-accent text-canvas border-accent'
                      : conflict
                        ? 'bg-blocked-bg text-blocked-text border-blocked-text/30'
                        : isDone
                          ? 'bg-done-bg text-done-text border-done-text/20'
                          : isMine
                            ? 'bg-surface text-accent border-accent/40'
                            : isBlocked
                              ? 'bg-blocked-bg text-blocked-text border-blocked-text/30'
                              : isOther
                                ? 'bg-surface text-ink-3 border-warn-text/30'
                                : 'bg-surface text-ink-2 border-line hover:border-line-strong hover:text-ink',
                  ].join(' ')}
                >
                  {String(view.number).padStart(2, '0')}
                  {isDone && !selected && <span className="ml-0.5">✓</span>}
                  {isBlocked && !selected && <span className="ml-0.5">!</span>}
                </button>
              )
            })}
          </div>
          {stageWarning && (
            <p className="mt-2 text-[11px] text-warn-text">{stageWarning}</p>
          )}
        </div>
      )}

      {/* ETA */}
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
          <div className="space-y-2">
            <select
              value={blockReason}
              onChange={e => setBlockReason(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-blocked-text/30 rounded-md text-[13px] text-ink focus:outline-none focus:border-blocked-text transition-colors"
            >
              <option value="">Select reason…</option>
              {BLOCK_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* Feedback */}
      {feedback && (
        <p className={`text-[12px] ${feedback.ok ? 'text-done-text' : 'text-blocked-text'}`}>
          {feedback.msg}
        </p>
      )}

      {/* Missing round warning */}
      {projectId && views.length > 0 && !round && (
        <div className="p-3 bg-blocked-bg border border-blocked-text/20 rounded-md">
          <p className="text-[11px] text-blocked-text font-medium mb-1">Project not initialised</p>
          <p className="text-[11px] text-ink-2 mb-2">
            This project has no active delivery round. Stages cannot be started until one is created.
          </p>
          {isAdmin && (
            <button
              onClick={() => {
                startTransition(async () => {
                  const result = await initializeRound(projectId)
                  if (result.error) {
                    setFeedback({ ok: false, msg: result.error as string })
                  } else {
                    setFeedback({ ok: true, msg: 'Round initialised. You can now start stages.' })
                    // Reload round + states
                    const { data: r } = await supabase
                      .from('delivery_rounds')
                      .select('*')
                      .eq('project_id', projectId)
                      .in('status', ['active', 'ready_for_admin_review'])
                      .order('round_number', { ascending: false })
                      .limit(1)
                    const activeRound = r?.[0] ?? null
                    setRound(activeRound)
                    if (activeRound) {
                      const { data: s } = await supabase
                        .from('view_stage_states')
                        .select('*')
                        .eq('delivery_round_id', activeRound.id)
                      setStates(s ?? [])
                    }
                  }
                })
              }}
              disabled={isPending}
              className="px-3 py-1.5 bg-surface border border-line text-[12px] text-ink rounded-md hover:border-accent transition-colors disabled:opacity-40"
            >
              {isPending ? 'Initialising…' : 'Initialise round'}
            </button>
          )}
        </div>
      )}

      {/* Actions */}
      {selectedViewIds.length > 0 && !showBlockPanel && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={handleStart}
            disabled={isPending || !round}
            className="flex-1 h-9 bg-accent text-canvas text-[13px] font-medium rounded-md hover:bg-accent-dim disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isPending ? '…' : 'Start stage'}
          </button>
          <button
            onClick={handleFinish}
            disabled={isPending || !round}
            className="flex-1 h-9 bg-surface text-ink text-[13px] border border-line-strong rounded-md hover:bg-elevated disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isPending ? '…' : 'Mark done'}
          </button>
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
    </div>
  )
}
