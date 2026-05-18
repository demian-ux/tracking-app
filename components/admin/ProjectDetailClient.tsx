'use client'

import { useState, useTransition } from 'react'
import { markDeliverySent, createRevisionRound } from '@/lib/actions/delivery'
import type { IncompleteItem } from '@/lib/actions/delivery'
import { updateProjectDates, updateProjectStatus, updateProjectViewCount } from '@/lib/actions/projects'
import { unblockStage } from '@/lib/actions/stages'
import type { Project, DeliveryRound } from '@/lib/types/app'
import type { TimeWindow, StageType } from '@/lib/types/database'
import { TIME_WINDOWS, roundLabel, STAGE_LABELS, ACTIVE_PROJECT_STATUSES, PROJECT_STATUS_LABELS } from '@/lib/types/app'
import { formatDelivery } from '@/lib/utils/formatting'

interface ViewStageStateWithUser {
  id: string
  project_view_id: string
  delivery_round_id: string
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
  rounds: DeliveryRound[]
  activeRound: DeliveryRound | null
  stageStates: ViewStageStateWithUser[]
  views: ViewInfo[]
}

const fieldClass = 'w-full px-2.5 py-2 bg-canvas border border-line rounded-md text-[13px] text-ink focus:outline-none focus:border-accent transition-colors [color-scheme:dark]'

export function ProjectDetailClient({ project, rounds, activeRound, stageStates, views }: Props) {
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

  const blockedStates = stageStates.filter(s => s.status === 'blocked')

  // Compute readiness from current stageStates prop
  const incompleteFromProps: IncompleteItem[] = activeRound
    ? stageStates.filter(s => s.status !== 'done').map(s => ({
        viewLabel: views.find(v => v.id === s.project_view_id)?.label ?? '?',
        stageLabel: STAGE_LABELS[s.stage],
        status: s.status,
      }))
    : []

  const deliveryReady = activeRound !== null && incompleteFromProps.length === 0

  function handleMarkDelivery() {
    if (!activeRound) return
    startTransition(async () => {
      const result = await markDeliverySent(project.id, activeRound.id)
      if (result.error) {
        setFeedback(result.error)
      } else {
        setFeedback('Delivery marked as sent.')
      }
      setConfirmDelivery(false)
    })
  }

  function handleCreateRevision() {
    startTransition(async () => {
      const result = await createRevisionRound(project.id)
      if (result.error) setFeedback(result.error)
      else setFeedback('Revision round created.')
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
        project.id, state.delivery_round_id, state.project_view_id, state.stage,
      )
      if (result.error) setFeedback(result.error)
      else setFeedback('Stage unblocked.')
    })
  }

  const viewLabel = (viewId: string) => views.find(v => v.id === viewId)?.label ?? '—'

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
                    {viewLabel(state.project_view_id)}
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
          {activeRound && (
            <span className={`text-[10px] font-medium ${deliveryReady ? 'text-done-text' : 'text-warn-text'}`}>
              {deliveryReady ? 'Ready' : `${incompleteFromProps.length} stage${incompleteFromProps.length > 1 ? 's' : ''} incomplete`}
            </span>
          )}
        </div>

        {/* Incomplete stages list */}
        {activeRound && !deliveryReady && incompleteFromProps.length > 0 && incompleteFromProps.length <= 6 && (
          <div className="mb-3 space-y-1">
            {incompleteFromProps.slice(0, 6).map((item, i) => (
              <div key={i} className="text-[11px] text-ink-3">
                {item.viewLabel} · {item.stageLabel} — <span className="text-warn-text">{item.status}</span>
              </div>
            ))}
            {incompleteFromProps.length > 6 && (
              <div className="text-[11px] text-ink-3">…and {incompleteFromProps.length - 6} more</div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {activeRound && !confirmDelivery && (
            <button
              onClick={() => setConfirmDelivery(true)}
              disabled={isPending || !deliveryReady}
              title={!deliveryReady ? `${incompleteFromProps.length} stage(s) not done` : undefined}
              className="px-3 py-1.5 bg-surface text-ink text-[12px] border border-line-strong rounded-md hover:bg-elevated disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Mark delivery sent
            </button>
          )}
          {confirmDelivery && (
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-ink-2">
                Confirm {roundLabel(project.current_round_number)} delivered?
              </span>
              <button onClick={handleMarkDelivery} disabled={isPending} className="px-3 py-1.5 bg-accent text-canvas text-[12px] font-medium rounded-md hover:bg-accent-dim disabled:opacity-40 transition-colors">
                Confirm
              </button>
              <button onClick={() => setConfirmDelivery(false)} className="px-3 py-1.5 text-[12px] text-ink-3 hover:text-ink-2 transition-colors">
                Cancel
              </button>
            </div>
          )}
          {(project.status === 'waiting_for_feedback' || project.status === 'delivered') && (
            <button
              onClick={handleCreateRevision}
              disabled={isPending}
              className="px-3 py-1.5 bg-surface text-ink text-[12px] border border-line-strong rounded-md hover:bg-elevated disabled:opacity-40 transition-colors"
            >
              Create revision round
            </button>
          )}
        </div>
      </div>

      {/* Rounds list */}
      {rounds.length > 0 && (
        <div className="bg-surface border border-line rounded-md p-4">
          <h3 className="text-[10px] tracking-[0.12em] uppercase text-ink-3 mb-3">Rounds</h3>
          <div className="space-y-1.5">
            {rounds.map(round => (
              <div key={round.id} className="flex items-center justify-between">
                <span className="text-[12px] text-ink-2">{roundLabel(round.round_number)}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                  round.status === 'delivered'
                    ? 'bg-done-bg text-done-text'
                    : round.status === 'active'
                      ? 'bg-progress-bg text-progress-text'
                      : 'bg-warn-bg text-warn-text'
                }`}>
                  {round.status === 'delivered' ? 'Delivered'
                    : round.status === 'active' ? 'Active'
                    : 'Revision requested'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {feedback && (
        <p className="text-[12px] text-ink-2">{feedback}</p>
      )}
    </div>
  )
}
