'use client'

import { useState, useTransition, useMemo } from 'react'
import { createClient, updateClient, archiveClient } from '@/lib/actions/clients'
import type { ClientStatus } from '@/lib/types/database'
import { CLIENT_STATUS_LABELS } from '@/lib/types/app'

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

const fieldClass = 'w-full px-3 py-2 bg-surface border border-line rounded-md text-[13px] text-ink placeholder-ink-3 focus:outline-none focus:border-accent transition-colors hover:border-line-strong [color-scheme:dark]'
const labelClass = 'block text-[11px] tracking-[0.08em] uppercase text-ink-3 mb-1'

function ClientForm({
  initial,
  onSave,
  onCancel,
  isPending,
}: {
  initial?: Partial<ClientRow>
  onSave: (data: Record<string, string>) => void
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
          <input value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. Journey" className={fieldClass} />
        </div>
        <div>
          <label className={labelClass}>Status</label>
          <select value={status} onChange={e => setStatus(e.target.value as ClientStatus)} className={fieldClass}>
            {(Object.keys(CLIENT_STATUS_LABELS) as ClientStatus[]).map(s => (
              <option key={s} value={s}>{CLIENT_STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Contact name</label>
          <input value={contactName} onChange={e => setContactName(e.target.value)} placeholder="Jane Smith" className={fieldClass} />
        </div>
        <div>
          <label className={labelClass}>Contact email</label>
          <input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="jane@company.com" className={fieldClass} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Phone</label>
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+1 555 000 0000" className={fieldClass} />
        </div>
        <div>
          <label className={labelClass}>Website</label>
          <input value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://company.com" className={fieldClass} />
        </div>
      </div>
      <div>
        <label className={labelClass}>Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Internal notes…" className={`${fieldClass} resize-none`} />
      </div>
      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={isPending || !name.trim()}
          className="px-4 py-1.5 bg-accent text-canvas text-[12px] font-medium rounded-md hover:bg-accent-dim disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {isPending ? 'Saving…' : (initial?.id ? 'Save changes' : 'Create client')}
        </button>
        <button type="button" onClick={onCancel} className="text-[12px] text-ink-3 hover:text-ink-2 transition-colors">
          Cancel
        </button>
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

  function handleCreate(data: Record<string, string>) {
    setError(null)
    startTransition(async () => {
      const result = await createClient(data as any)
      if (result.error) { setError(result.error); return }
      setClients(prev => [...prev, { ...result.data, projectCount: 0 }])
      setShowCreate(false)
    })
  }

  function handleUpdate(id: string, data: Record<string, string>) {
    setError(null)
    startTransition(async () => {
      const result = await updateClient(id, data as any)
      if (result.error) { setError(result.error); return }
      setClients(prev => prev.map(c => c.id === id ? { ...c, ...result.data } : c))
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
    <div>
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-5">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search clients…"
          className="w-64 px-3 py-1.5 bg-surface border border-line rounded-md text-[13px] text-ink placeholder-ink-3 focus:outline-none focus:border-accent transition-colors hover:border-line-strong"
        />
        <span className="text-[11px] text-ink-3 ml-1">{filtered.length} client{filtered.length !== 1 ? 's' : ''}</span>
        <button
          onClick={() => { setShowCreate(v => !v); setEditId(null) }}
          className="ml-auto px-3 py-1.5 bg-accent text-canvas text-[12px] font-medium rounded-md hover:bg-accent-dim transition-colors"
        >
          {showCreate ? 'Cancel' : '+ New client'}
        </button>
      </div>

      {/* Inline create form */}
      {showCreate && (
        <div className="mb-5 p-4 bg-surface border border-line rounded-md">
          <p className="text-[11px] tracking-[0.1em] uppercase text-ink-3 mb-3">New client</p>
          <ClientForm
            onSave={handleCreate}
            onCancel={() => setShowCreate(false)}
            isPending={isPending}
          />
        </div>
      )}

      {error && <p className="mb-4 text-[12px] text-blocked-text">{error}</p>}

      {/* Table */}
      <div className="border border-line rounded-md overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-line bg-elevated">
              <th className="text-left px-4 py-2.5 text-[11px] tracking-[0.08em] uppercase text-ink-3 font-medium">Company</th>
              <th className="text-left px-4 py-2.5 text-[11px] tracking-[0.08em] uppercase text-ink-3 font-medium">Contact</th>
              <th className="text-left px-4 py-2.5 text-[11px] tracking-[0.08em] uppercase text-ink-3 font-medium">Email</th>
              <th className="text-center px-4 py-2.5 text-[11px] tracking-[0.08em] uppercase text-ink-3 font-medium">Projects</th>
              <th className="text-left px-4 py-2.5 text-[11px] tracking-[0.08em] uppercase text-ink-3 font-medium">Status</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-[13px] text-ink-3">
                  {search ? 'No clients match your search.' : 'No clients yet.'}
                </td>
              </tr>
            )}
            {filtered.map((c, i) => (
              <>
                <tr
                  key={c.id}
                  className={`${i > 0 ? 'border-t border-line' : ''} ${editId === c.id ? 'bg-surface' : 'hover:bg-elevated'} transition-colors`}
                >
                  <td className="px-4 py-3 text-ink font-medium">{c.name}</td>
                  <td className="px-4 py-3 text-ink-2">{c.contact_name ?? <span className="text-ink-3">—</span>}</td>
                  <td className="px-4 py-3 text-ink-2">
                    {c.contact_email
                      ? <a href={`mailto:${c.contact_email}`} className="hover:text-accent transition-colors">{c.contact_email}</a>
                      : <span className="text-ink-3">—</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-center text-ink-2">{c.projectCount}</td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${statusDot[c.status]}`} />
                      <span className="text-ink-2">{CLIENT_STATUS_LABELS[c.status]}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3 justify-end">
                      <button
                        onClick={() => setEditId(editId === c.id ? null : c.id)}
                        className="text-[11px] text-ink-3 hover:text-ink-2 transition-colors"
                      >
                        {editId === c.id ? 'Close' : 'Edit'}
                      </button>
                      {c.status !== 'archived' && (
                        <button
                          onClick={() => handleArchive(c.id)}
                          disabled={isPending}
                          className="text-[11px] text-ink-3 hover:text-blocked-text transition-colors disabled:opacity-40"
                        >
                          Archive
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                {editId === c.id && (
                  <tr key={`${c.id}-edit`} className="border-t border-line bg-surface">
                    <td colSpan={6} className="px-4 py-4">
                      <ClientForm
                        initial={c}
                        onSave={data => handleUpdate(c.id, data)}
                        onCancel={() => setEditId(null)}
                        isPending={isPending}
                      />
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
