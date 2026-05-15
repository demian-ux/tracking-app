import type { SupabaseClient, User } from '@supabase/supabase-js'

/**
 * Creates a public.users profile for the given auth user if one doesn't exist.
 * Uses INSERT ON CONFLICT DO NOTHING so it's safe to call on every page load.
 * Role is always set to 'team_member' — admins must be promoted via SQL or admin panel.
 */
export async function ensureUserProfile(
  supabase: SupabaseClient,
  user: User
): Promise<void> {
  const name =
    (user.user_metadata?.name as string | undefined) ||
    user.email?.split('@')[0] ||
    'Unknown'

  await supabase.from('users').upsert(
    { id: user.id, email: user.email!, name, role: 'team_member' },
    { onConflict: 'id', ignoreDuplicates: true }
  )
}
