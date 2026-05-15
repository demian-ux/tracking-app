'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createProject } from '@/lib/actions/projects'
import type { TimeWindow } from '@/lib/types/database'
import { TIME_WINDOWS } from '@/lib/types/app'

interface Client {
  id: string
  name: string
}

const fieldClass = 'w-full px-3 py-2 bg-surface border border-line rounded-md text-[13px] text-ink placeholder-ink-3 focus:outline-none focus:border-accent transition-colors hover:border-line-strong [color-scheme:dark]'
const labelClass = 'block text-[11px] tracking-[0.08em] uppercase text-ink-3 mb-1.5'

export function NewProjectForm({ clients }: { clients: Client[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [clientId, setClientId] = useState('')
  const [deliveryDate, setDeliveryDate] = useState('')
  const [deliveryWindow, setDeliveryWindow] = useState<TimeWindow | ''>('')
  const [viewCount, setViewCount] = useState(3)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    startTransition(async () => {
      const result = await createProject({
        name,
        clientId: clientId || null,
        deliveryDate: deliveryDate || null,
        deliveryTimeWindow: (deliveryWindow || null) as TimeWindow | null,
        viewCount,
      })

      if (result.error) {
        setError(result.error)
      } else {
        router.push(`/admin/projects/${result.data?.id}`)
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className={labelClass}>Project name</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          required
          placeholder="e.g. Food Hall"
          className={fieldClass}
        />
      </div>

      <div>
        <label className={labelClass}>Client</label>
        <select
          value={clientId}
          onChange={e => setClientId(e.target.value)}
          className={fieldClass}
        >
          <option value="">No client</option>
          {clients.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <label className={labelClass}>Delivery date</label>
          <input
            type="date"
            value={deliveryDate}
            onChange={e => setDeliveryDate(e.target.value)}
            className={fieldClass}
          />
        </div>
        <div className="w-36">
          <label className={labelClass}>Time window</label>
          <select
            value={deliveryWindow}
            onChange={e => setDeliveryWindow(e.target.value as TimeWindow)}
            className={fieldClass}
          >
            <option value="">—</option>
            {TIME_WINDOWS.map(w => (
              <option key={w} value={w}>{w}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className={labelClass}>Number of views</label>
        <input
          type="number"
          min={1}
          max={30}
          value={viewCount}
          onChange={e => setViewCount(parseInt(e.target.value) || 1)}
          className="w-28 px-3 py-2 bg-surface border border-line rounded-md text-[13px] text-ink focus:outline-none focus:border-accent transition-colors hover:border-line-strong"
        />
      </div>

      {error && (
        <p className="text-[12px] text-blocked-text">{error}</p>
      )}

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={isPending || !name}
          className="px-4 py-2 bg-accent text-canvas text-[13px] font-medium rounded-md hover:bg-accent-dim disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {isPending ? 'Creating…' : 'Create project'}
        </button>
        <a
          href="/admin/projects"
          className="text-[13px] text-ink-3 hover:text-ink-2 transition-colors"
        >
          Cancel
        </a>
      </div>
    </form>
  )
}
