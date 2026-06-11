'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createProject } from '@/lib/actions/projects'
import { createClient } from '@/lib/actions/clients'
import type { TimeWindow } from '@/lib/types/database'
import { TIME_WINDOWS } from '@/lib/types/app'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'

interface Client {
  id: string
  name: string
}

const labelClass = 'block text-label font-semibold uppercase text-ink-3 mb-1.5'

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
        <label className={labelClass} htmlFor="np-name">Project name</label>
        <Input
          id="np-name"
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          required
          placeholder="e.g. Food Hall"
        />
      </div>

      {/* Client selector */}
      <div>
        <label className={labelClass} htmlFor="np-client">Client <span className="text-blocked-text">*</span></label>
        <Select
          id="np-client"
          value={showNewClient ? NEW_CLIENT_SENTINEL : clientId}
          onChange={e => handleClientChange(e.target.value)}
          required={!showNewClient}
        >
          <option value="">Select a client…</option>
          {clients.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
          <option value={NEW_CLIENT_SENTINEL}>+ New client…</option>
        </Select>
      </div>

      {/* Inline new-client form */}
      {showNewClient && (
        <div className="pl-3 border-l-2 border-accent/40 space-y-3">
          <p className="text-label font-semibold uppercase text-accent">New client</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass} htmlFor="np-client-name">Company name *</label>
              <Input
                id="np-client-name"
                value={newClientName}
                onChange={e => setNewClientName(e.target.value)}
                required
                placeholder="e.g. Journey"
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="np-client-contact">Contact name</label>
              <Input
                id="np-client-contact"
                value={newClientContact}
                onChange={e => setNewClientContact(e.target.value)}
                placeholder="Jane Smith"
              />
            </div>
          </div>
          <div>
            <label className={labelClass} htmlFor="np-client-email">Contact email</label>
            <Input
              id="np-client-email"
              type="email"
              value={newClientEmail}
              onChange={e => setNewClientEmail(e.target.value)}
              placeholder="jane@company.com"
            />
          </div>
          {clientError && <p className="text-sm text-blocked-text">{clientError}</p>}
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={clientPending}
              disabled={!newClientName.trim()}
              onClick={handleCreateClient}
            >
              Create & select
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => { setShowNewClient(false); setClientId('') }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <div className="flex-1">
          <label className={labelClass} htmlFor="np-delivery-date">Delivery date</label>
          <Input
            id="np-delivery-date"
            type="date"
            value={deliveryDate}
            onChange={e => setDeliveryDate(e.target.value)}
          />
        </div>
        <div className="w-36">
          <label className={labelClass} htmlFor="np-delivery-window">Time window</label>
          <Select
            id="np-delivery-window"
            value={deliveryWindow}
            onChange={e => setDeliveryWindow(e.target.value as TimeWindow)}
          >
            <option value="">—</option>
            {TIME_WINDOWS.map(w => (
              <option key={w} value={w}>{w}</option>
            ))}
          </Select>
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="np-view-count">Number of views</label>
        <div className="w-28">
          <Input
            id="np-view-count"
            type="number"
            min={1}
            max={30}
            value={viewCount}
            onChange={e => setViewCount(parseInt(e.target.value) || 1)}
          />
        </div>
      </div>

      {error && <p className="text-sm text-blocked-text">{error}</p>}

      <div className="flex items-center gap-3 pt-2">
        <Button
          type="submit"
          variant="primary"
          loading={isPending}
          disabled={!name || !clientId}
        >
          Create project
        </Button>
        <ButtonLink href="/admin/projects" variant="ghost">
          Cancel
        </ButtonLink>
      </div>
    </form>
  )
}
