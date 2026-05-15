// @ts-nocheck
import { createClient } from '@/lib/supabase/server'
import { ClientsClient } from '@/components/admin/ClientsClient'

export default async function ClientsPage() {
  const supabase = await createClient()

  const { data: clientRows } = await supabase
    .from('clients')
    .select('id, name, contact_name, contact_email, phone, website, notes, status, projects(id, status)')
    .order('name')

  const clients = (clientRows ?? []).map(c => ({
    id: c.id,
    name: c.name,
    contact_name: c.contact_name,
    contact_email: c.contact_email,
    phone: c.phone,
    website: c.website,
    notes: c.notes,
    status: c.status ?? 'active',
    projectCount: (c.projects ?? []).filter((p: any) => p.status !== 'archived').length,
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
