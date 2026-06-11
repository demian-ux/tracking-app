'use client'

import { Fragment, useState, useTransition, useMemo } from 'react'
import { createClient, updateClient, archiveClient, type ClientInput } from '@/lib/actions/clients'
import type { ClientStatus } from '@/lib/types/database'
import { CLIENT_STATUS_LABELS } from '@/lib/types/app'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input, Select } from '@/components/ui/Input'
import { SectionLabel } from '@/components/ui/SectionLabel'
import { EmptyState } from '@/components/ui/EmptyState'
import { Icon } from '@/components/ui/Icon'

interface ClientRow {
  id: string
  name: string
  contact_name: string | null
  contact_email: string | null
  phone: string | null
  website: string | null
  notes: string | null
  status: ClientStatus
  projectCount: number
}

const labelClass = 'block text-label font-semibold uppercase text-ink-3 mb-1'

function ClientForm({
  initial,
  onSave,
  onCancel,
  isPending,
}: {
  initial?: Partial<ClientRow>
  onSave: (data: ClientInput) => void
  onCancel: () => void
  isPending: boolean
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [contactName, setContactName] = useState(initial?.contact_name ?? '')
  const [contactEmail, setContactEmail] = useState(initial?.contact_email ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [website, setWebsite] = useState(initial?.website ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [status, setStatus] = useState<ClientStatus>(initial?.status ?? 'active')

  return (
    <form
      onSubmit={e => {
        e.preventDefault()
        onSave({ name, contact_name: contactName, contact_email: contactEmail, phone, website, notes, status })
      }}
      className="space-y-3"
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Company name *</label>
          <Input value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. Journey" />
        </div>
        <div>
          <label className={labelClass}>Status</label>
          <Select value={status} onChange={e => setStatus(e.target.value as ClientStatus)}>
            {(Object.keys(CLIENT_STATUS_LABELS) as ClientStatus[]).map(s => (
              <option key={s} value={s}>{CLIENT_STATUS_LABELS[s]}</option>
            ))}
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Contact name</label>
          <Input value={contactName} onChange={e => setContactName(e.target.value)} placeholder="Jane Smith" />
        </div>
        <div>
          <label className={labelClass}>Contact email</label>
          <Input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="jane@company.com" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Phone</label>
          <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+1 555 000 0000" />
        </div>
        <div>
          <label className={labelClass}>Website</label>
          <Input value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://company.com" />
        </div>
      </div>
      <div>
        <label className={labelClass}>Notes</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          placeholder="Internal notes…"
          className="w-full px-3 py-2 bg-surface border border-line rounded-sm text-body text-ink placeholder:text-ink-3 transition-colors duration-100 ease-out [color-scheme:dark] hover:border-line-strong focus:outline-none focus:border-accent resize-none"
        />
      </div>
      <div className="flex items-center gap-3 pt-1">
        <Button
          type="submit"
          variant="primary"
          size="sm"
          loading={isPending}
          disabled={!name.trim()}
        >
          {initial?.id ? 'Save changes' : 'Create client'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

export function ClientsClient({ clients: initial }: { clients: ClientRow[] }) {
  const [clients, setClients] = useState<ClientRow[]>(initial)
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return clients.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.contact_name ?? '').toLowerCase().includes(q) ||
      (c.contact_email ?? '').toLowerCase().includes(q)
    )
  }, [clients, search])

  function handleCreate(data: ClientInput) {
    setError(null)
    startTransition(async () => {
      const result = await createClient(data)
      const created = 'data' in result ? result.data : null
      if (result.error || !created) { setError(result.error ?? 'Create failed'); return }
      setClients(prev => [...prev, { ...created, projectCount: 0 }])
      setShowCreate(false)
    })
  }

  function handleUpdate(id: string, data: ClientInput) {
    setError(null)
    startTransition(async () => {
      const result = await updateClient(id, data)
      const updated = 'data' in result ? result.data : null
      if (result.error || !updated) { setError(result.error ?? 'Update failed'); return }
      setClients(prev => prev.map(c => c.id === id ? { ...c, ...updated } : c))
      setEditId(null)
    })
  }

  function handleArchive(id: string) {
    setError(null)
    startTransition(async () => {
      const result = await archiveClient(id)
      if (result.error) { setError(result.error as string); return }
      setClients(prev => prev.map(c => c.id === id ? { ...c, status: 'archived' } : c))
    })
  }

  const statusDot: Record<ClientStatus, string> = {
    active:   'bg-accent',
    inactive: 'bg-ink-3',
    archived: 'bg-blocked-text',
  }

  return (
    <div className="space-y-8">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="w-64">
          <Input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search clients…"
          />
        </div>
        <span className="text-caption text-ink-3">
          {filtered.length} client{filtered.length !== 1 ? 's' : ''}
        </span>
        <div className="ml-auto">
          <Button
            variant={showCreate ? 'ghost' : 'primary'}
            size="sm"
            leftIcon={showCreate ? undefined : 'plus'}
            onClick={() => { setShowCreate(v => !v); setEditId(null) }}
          >
            {showCreate ? 'Cancel' : 'New client'}
          </Button>
        </div>
      </div>

      {/* Inline create form */}
      {showCreate && (
        <section>
          <SectionLabel>New client</SectionLabel>
          <Card>
            <ClientForm
              onSave={handleCreate}
              onCancel={() => setShowCreate(false)}
              isPending={isPending}
            />
          </Card>
        </section>
      )}

      {error && (
        <div className="p-3 bg-blocked-bg border border-blocked-text/20 rounded-md">
          <p className="text-caption text-blocked-text">{error}</p>
        </div>
      )}

      {/* Table */}
      <section>
        <SectionLabel count={filtered.length}>Clients</SectionLabel>
        {filtered.length === 0 ? (
          <EmptyState
            icon="user"
            title={search ? 'No matches' : 'No clients yet'}
            sub={search ? 'No clients match your search.' : 'Create your first client to get started.'}
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Contact</th>
                  <th>Email</th>
                  <th>Projects</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <Fragment key={c.id}>
                    <tr>
                      <td className="primary">{c.name}</td>
                      <td>{c.contact_name ?? <span className="text-ink-faint">—</span>}</td>
                      <td>
                        {c.contact_email
                          ? <a href={`mailto:${c.contact_email}`} className="hover:text-accent transition-colors">{c.contact_email}</a>
                          : <span className="text-ink-faint">—</span>
                        }
                      </td>
                      <td className="tabular-nums">{c.projectCount}</td>
                      <td>
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${statusDot[c.status]}`} />
                          <span>{CLIENT_STATUS_LABELS[c.status]}</span>
                        </span>
                      </td>
                      <td>
                        <div className="flex items-center gap-2 justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            leftIcon="pencil"
                            onClick={() => setEditId(editId === c.id ? null : c.id)}
                          >
                            {editId === c.id ? 'Close' : 'Edit'}
                          </Button>
                          {c.status !== 'archived' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              leftIcon="archive"
                              disabled={isPending}
                              onClick={() => handleArchive(c.id)}
                            >
                              Archive
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {editId === c.id && (
                      <tr>
                        <td colSpan={6}>
                          <ClientForm
                            initial={c}
                            onSave={data => handleUpdate(c.id, data)}
                            onCancel={() => setEditId(null)}
                            isPending={isPending}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
