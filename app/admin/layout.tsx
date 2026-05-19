import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ensureUserProfile } from '@/lib/utils/ensure-profile'
import { ViewSwitcher } from '@/components/ui/ViewSwitcher'

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
        <div className="max-w-md w-full mx-6 p-5 bg-surface border border-line rounded-md">
          <p className="text-[11px] tracking-[0.12em] uppercase text-blocked-text mb-2">Database not set up</p>
          <p className="text-[13px] text-ink-2 mb-4">
            Run migrations first, then promote your account to admin:
          </p>
          <pre className="text-[11px] bg-canvas text-accent p-3 rounded overflow-x-auto font-mono">
            {`UPDATE public.users SET role = 'admin'\nWHERE email = '${user.email}';`}
          </pre>
          {profileError && <p className="mt-3 text-[11px] text-blocked-text font-mono">{profileError.message}</p>}
        </div>
      </div>
    )
  }

  if (profile.role !== 'admin') redirect('/app/widget')

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line sticky top-0 z-10 bg-canvas">
        <div className="max-w-6xl mx-auto px-8 h-11 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <span className="text-[11px] tracking-[0.15em] uppercase text-ink-3">Oaki Studio</span>
            <nav className="flex items-center gap-1">
              <NavLink href="/admin/today">Today</NavLink>
              <NavLink href="/admin/projects">Projects</NavLink>
              <NavLink href="/admin/clients">Clients</NavLink>
              <NavLink href="/admin/timeline">Timeline</NavLink>
              <NavLink href="/admin/events">Events</NavLink>
              <NavLink href="/admin/integrity">Integrity</NavLink>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <ViewSwitcher active="admin" />
            <span className="text-[12px] text-ink-2">{profile.name}</span>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-8 py-8">
        {children}
      </main>
    </div>
  )
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="px-3 py-1 text-[12px] text-ink-2 hover:text-ink hover:bg-elevated rounded transition-colors"
    >
      {children}
    </Link>
  )
}
