'use client'

import { useState, useTransition } from 'react'
import { markDeliverySent, createRevisionRound } from '@/lib/actions/delivery'
import type { IncompleteItem } from '@/lib/actions/delivery'
import { updateProjectDates, updateProjectStatus, updateProjectViewCount } from '@/lib/actions/projects'
import { unblockStage } from '@/lib/actions/stages'
import type { Project, ProjectViewRound } from '@/lib/types/app'
import type { TimeWindow, StageType } from '@/lib/types/database'
import { TIME_WINDOWS, STAGE_LABELS, ACTIVE_PROJECT_STATUSES, PROJECT_STATUS_LABELS } from '@/lib/types/app'
import { formatDelivery, deliveryLabel } from '@/lib/utils/formatting'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { SectionLabel } from '@/components/ui/SectionLabel'
import { FilterChip } from '@/components/ui/FilterChip'
import { Icon } from '@/components/ui/Icon'
import { Input, Select } from '@/components/ui/Input'

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
  progress: number
}

type Editing = 'delivery' | 'status' | 'views' | null

function InfoCell({
  label,
  children,
  sub,
  onClick,
  active,
}: {
  label: string
  children: React.ReactNode
  sub?: React.ReactNode
  onClick?: () => void
  active?: boolean
}) {
  const cls = [
    'group flex flex-col gap-1.5 p-3 text-left border-l border-line first:border-l-0 transition-colors duration-100',
    onClick ? 'cursor-pointer hover:bg-elevated' : '',
    active ? 'bg-elevated' : '',
  ].filter(Boolean).join(' ')

  const inner = (
    <>
      <span className="flex items-center gap-1 text-label font-semibold uppercase text-ink-3">
        {label}
        {onClick && (
          <Icon name="pencil" size={10} className="opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </span>
      <span className="flex items-center gap-2 text-heading font-medium text-ink min-h-6">{children}</span>
      {sub && <span className="text-caption text-ink-2">{sub}</span>}
    </>
  )

  return onClick ? (
    <button type="button" onClick={onClick} className={cls}>{inner}</button>
  ) : (
    <div className={cls}>{inner}</div>
  )
}

export function ProjectDetailClient({ project, viewRounds, stageStates, views, progress }: Props) {
  const [isPending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<string | null>(null)
  const [confirmDelivery, setConfirmDelivery] = useState(false)

  const [editing, setEditing] = useState<Editing>(null)
  const [deliveryDate, setDeliveryDate] = useState(project.delivery_date ?? '')
  const [deliveryWindow, setDeliveryWindow] = useState<TimeWindow | ''>(project.delivery_time_window ?? '')
  const [newViewCount, setNewViewCount] = useState(project.view_count)

  const [viewsToDeliver, setViewsToDeliver] = useState<string[]>([])
  const [viewsToRevise, setViewsToRevise] = useState<string[]>([])

  const blockedStates = stageStates.filter(s => s.status === 'blocked')
  const activeRounds = viewRounds.filter(r => r.status === 'active')

  const viewReadiness = views.map(view => {
    const activeRound = activeRounds.find(r => r.project_view_id === view.id)
    if (!activeRound) return { view, ready: false, incomplete: [] as IncompleteItem[] }
    const viewStates = stageStates.filter(
      s => s.project_view_id === view.id && s.project_view_round_id === activeRound.id
    )
    const incomplete: IncompleteItem[] = viewStates
      .filter(s => s.status !== 'done')
      .map(s => ({ viewLabel: view.label, stageLabel: STAGE_LABELS[s.stage], status: s.status }))
    return { view, ready: incomplete.length === 0 && viewStates.length > 0, incomplete }
  })

  const deliveredViews = views.filter(view => {
    const rounds = viewRounds.filter(r => r.project_view_id === view.id)
    const latestRound = rounds.sort((a, b) => b.round_number - a.round_number)[0]
    return latestRound?.status === 'delivered'
  })

  function toggleViewToDeliver(viewId: string) {
    setViewsToDeliver(prev => prev.includes(viewId) ? prev.filter(id => id !== viewId) : [...prev, viewId])
  }

  function toggleViewToRevise(viewId: string) {
    setViewsToRevise(prev => prev.includes(viewId) ? prev.filter(id => id !== viewId) : [...prev, viewId])
  }

  function handleMarkDelivery() {
    if (viewsToDeliver.length === 0) return
    startTransition(async () => {
      const result = await markDeliverySent(project.id, viewsToDeliver)
      if (result.error) setFeedback(result.error)
      else { setFeedback('Delivery marked as sent.'); setViewsToDeliver([]) }
      setConfirmDelivery(false)
    })
  }

  function handleCreateRevision() {
    if (viewsToRevise.length === 0) return
    startTransition(async () => {
      const result = await createRevisionRound(project.id, viewsToRevise)
      if (result.error) setFeedback(result.error)
      else { setFeedback('Revision round created.'); setViewsToRevise([]) }
    })
  }

  function handleSaveDates() {
    startTransition(async () => {
      const result = await updateProjectDates(project.id, {
        deliveryDate: deliveryDate || null,
        deliveryTimeWindow: (deliveryWindow || null) as TimeWindow | null,
      })
      if (result.error) setFeedback(result.error)
      else setEditing(null)
    })
  }

  function handleSetStatus(status: string) {
    if (status === project.status || isPending) return
    startTransition(async () => {
      const result = await updateProjectStatus(project.id, status)
      if (result.error) setFeedback(result.error)
    })
  }

  function handleSaveViewCount() {
    startTransition(async () => {
      const result = await updateProjectViewCount(project.id, newViewCount)
      if (result.error) setFeedback(result.error)
    })
  }

  function handleUnblock(state: ViewStageStateWithUser) {
    startTransition(async () => {
      const result = await unblockStage(project.id, state.project_view_id, state.stage)
      if (result.error) setFeedback(result.error)
      else setFeedback('Stage unblocked.')
    })
  }

  const getViewLabel = (viewId: string) => views.find(v => v.id === viewId)?.label ?? '—'

  function toggleEditing(which: Exclude<Editing, null>) {
    setEditing(prev => (prev === which ? null : which))
  }

  return (
    <div className="space-y-3">
      {/* Horizontal info bar — replaces the unbalanced 4-card grid */}
      <div className="grid grid-cols-4 bg-surface border border-line rounded-md overflow-hidden">
        <InfoCell label="Delivery" active={editing === 'delivery'} onClick={() => toggleEditing('delivery')}>
          <span className="tabular-nums">
            {formatDelivery(project.delivery_date, project.delivery_time_window)}
          </span>
        </InfoCell>
        <InfoCell
          label="Progress"
          sub={<ProgressBar value={progress} showPct={false} tone={progress === 100 ? 'done' : 'accent'} />}
        >
          <span className="tabular-nums">{progress}%</span>
        </InfoCell>
        <InfoCell label="Status" active={editing === 'status'} onClick={() => toggleEditing('status')}>
          <Badge status={project.status} dot />
        </InfoCell>
        <InfoCell label="Views" active={editing === 'views'} onClick={() => toggleEditing('views')}>
          <span className="tabular-nums">{project.view_count}</span>
        </InfoCell>
      </div>

      {/* Inline editors — appear under the bar for the active field */}
      {editing === 'delivery' && (
        <Card>
          <div className="flex items-end gap-2 flex-wrap">
            <div className="flex-1 min-w-[140px]">
              <label className="block text-label font-semibold uppercase text-ink-3 mb-1.5">Delivery date</label>
              <Input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} />
            </div>
            <div className="flex-1 min-w-[120px]">
              <label className="block text-label font-semibold uppercase text-ink-3 mb-1.5">Window</label>
              <Select value={deliveryWindow} onChange={e => setDeliveryWindow(e.target.value as TimeWindow)}>
                <option value="">No window</option>
                {TIME_WINDOWS.map(w => <option key={w} value={w}>{w}</option>)}
              </Select>
            </div>
            <Button variant="primary" onClick={handleSaveDates} loading={isPending}>Save</Button>
            <Button
              variant="ghost"
              onClick={() => {
                setEditing(null)
                setDeliveryDate(project.delivery_date ?? '')
                setDeliveryWindow(project.delivery_time_window ?? '')
              }}
            >
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {editing === 'status' && (
        <Card>
          <div className="flex flex-wrap gap-2">
            {ACTIVE_PROJECT_STATUSES.map(s => (
              <FilterChip key={s} active={s === project.status} onClick={() => handleSetStatus(s)}>
                {PROJECT_STATUS_LABELS[s]}
              </FilterChip>
            ))}
          </div>
        </Card>
      )}

      {editing === 'views' && (
        <Card>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setNewViewCount(v => Math.max(1, v - 1))}
              disabled={isPending || newViewCount <= 1}
              className="w-8 h-8 flex items-center justify-center rounded-sm border border-line-strong text-ink-2 hover:text-ink hover:border-ink-3 disabled:opacity-30 transition-colors select-none"
            >
              −
            </button>
            <span className="text-display font-semibold text-ink tabular-nums w-8 text-center">
              {newViewCount}
            </span>
            <button
              type="button"
              onClick={() => setNewViewCount(v => v + 1)}
              disabled={isPending}
              className="w-8 h-8 flex items-center justify-center rounded-sm border border-line-strong text-ink-2 hover:text-ink hover:border-ink-3 disabled:opacity-30 transition-colors select-none"
            >
              +
            </button>
            {newViewCount !== project.view_count && (
              <div className="flex gap-2 ml-2">
                <Button variant="primary" size="sm" onClick={handleSaveViewCount} loading={isPending}>
                  Apply
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setNewViewCount(project.view_count)}>
                  Reset
                </Button>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Blocked stages */}
      {blockedStates.length > 0 && (
        <section className="pt-3">
          <SectionLabel count={blockedStates.length}>Blocked stages</SectionLabel>
          <div className="space-y-2">
            {blockedStates.map(state => (
              <div
                key={state.id}
                className="flex items-center justify-between gap-3 px-4 py-3 bg-blocked-bg border border-blocked-text/20 rounded-md"
              >
                <div className="min-w-0">
                  <div className="text-body text-ink">
                    {getViewLabel(state.project_view_id)}
                    <span className="text-ink-faint mx-1.5">·</span>
                    <span className="text-ink-2">{STAGE_LABELS[state.stage]}</span>
                  </div>
                  {state.block_reason && (
                    <div className="text-caption text-blocked-text mt-0.5">{state.block_reason}</div>
                  )}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleUnblock(state)}
                  disabled={isPending}
                  className="shrink-0"
                >
                  Unblock
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Send delivery */}
      <section className="pt-3">
        <SectionLabel
          action={
            viewsToDeliver.length > 0
              ? <span className="text-caption text-ink-2">{viewsToDeliver.length} selected</span>
              : undefined
          }
        >
          Send delivery
        </SectionLabel>
        <Card>
          {(() => {
            const readyViewIds = viewReadiness.filter(r => r.ready).map(r => r.view.id)
            const allReadySelected = readyViewIds.length > 0 && readyViewIds.every(id => viewsToDeliver.includes(id))
            if (readyViewIds.length === 0) return null
            return (
              <div className="flex items-center justify-end mb-2">
                <button
                  type="button"
                  onClick={() => {
                    if (allReadySelected) {
                      setViewsToDeliver(prev => prev.filter(id => !readyViewIds.includes(id)))
                    } else {
                      setViewsToDeliver(prev => Array.from(new Set([...prev, ...readyViewIds])))
                    }
                  }}
                  disabled={isPending}
                  className="text-label font-semibold uppercase text-ink-2 hover:text-ink transition-colors px-2 py-0.5 border border-line rounded-sm hover:border-line-strong"
                >
                  {allReadySelected ? 'Clear all' : `Select all ready (${readyViewIds.length})`}
                </button>
              </div>
            )
          })()}
          {activeRounds.length > 0 && (
            <div className="space-y-2 mb-3">
              {viewReadiness.map(({ view, ready, incomplete }) => (
                <label key={view.id} className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={viewsToDeliver.includes(view.id)}
                    onChange={() => toggleViewToDeliver(view.id)}
                    disabled={!ready || isPending}
                    className="mt-0.5 shrink-0 accent-accent"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-ink">{view.label}</span>
                      <span className={`text-caption font-medium ${ready ? 'text-done-text' : 'text-warn-text'}`}>
                        {ready ? 'Ready' : `${incomplete.length} incomplete`}
                      </span>
                    </div>
                    {!ready && incomplete.length > 0 && incomplete.length <= 3 && (
                      <div className="text-caption text-ink-3">
                        {incomplete.map(i => `${i.stageLabel} (${i.status})`).join(', ')}
                      </div>
                    )}
                  </div>
                </label>
              ))}
            </div>
          )}

          {activeRounds.length > 0 && !confirmDelivery && (
            <Button
              variant="primary"
              leftIcon="send"
              onClick={() => setConfirmDelivery(true)}
              disabled={isPending || viewsToDeliver.length === 0}
            >
              Mark delivery sent
            </Button>
          )}
          {confirmDelivery && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-ink-2">
                Confirm {viewsToDeliver.length} view{viewsToDeliver.length > 1 ? 's' : ''} delivered?
              </span>
              <Button variant="primary" onClick={handleMarkDelivery} loading={isPending}>Confirm</Button>
              <Button variant="ghost" onClick={() => setConfirmDelivery(false)}>Cancel</Button>
            </div>
          )}
        </Card>
      </section>

      {/* Revision */}
      {(project.status === 'waiting_for_feedback' || project.status === 'delivered') && deliveredViews.length > 0 && (
        <section className="pt-3">
          <SectionLabel
            action={
              viewsToRevise.length > 0
                ? <span className="text-caption text-ink-2">{viewsToRevise.length} selected</span>
                : undefined
            }
          >
            Revision
          </SectionLabel>
          <Card>
            <div className="space-y-2 mb-3">
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
                      className="shrink-0 accent-accent"
                    />
                    <span className="text-sm text-ink">{view.label}</span>
                    {latestRound && (
                      <span className="text-caption text-ink-3">
                        {deliveryLabel(latestRound.round_number)} sent
                      </span>
                    )}
                  </label>
                )
              })}
            </div>
            <Button
              variant="secondary"
              leftIcon="rotate"
              onClick={handleCreateRevision}
              disabled={isPending || viewsToRevise.length === 0}
            >
              Create revision round
            </Button>
          </Card>
        </section>
      )}

      {feedback && <p className="text-caption text-ink-2 pt-1">{feedback}</p>}
    </div>
  )
}
