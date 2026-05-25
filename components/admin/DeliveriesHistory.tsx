'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { undoDeliverySent } from '@/lib/actions/delivery'
import { deliveryLabel } from '@/lib/utils/formatting'
import { SectionLabel } from '@/components/ui/SectionLabel'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'

export interface DeliveryGroup {
  projectId: string
  deliveredAt: string
  projectName: string
  clientName: string | null
  views: { id: string; label: string; roundNumber: number }[]
}

interface Props {
  groups: DeliveryGroup[]
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

export function DeliveriesHistory({ groups }: Props) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [confirmKey, setConfirmKey] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)

  if (groups.length === 0) {
    return (
      <section className="mb-6">
        <SectionLabel>Past deliveries</SectionLabel>
        <p className="text-caption text-ink-3">No deliveries sent yet.</p>
      </section>
    )
  }

  function handleUndo(group: DeliveryGroup) {
    const key = `${group.projectId}::${group.deliveredAt}`
    setPendingKey(key)
    setFeedback(null)
    startTransition(async () => {
      const result = await undoDeliverySent(group.projectId, group.deliveredAt)
      setPendingKey(null)
      setConfirmKey(null)
      if (result.error) setFeedback({ ok: false, msg: result.error })
      else setFeedback({
        ok: true,
        msg: `Reverted ${group.views.length} view${group.views.length > 1 ? 's' : ''} for ${group.projectName}.`,
      })
    })
  }

  return (
    <section className="mb-6">
      <SectionLabel
        count={groups.length}
        action={
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            className="text-label font-semibold uppercase text-ink-2 hover:text-ink transition-colors px-2 py-0.5 border border-line rounded-sm hover:border-line-strong"
          >
            {open ? 'Hide' : 'Show'}
          </button>
        }
      >
        Past deliveries
      </SectionLabel>

      {open && (
        <div className="space-y-2 mt-2">
          {feedback && (
            <p className={`text-caption ${feedback.ok ? 'text-done-text' : 'text-blocked-text'}`}>
              {feedback.msg}
            </p>
          )}

          {groups.map(group => {
            const key = `${group.projectId}::${group.deliveredAt}`
            const isConfirming = confirmKey === key
            const isThisPending = pendingKey === key
            return (
              <div
                key={key}
                className="bg-surface border border-line rounded-md px-4 py-3 flex items-start gap-3 flex-wrap"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-body">
                    {group.clientName && <span className="text-ink-3">{group.clientName} /</span>}
                    <Link
                      href={`/admin/projects/${group.projectId}`}
                      className="text-ink hover:text-accent transition-colors"
                    >
                      {group.projectName}
                    </Link>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5 text-caption text-ink-2 flex-wrap">
                    <Icon name="send" size={11} className="text-ink-3" />
                    <span>{formatTimestamp(group.deliveredAt)}</span>
                    <span className="text-ink-faint">·</span>
                    <span>
                      {group.views.length} view{group.views.length > 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {group.views.map(v => (
                      <span
                        key={v.id}
                        className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-done-bg text-done-text"
                      >
                        {v.label}
                        <span className="opacity-60">{deliveryLabel(v.roundNumber)}</span>
                      </span>
                    ))}
                  </div>
                </div>

                <div className="shrink-0">
                  {!isConfirming ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon="rotate"
                      onClick={() => setConfirmKey(key)}
                      disabled={isPending}
                    >
                      Undo
                    </Button>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => handleUndo(group)}
                        loading={isThisPending}
                      >
                        Confirm
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmKey(null)}
                        disabled={isThisPending}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
