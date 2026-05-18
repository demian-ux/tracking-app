'use server'

import { createClient as createSupabaseClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { ClientStatus } from '@/lib/types/database'

async function requireAdmin() {
  const supabase = await createSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase: null, user: null, error: 'Not authenticated' }
  const { data: actor } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (actor?.role !== 'admin') return { supabase: null, user: null, error: 'Forbidden' }
  return { supabase, user, error: null }
}

export interface ClientInput {
  name: string
  contact_name?: string | null
  contact_email?: string | null
  phone?: string | null
  website?: string | null
  notes?: string | null
  status?: ClientStatus
}

export async function createClient(input: ClientInput) {
  const { supabase, error } = await requireAdmin()
  if (error || !supabase) return { error }

  let { data, error: dbError } = await supabase
    .from('clients')
    .insert({
      name: input.name,
      contact_name: input.contact_name ?? null,
      contact_email: input.contact_email ?? null,
      phone: input.phone ?? null,
      website: input.website ?? null,
      notes: input.notes ?? null,
      status: input.status ?? 'active',
    })
    .select()
    .single()

  if (dbError?.message?.includes("Could not find the") && dbError.message.includes("column of 'clients'")) {
    const fallback = await supabase
      .from('clients')
      .insert({
        name: input.name,
        contact_name: input.contact_name ?? null,
        contact_email: input.contact_email ?? null,
      })
      .select()
      .single()

    data = fallback.data
    dbError = fallback.error
  }

  if (dbError) return { error: dbError.message }

  revalidatePath('/admin/clients')
  revalidatePath('/admin/projects/new')
  return { data }
}

export async function updateClient(id: string, input: ClientInput) {
  const { supabase, error } = await requireAdmin()
  if (error || !supabase) return { error }

  let { data, error: dbError } = await supabase
    .from('clients')
    .update({
      name: input.name,
      contact_name: input.contact_name ?? null,
      contact_email: input.contact_email ?? null,
      phone: input.phone ?? null,
      website: input.website ?? null,
      notes: input.notes ?? null,
      status: input.status ?? 'active',
    })
    .eq('id', id)
    .select()
    .single()

  if (dbError?.message?.includes("Could not find the") && dbError.message.includes("column of 'clients'")) {
    const fallback = await supabase
      .from('clients')
      .update({
        name: input.name,
        contact_name: input.contact_name ?? null,
        contact_email: input.contact_email ?? null,
      })
      .eq('id', id)
      .select()
      .single()

    data = fallback.data
    dbError = fallback.error
  }

  if (dbError) return { error: dbError.message }

  revalidatePath('/admin/clients')
  revalidatePath('/admin/projects')
  return { data }
}

export async function archiveClient(id: string) {
  const { supabase, error } = await requireAdmin()
  if (error || !supabase) return { error }

  const { error: dbError } = await supabase
    .from('clients')
    .update({ status: 'archived' })
    .eq('id', id)

  if (dbError) return { error: dbError.message }

  revalidatePath('/admin/clients')
  revalidatePath('/admin/projects')
  return { data: true }
}
