'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createProject } from '@/lib/actions/projects'
import { createClient } from '@/lib/actions/clients'
import type { TimeWindow } from '@/lib/types/database'
import { TIME_WINDOWS } from '@/lib/types/app'

interface Client {
  id: string
  name: string
}

const fieldClass = 'w-full px-3 py-2 bg-surface border border-line rounded-md text-[13px] text-ink placeholder-ink-3 focus:outline-none focus:border-accent transition-colors hover:border-line-strong [color-scheme:dark]'
const labelClass = 'block text-[11px] tracking-[0.08em] uppercase text-ink-3 mb-1.5'

const NEW_CLIENT_SENTINEL = '__new__'

export function NewProjectForm({ clients: initialClients }: { clients: Client[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Project fields
  const [name, setName] = useState('')
  const [clientId, setClientId] = useState('')
  const [deliveryDate, setDeliveryDate] = useState('')
  const [deliveryWindow, setDeliveryWindow] = useState<TimeWindow | ''>('')
  const [viewCount, setViewCount] = useState(3)

  // Client list (grows when user creates inline)
  const [clients, setClients] = useState<Client[]>(initialClients)

  // Inline new-client form state
  const [showNewClient, setShowNewClient] = useState(false)
  const [newClientName, setNewClientName] = useState('')
  const [newClientContact, setNewClientContact] = useState('')
  const [newClientEmail, setNewClientEmail] = useState('')
  const [clientPending, startClientTransition] = useTransition()
  const [clientError, setClientError] = useState<string | null>(null)

  function handleClientChange(value: string) {
    if (value === NEW_CLIENT_SENTINEL) {
      setShowNewClient(true)
      setClientId('')
    } else {
      setShowNewClient(false)
      setClientId(value)
    }
  }

  function handleCreateClient(e: React.FormEvent) {
    e.preventDefault()
    setClientError(null)
    startClientTransition(async () => {
      const result = await createClient({
        name: newClientName,
        contact_name: newClientContact || null,
        contact_email: newClientEmail || null,
      })
      if (result.error) { setClientError(result.error as string); return }
      const created = result.data as Client
      setClients(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
      setClientId(created.id)
      setShowNewClient(false)
      setNewClientName('')
      setNewClientContact('')
      setNewClientEmail('')
    })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!clientId) { setError('Select a client before creating the project.'); return }
    setError(null)

    startTransition(async () => {
      const result = await createProject({
        name,
        clientId,
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

      {/* Client selector */}
      <div>
        <label className={labelClass}>Client <span className="text-blocked-text">*</span></label>
        <select
          value={showNewClient ? NEW_CLIENT_SENTINEL : clientId}
          onChange={e => handleClientChange(e.target.value)}
          required={!showNewClient}
          className={fieldClass}
        >
          <option value="">Select a client…</option>
          {clients.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
          <option value={NEW_CLIENT_SENTINEL}>+ New client…</option>
        </select>
      </div>

      {/* Inline new-client form */}
      {showNewClient && (
        <div className="pl-3 border-l-2 border-accent/40 space-y-3">
          <p className="text-[11px] tracking-[0.08em] uppercase text-accent">New client</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Company name *</label>
              <input
                value={newClientName}
                onChange={e => setNewClientName(e.target.value)}
                required
                placeholder="e.g. Journey"
                className={fieldClass}
              />
            </div>
            <div>
              <label className={labelClass}>Contact name</label>
              <input
                value={newClientContact}
                onChange={e => setNewClientContact(e.target.value)}
                placeholder="Jane Smith"
                className={fieldClass}
              />
            </div>
          </div>
          <div>
            <label className={labelClass}>Contact email</label>
            <input
              type="email"
              value={newClientEmail}
              onChange={e => setNewClientEmail(e.target.value)}
              placeholder="jane@company.com"
              className={fieldClass}
            />
          </div>
          {clientError && <p className="text-[12px] text-blocked-text">{clientError}</p>}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleCreateClient}
              disabled={clientPending || !newClientName.trim()}
              className="px-3 py-1.5 bg-elevated border border-line text-[12px] text-ink rounded-md hover:border-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {clientPending ? 'Creating…' : 'Create & select'}
            </button>
            <button
              type="button"
              onClick={() => { setShowNewClient(false); setClientId('') }}
              className="text-[12px] text-ink-3 hover:text-ink-2 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

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

      {error && <p className="text-[12px] text-blocked-text">{error}</p>}

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={isPending || !name || !clientId}
          className="px-4 py-2 bg-accent text-canvas text-[13px] font-medium rounded-md hover:bg-accent-dim disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {isPending ? 'Creating…' : 'Create project'}
        </button>
        <Link
          href="/admin/projects"
          className="text-[13px] text-ink-3 hover:text-ink-2 transition-colors"
        >
          Cancel
        </Link>
      </div>
    </form>
  )
}
