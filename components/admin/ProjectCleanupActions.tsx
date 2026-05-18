'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { archiveProject, deleteProjectPermanently } from '@/lib/actions/projects'

type Pending = 'archive' | 'delete' | null

export function ProjectCleanupActions({
  projectId,
  projectName,
  afterDeleteHref,
  compact = false,
}: {
  projectId: string
  projectName: string
  afterDeleteHref?: string
  compact?: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState<Pending>(null)
  const [error, setError] = useState<string | null>(null)

  function handleArchive() {
    setError(null)
    startTransition(async () => {
      const result = await archiveProject(projectId)
      if (result.error) { setError(result.error); return }
      setConfirming(null)
      router.refresh()
    })
  }

  function handleDelete() {
    setError(null)
    startTransition(async () => {
      const result = await deleteProjectPermanently(projectId)
      if (result.error) { setError(result.error); return }
      setConfirming(null)
      if (afterDeleteHref) router.push(afterDeleteHref)
      else router.refresh()
    })
  }

  return (
    <>
      <div className={compact ? 'flex items-center gap-2' : 'flex flex-wrap items-center gap-2'}>
        <button
          type="button"
          onClick={() => { setConfirming('archive'); setError(null) }}
          disabled={isPending}
          className="px-2.5 py-1 text-[11px] text-ink-3 border border-line rounded hover:text-ink-2 hover:border-line-strong disabled:opacity-40 transition-colors"
        >
          Archive
        </button>
        <button
          type="button"
          onClick={() => { setConfirming('delete'); setError(null) }}
          disabled={isPending}
          className="px-2.5 py-1 text-[11px] text-blocked-text border border-blocked-text/30 rounded hover:bg-blocked-bg disabled:opacity-40 transition-colors"
        >
          Delete
        </button>
      </div>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-canvas border border-line rounded-lg p-6 w-80 shadow-xl">
            <p className="text-[13px] text-ink font-medium mb-1">
              {confirming === 'archive' ? 'Archive project?' : 'Delete project permanently?'}
            </p>
            <p className="text-[12px] text-ink-3 mb-1 truncate">{projectName}</p>
            {confirming === 'delete' && (
              <p className="text-[11px] text-ink-3 mb-4">
                Removes all views, rounds, stage states, and history. Cannot be undone.
              </p>
            )}
            {confirming === 'archive' && (
              <p className="text-[11px] text-ink-3 mb-4">
                Hides from the widget. Data and history are kept.
              </p>
            )}
            {error && <p className="text-[11px] text-blocked-text mb-3">{error}</p>}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setConfirming(null); setError(null) }}
                disabled={isPending}
                className="px-3 py-1.5 text-[12px] text-ink-3 hover:text-ink-2 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirming === 'archive' ? handleArchive : handleDelete}
                disabled={isPending}
                className={`px-3 py-1.5 text-[12px] font-medium rounded-md disabled:opacity-40 transition-colors ${
                  confirming === 'delete'
                    ? 'bg-blocked-bg text-blocked-text border border-blocked-text/30 hover:border-blocked-text/60'
                    : 'bg-elevated text-ink border border-line-strong hover:border-accent hover:text-accent'
                }`}
              >
                {isPending ? '…' : confirming === 'archive' ? 'Archive' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
