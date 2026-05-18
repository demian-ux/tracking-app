'use client'

import { useState, useTransition } from 'react'
import { markDeliverySent, createRevisionRound } from '@/lib/actions/delivery'
import type { IncompleteItem } from '@/lib/actions/delivery'
import { updateProjectDates, updateProjectStatus, updateProjectViewCount } from '@/lib/actions/projects'
import { unblockStage } from '@/lib/actions/stages'
import type { Project, ProjectViewRound } from '@/lib/types/app'
import type { TimeWindow, StageType } from '@/lib/types/database'
import { TIME_WINDOWS, roundLabel, STAGE_LABELS, ACTIVE_PROJECT_STATUSES, PROJECT_STATUS_LABELS } from '@/lib/types/app'
import { formatDelivery } from '@/lib/utils/formatting'

interface ViewStageStateWithUser {
  id: string
  project_view_id: string
  project_view_round_id: string
  stage: StageType
  status: string
  block_reason: string | null
  latest_eta_date: string | null
  latest_eta_time_window: string | null
  users: { name: string } | null
}

interface ViewInfo {
  id: string
  label: string
}

interface Props {
  project: Project
  viewRounds: ProjectViewRound[]
  stageStates: ViewStageStateWithUser[]
  views: ViewInfo[]
}

const fieldClass = 'w-full px-2.5 py-2 bg-canvas border border-line rounded-md text-[13px] text-ink focus:outline-none focus:border-accent transition-colors [color-scheme:dark]'

export function ProjectDetailClient({ project, viewRounds, stageStates, views }: Props) {
  const [isPending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<string | null>(null)
  const [confirmDelivery, setConfirmDelivery] = useState(false)
  const [showEditDates, setShowEditDates] = useState(false)
  const [showStatusPicker, setShowStatusPicker] = useState(false)
  const [showEditViews, setShowEditViews] = useState(false)
  const [newViewCount, setNewViewCount] = useState(project.view_count)
  const [viewError, setViewError] = useState<string | null>(null)

  const [deliveryDate, setDeliveryDate] = useState(project.delivery_date ?? '')
  const [deliveryWindow, setDeliveryWindow] = useState<TimeWindow | ''>(project.delivery_time_window ?? '')

  // Per-view delivery/revision selection
  const [viewsToDeliver, setViewsToDeliver] = useState<string[]>([])
  const [viewsToRevise, setViewsToRevise] = useState<string[]>([])

  const blockedStates = stageStates.filter(s => s.status === 'blocked')

  // Active rounds
  const activeRounds = viewRounds.filter(r => r.status === 'active')

  // Compute readiness per view: all stages done in active round
  const viewReadiness = views.map(view => {
    const activeRound = activeRounds.find(r => r.project_view_id === view.id)
    if (!activeRound) return { view, ready: false, incomplete: [] as IncompleteItem[] }

    const viewStates = stageStates.filter(
      s => s.project_view_id === view.id && s.project_view_round_id === activeRound.id
    )
    const incomplete: IncompleteItem[] = viewStates
      .filter(s => s.status !== 'done')
      .map(s => ({
        viewLabel: view.label,
        stageLabel: STAGE_LABELS[s.stage],
        status: s.status,
      }))
    return { view, ready: incomplete.length === 0 && viewStates.length > 0, incomplete }
  })

  // Views whose latest round is 'delivered' (eligible for revision)
  const deliveredViews = views.filter(view => {
    const rounds = viewRounds.filter(r => r.project_view_id === view.id)
    const latestRound = rounds.sort((a, b) => b.round_number - a.round_number)[0]
    return latestRound?.status === 'delivered'
  })

  function toggleViewToDeliver(viewId: string) {
    setViewsToDeliver(prev =>
      prev.includes(viewId) ? prev.filter(id => id !== viewId) : [...prev, viewId]
    )
  }

  function toggleViewToRevise(viewId: string) {
    setViewsToRevise(prev =>
      prev.includes(viewId) ? prev.filter(id => id !== viewId) : [...prev, viewId]
    )
  }

  function handleMarkDelivery() {
    if (viewsToDeliver.length === 0) return
    startTransition(async () => {
      const result = await markDeliverySent(project.id, viewsToDeliver)
      if (result.error) {
        setFeedback(result.error)
      } else {
        setFeedback('Delivery marked as sent.')
        setViewsToDeliver([])
      }
      setConfirmDelivery(false)
    })
  }

  function handleCreateRevision() {
    if (viewsToRevise.length === 0) return
    startTransition(async () => {
      const result = await createRevisionRound(project.id, viewsToRevise)
      if (result.error) setFeedback(result.error)
      else {
        setFeedback('Revision round created.')
        setViewsToRevise([])
      }
    })
  }

  function handleSaveDates() {
    startTransition(async () => {
      const result = await updateProjectDates(project.id, {
        deliveryDate: deliveryDate || null,
        deliveryTimeWindow: (deliveryWindow || null) as TimeWindow | null,
      })
      if (result.error) setFeedback(result.error)
      else setShowEditDates(false)
    })
  }

  function handleSetStatus(status: string) {
    startTransition(async () => {
      const result = await updateProjectStatus(project.id, status)
      if (result.error) setFeedback(result.error)
      else { setFeedback(null); setShowStatusPicker(false) }
    })
  }

  function handleSaveViewCount() {
    setViewError(null)
    startTransition(async () => {
      const result = await updateProjectViewCount(project.id, newViewCount)
      if (result.error) {
        setViewError(result.error)
      } else {
        setShowEditViews(false)
      }
    })
  }

  function handleUnblock(state: ViewStageStateWithUser) {
    startTransition(async () => {
      const result = await unblockStage(
        project.id, state.project_view_id, state.stage,
      )
      if (result.error) setFeedback(result.error)
      else setFeedback('Stage unblocked.')
    })
  }

  const getViewLabel = (viewId: string) => views.find(v => v.id === viewId)?.label ?? '—'

  return (
    <div className="space-y-3">

      {/* Blocked stages panel */}
      {blockedStates.length > 0 && (
        <div className="bg-surface border border-blocked-text/20 rounded-md p-4">
          <h3 className="text-[10px] tracking-[0.12em] uppercase text-blocked-text mb-3">
            Blocked stages ({blockedStates.length})
          </h3>
          <div className="space-y-2">
            {blockedStates.map(state => (
              <div key={state.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-[12px] text-ink-2">
                    {getViewLabel(state.project_view_id)}
                  </span>
                  <span className="text-ink-3 mx-1.5">·</span>
                  <span className="text-[12px] text-ink-2">{STAGE_LABELS[state.stage]}</span>
                  {state.block_reason && (
                    <span className="ml-1.5 text-[11px] text-blocked-text">— {state.block_reason}</span>
                  )}
                </div>
                <button
                  onClick={() => handleUnblock(state)}
                  disabled={isPending}
                  className="shrink-0 px-2.5 py-1 text-[11px] text-ink-2 border border-line-strong rounded hover:bg-elevated disabled:opacity-40 transition-colors"
                >
                  Unblock
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Status */}
      <div className="bg-surface border border-line rounded-md p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] tracking-[0.12em] uppercase text-ink-3">Status</span>
          <button
            onClick={() => setShowStatusPicker(v => !v)}
            className="text-[11px] text-ink-3 hover:text-ink-2 transition-colors"
          >
            {showStatusPicker ? 'Cancel' : 'Change'}
          </button>
        </div>
        {showStatusPicker ? (
          <div className="grid grid-cols-2 gap-1.5">
            {ACTIVE_PROJECT_STATUSES.map(s => (
              <button
                key={s}
                onClick={() => handleSetStatus(s)}
                disabled={isPending || s === project.status}
                className={`px-2.5 py-1.5 text-[11px] rounded border text-left transition-colors disabled:opacity-40 ${
                  s === project.status
                    ? 'border-accent text-accent bg-surface'
                    : 'border-line text-ink-2 hover:border-line-strong hover:text-ink bg-surface'
                }`}
              >
                {PROJECT_STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        ) : (
          <span className="text-[13px] text-ink">{PROJECT_STATUS_LABELS[project.status] ?? project.status}</span>
        )}
      </div>

      {/* Views */}
      <div className="bg-surface border border-line rounded-md p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] tracking-[0.12em] uppercase text-ink-3">Views</span>
          <button
            onClick={() => { setShowEditViews(v => !v); setViewError(null); setNewViewCount(project.view_count) }}
            className="text-[11px] text-ink-3 hover:text-ink-2 transition-colors"
          >
            {showEditViews ? 'Cancel' : 'Edit'}
          </button>
        </div>
        {showEditViews ? (
          <div className="space-y-2">
            <input
              type="number"
              min={1}
              max={99}
              value={newViewCount}
              onChange={e => setNewViewCount(parseInt(e.target.value) || 1)}
              className="w-28 px-2.5 py-2 bg-canvas border border-line rounded-md text-[13px] text-ink focus:outline-none focus:border-accent transition-colors [color-scheme:dark]"
            />
            {viewError && <p className="text-[12px] text-blocked-text">{viewError}</p>}
            <button
              onClick={handleSaveViewCount}
              disabled={isPending || newViewCount === project.view_count}
              className="w-full py-1.5 bg-accent text-canvas text-[12px] font-medium rounded-md hover:bg-accent-dim disabled:opacity-40 transition-colors"
            >
              Save
            </button>
          </div>
        ) : (
          <span className="text-[13px] text-ink">{project.view_count} views</span>
        )}
      </div>

      {/* Delivery date */}
      <div className="bg-surface border border-line rounded-md p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] tracking-[0.12em] uppercase text-ink-3">Delivery date</span>
          <button
            onClick={() => setShowEditDates(!showEditDates)}
            className="text-[11px] text-ink-3 hover:text-ink-2 transition-colors"
          >
            {showEditDates ? 'Cancel' : 'Edit'}
          </button>
        </div>
        {showEditDates ? (
          <div className="space-y-2">
            <input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} className={fieldClass} />
            <select value={deliveryWindow} onChange={e => setDeliveryWindow(e.target.value as TimeWindow)} className={fieldClass}>
              <option value="">No window</option>
              {TIME_WINDOWS.map(w => <option key={w} value={w}>{w}</option>)}
            </select>
            <button onClick={handleSaveDates} disabled={isPending} className="w-full py-1.5 bg-accent text-canvas text-[12px] font-medium rounded-md hover:bg-accent-dim disabled:opacity-40 transition-colors">
              Save
            </button>
          </div>
        ) : (
          <span className="text-[13px] text-ink">{formatDelivery(project.delivery_date, project.delivery_time_window)}</span>
        )}
      </div>

      {/* Delivery actions */}
      <div className="bg-surface border border-line rounded-md p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[10px] tracking-[0.12em] uppercase text-ink-3">Delivery</h3>
          {viewsToDeliver.length > 0 && (
            <span className="text-[10px] text-ink-2">{viewsToDeliver.length} view{viewsToDeliver.length > 1 ? 's' : ''} selected</span>
          )}
        </div>

        {/* Per-view readiness checkboxes */}
        {activeRounds.length > 0 && (
          <div className="mb-3 space-y-1.5">
            {viewReadiness.map(({ view, ready, incomplete }) => (
              <label key={view.id} className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={viewsToDeliver.includes(view.id)}
                  onChange={() => toggleViewToDeliver(view.id)}
                  disabled={!ready || isPending}
                  className="mt-0.5 shrink-0"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] text-ink-2">{view.label}</span>
                    <span className={`text-[10px] font-medium ${ready ? 'text-done-text' : 'text-warn-text'}`}>
                      {ready ? 'Ready' : `${incomplete.length} incomplete`}
                    </span>
                  </div>
                  {!ready && incomplete.length > 0 && incomplete.length <= 3 && (
                    <div className="text-[10px] text-ink-3">
                      {incomplete.map(item => `${item.stageLabel} (${item.status})`).join(', ')}
                    </div>
                  )}
                </div>
              </label>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {activeRounds.length > 0 && !confirmDelivery && (
            <button
              onClick={() => setConfirmDelivery(true)}
              disabled={isPending || viewsToDeliver.length === 0}
              title={viewsToDeliver.length === 0 ? 'Select ready views to deliver' : undefined}
              className="px-3 py-1.5 bg-surface text-ink text-[12px] border border-line-strong rounded-md hover:bg-elevated disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Mark delivery sent
            </button>
          )}
          {confirmDelivery && (
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-ink-2">
                Confirm {viewsToDeliver.length} view{viewsToDeliver.length > 1 ? 's' : ''} delivered?
              </span>
              <button onClick={handleMarkDelivery} disabled={isPending} className="px-3 py-1.5 bg-accent text-canvas text-[12px] font-medium rounded-md hover:bg-accent-dim disabled:opacity-40 transition-colors">
                Confirm
              </button>
              <button onClick={() => setConfirmDelivery(false)} className="px-3 py-1.5 text-[12px] text-ink-3 hover:text-ink-2 transition-colors">
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Revision panel */}
      {(project.status === 'waiting_for_feedback' || project.status === 'delivered') && deliveredViews.length > 0 && (
        <div className="bg-surface border border-line rounded-md p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[10px] tracking-[0.12em] uppercase text-ink-3">Revision</h3>
            {viewsToRevise.length > 0 && (
              <span className="text-[10px] text-ink-2">{viewsToRevise.length} view{viewsToRevise.length > 1 ? 's' : ''} selected</span>
            )}
          </div>

          <div className="mb-3 space-y-1.5">
            {deliveredViews.map(view => {
              const latestRound = viewRounds
                .filter(r => r.project_view_id === view.id)
                .sort((a, b) => b.round_number - a.round_number)[0]
              return (
                <label key={view.id} className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={viewsToRevise.includes(view.id)}
                    onChange={() => toggleViewToRevise(view.id)}
                    disabled={isPending}
                    className="shrink-0"
                  />
                  <span className="text-[12px] text-ink-2">{view.label}</span>
                  {latestRound && (
                    <span className="text-[10px] text-ink-3">{roundLabel(latestRound.round_number)} delivered</span>
                  )}
                </label>
              )
            })}
          </div>

          <button
            onClick={handleCreateRevision}
            disabled={isPending || viewsToRevise.length === 0}
            className="px-3 py-1.5 bg-surface text-ink text-[12px] border border-line-strong rounded-md hover:bg-elevated disabled:opacity-40 transition-colors"
          >
            Create revision round
          </button>
        </div>
      )}

      {feedback && (
        <p className="text-[12px] text-ink-2">{feedback}</p>
      )}
    </div>
  )
}
