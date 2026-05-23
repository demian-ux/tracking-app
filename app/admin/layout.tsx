import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ensureUserProfile } from '@/lib/utils/ensure-profile'
import { ViewSwitcher } from '@/components/ui/ViewSwitcher'
import { AdminNavLink } from '@/components/ui/AdminNavLink'
import { Brand } from '@/components/ui/Brand'
import { Avatar } from '@/components/ui/Avatar'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  await ensureUserProfile(supabase, user)

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('role, name')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="max-w-md w-full mx-6 p-4 bg-surface border border-line rounded-md">
          <p className="text-label font-semibold uppercase text-blocked-text mb-2">Database not set up</p>
          <p className="text-body text-ink-2 mb-4">
            Run migrations first, then promote your account to admin:
          </p>
          <pre className="text-caption bg-elevated text-accent p-3 rounded-sm overflow-x-auto font-mono">
            {`UPDATE public.users SET role = 'admin'\nWHERE email = '${user.email}';`}
          </pre>
          {profileError && <p className="mt-3 text-caption text-blocked-text font-mono">{profileError.message}</p>}
        </div>
      </div>
    )
  }

  if (profile.role !== 'admin') redirect('/app/widget')

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line sticky top-0 z-10 bg-canvas/95 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-8 h-12 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Brand />
            <nav className="flex items-center gap-0.5">
              <AdminNavLink href="/admin/today">Today</AdminNavLink>
              <AdminNavLink href="/admin/projects">Projects</AdminNavLink>
              <AdminNavLink href="/admin/clients">Clients</AdminNavLink>
              <AdminNavLink href="/admin/timeline">Timeline</AdminNavLink>
              <AdminNavLink href="/admin/events">Events</AdminNavLink>
              <AdminNavLink href="/admin/integrity">Integrity</AdminNavLink>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <Avatar name={profile.name} size={22} />
            <span className="text-sm text-ink-2">{profile.name}</span>
            <ViewSwitcher active="admin" />
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-8 py-8">
        {children}
      </main>
    </div>
  )
}
