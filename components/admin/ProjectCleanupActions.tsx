'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { archiveProject, deleteProjectPermanently } from '@/lib/actions/projects'

type Pending = 'archive' | 'delete' | null

export function ProjectCleanupActions({
  projectId,
  projectName,
  viewCount,
  afterDeleteHref,
  compact = false,
}: {
  projectId: string
  projectName: string
  viewCount?: number
  afterDeleteHref?: string
  compact?: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState<Pending>(null)
  const [error, setError] = useState<string | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  const deleteReady = deleteConfirmText === 'DELETE'

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
    if (!deleteReady) return
    setError(null)
    startTransition(async () => {
      const result = await deleteProjectPermanently(projectId)
      if (result.error) { setError(result.error); return }
      setConfirming(null)
      if (afterDeleteHref) router.push(afterDeleteHref)
      else router.refresh()
    })
  }

  function closeModal() {
    setConfirming(null)
    setError(null)
    setDeleteConfirmText('')
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
          onClick={() => { setConfirming('delete'); setError(null); setDeleteConfirmText('') }}
          disabled={isPending}
          className="px-2.5 py-1 text-[11px] text-blocked-text border border-blocked-text/30 rounded hover:bg-blocked-bg disabled:opacity-40 transition-colors"
        >
          Delete
        </button>
      </div>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-canvas border border-line rounded-lg p-6 w-96 shadow-xl">
            {confirming === 'archive' ? (
              <>
                <p className="text-[13px] text-ink font-medium mb-1">Archive project?</p>
                <p className="text-[12px] text-ink-3 mb-1 truncate">{projectName}</p>
                <p className="text-[11px] text-ink-3 mb-5">
                  Hides from the widget and active lists. All data and history are kept.
                </p>
                {error && <p className="text-[11px] text-blocked-text mb-3">{error}</p>}
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={closeModal}
                    disabled={isPending}
                    className="px-3 py-1.5 text-[12px] text-ink-3 hover:text-ink-2 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleArchive}
                    disabled={isPending}
                    className="px-3 py-1.5 text-[12px] font-medium rounded-md bg-elevated text-ink border border-line-strong hover:border-accent hover:text-accent disabled:opacity-40 transition-colors"
                  >
                    {isPending ? '…' : 'Archive'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-[13px] text-ink font-medium mb-1">Delete project permanently?</p>
                <p className="text-[12px] text-ink-2 mb-1 truncate">{projectName}</p>
                {viewCount !== undefined && (
                  <p className="text-[11px] text-ink-3 mb-1">{viewCount} view{viewCount !== 1 ? 's' : ''}</p>
                )}
                <p className="text-[11px] text-blocked-text mb-4">
                  All views, rounds, stage states, and history will be permanently removed. This cannot be undone.
                </p>

                <div className="mb-4">
                  <label className="block text-[11px] text-ink-3 mb-1.5">
                    Type <span className="font-mono font-medium text-ink-2">DELETE</span> to confirm
                  </label>
                  <input
                    type="text"
                    value={deleteConfirmText}
                    onChange={e => setDeleteConfirmText(e.target.value)}
                    placeholder="DELETE"
                    autoFocus
                    className="w-full px-2.5 py-2 bg-canvas border border-line rounded-md text-[13px] text-ink font-mono placeholder-ink-3/40 focus:outline-none focus:border-blocked-text transition-colors"
                  />
                </div>

                {error && <p className="text-[11px] text-blocked-text mb-3">{error}</p>}
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={closeModal}
                    disabled={isPending}
                    className="px-3 py-1.5 text-[12px] text-ink-3 hover:text-ink-2 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={isPending || !deleteReady}
                    className="px-3 py-1.5 text-[12px] font-medium rounded-md bg-blocked-bg text-blocked-text border border-blocked-text/30 hover:border-blocked-text/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {isPending ? '…' : 'Delete permanently'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
