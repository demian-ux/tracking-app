'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { archiveProject, deleteProjectPermanently } from '@/lib/actions/projects'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'

type Pending = 'archive' | 'delete' | null

export function ProjectCleanupActions({
  projectId,
  projectName,
  viewCount,
  afterDeleteHref,
  compact = false,
  prominent = false,
}: {
  projectId: string
  projectName: string
  viewCount?: number
  afterDeleteHref?: string
  compact?: boolean
  prominent?: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState<Pending>(null)
  const [error, setError] = useState<string | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  const deleteReady = deleteConfirmText === 'DELETE PROJECT'

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
      const result = await deleteProjectPermanently(projectId, deleteConfirmText)
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

  const openArchive = () => { setConfirming('archive'); setError(null) }
  const openDelete = () => { setConfirming('delete'); setError(null); setDeleteConfirmText('') }

  return (
    <>
      {compact ? (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={openArchive} disabled={isPending}>Archive</Button>
          <Button variant="danger" size="sm" onClick={openDelete} disabled={isPending}>Delete</Button>
        </div>
      ) : prominent ? (
        <Card>
          <div className="mb-3">
            <p className="text-sm font-medium text-ink">Archive or delete</p>
            <p className="text-caption text-ink-3 mt-0.5">
              Archive keeps history. Delete permanently removes this project.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" leftIcon="archive" onClick={openArchive} disabled={isPending}>
              Archive project
            </Button>
            <Button variant="danger" size="sm" onClick={openDelete} disabled={isPending}>
              Delete project permanently
            </Button>
          </div>
        </Card>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" leftIcon="archive" onClick={openArchive} disabled={isPending}>
            Archive project
          </Button>
          <Button variant="danger" size="sm" onClick={openDelete} disabled={isPending}>
            Delete project permanently
          </Button>
        </div>
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <div className="w-full max-w-sm bg-canvas border border-line-strong rounded-lg p-6 shadow-xl">
            {confirming === 'archive' ? (
              <>
                <p className="text-body font-medium text-ink mb-1">Archive project?</p>
                <p className="text-sm text-ink-3 mb-1 truncate">{projectName}</p>
                <p className="text-caption text-ink-3 mb-5">
                  Hides from the widget and active lists. All data and history are kept.
                </p>
                {error && <p className="text-caption text-blocked-text mb-3">{error}</p>}
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" onClick={closeModal} disabled={isPending}>Cancel</Button>
                  <Button variant="secondary" size="sm" onClick={handleArchive} loading={isPending}>Archive</Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-body font-medium text-ink mb-1">Delete project permanently?</p>
                <p className="text-sm text-ink-2 mb-1 truncate">{projectName}</p>
                {viewCount !== undefined && (
                  <p className="text-caption text-ink-3 mb-1">{viewCount} view{viewCount !== 1 ? 's' : ''}</p>
                )}
                <p className="text-caption text-blocked-text mb-4">
                  All views, rounds, stage states, and history will be permanently removed. This cannot be undone.
                </p>

                <div className="mb-4">
                  <label className="block text-caption text-ink-3 mb-1.5">
                    Type <span className="font-mono font-medium text-ink-2">DELETE PROJECT</span> to confirm
                  </label>
                  <Input
                    type="text"
                    value={deleteConfirmText}
                    onChange={e => setDeleteConfirmText(e.target.value)}
                    placeholder="DELETE PROJECT"
                    autoFocus
                    className="font-mono"
                  />
                </div>

                {error && <p className="text-caption text-blocked-text mb-3">{error}</p>}
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" onClick={closeModal} disabled={isPending}>Cancel</Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={handleDelete}
                    disabled={isPending || !deleteReady}
                    loading={isPending}
                  >
                    Delete permanently
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
