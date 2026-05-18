'use server'

import { createClient } from '@/lib/supabase/server'

export async function requireWorker() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You must be logged in.' as string, data: null }

  const { data: profile } = await supabase
    .from('users')
    .select('id, role, name, email')
    .eq('id', user.id)
    .single()

  if (!profile) return { error: 'User profile is missing.' as string, data: null }

  if (profile.role !== 'admin' && profile.role !== 'team_member') {
    return { error: 'You do not have access to this workflow.' as string, data: null }
  }

  return { error: null, data: { user, profile, supabase } }
}

export async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' as string, data: null }

  const { data: actor } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (actor?.role !== 'admin') return { error: 'Forbidden' as string, data: null }

  return { error: null, data: { user, supabase } }
}
