import { createClient } from '@/lib/supabase/server'
import { ClientsClient } from '@/components/admin/ClientsClient'
import type { ClientStatus, ProjectStatus } from '@/lib/types/database'

interface ClientRow {
  id: string
  name: string
  contact_name: string | null
  contact_email: string | null
  phone?: string | null
  website?: string | null
  notes?: string | null
  status?: ClientStatus
  projects?: { id: string; status: ProjectStatus }[]
}

export default async function ClientsPage() {
  const supabase = await createClient()

  const clientsQuery = await supabase
    .from('clients')
    .select('id, name, contact_name, contact_email, phone, website, notes, status, projects(id, status)')
    .order('name')
  let clientRows = clientsQuery.data as unknown as ClientRow[] | null
  let clientsError = clientsQuery.error

  if (clientsError?.message?.includes('Could not find the') && clientsError.message.includes("column of 'clients'")) {
    const fallback = await supabase
      .from('clients')
      .select('id, name, contact_name, contact_email, projects(id, status)')
      .order('name')

    clientRows = fallback.data as unknown as ClientRow[] | null
    clientsError = fallback.error
  }

  const clients = (clientRows ?? []).map(c => ({
    id: c.id,
    name: c.name,
    contact_name: c.contact_name,
    contact_email: c.contact_email,
    phone: c.phone ?? null,
    website: c.website ?? null,
    notes: c.notes ?? null,
    status: c.status ?? 'active',
    projectCount: (c.projects ?? []).filter(p => p.status !== 'archived').length,
  }))

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-[15px] font-medium text-ink">Clients</h1>
      </div>
      <ClientsClient clients={clients} />
    </div>
  )
}
