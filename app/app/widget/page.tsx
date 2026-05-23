import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { WidgetClient } from '@/components/widget/WidgetClient'
import { ensureUserProfile } from '@/lib/utils/ensure-profile'
import { ViewSwitcher } from '@/components/ui/ViewSwitcher'
import { Brand } from '@/components/ui/Brand'
import { Avatar } from '@/components/ui/Avatar'

export default async function WidgetPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  await ensureUserProfile(supabase, user)

  const [
    { data: projects, error: projectsError },
    { data: currentUser },
    { data: teamMembers },
  ] = await Promise.all([
    supabase
      .from('projects')
      .select('id, name, status, delivery_date, delivery_time_window, current_round_number, view_count, clients ( name )')
      .in('status', ['active', 'revision'])
      .order('name'),
    supabase
      .from('users')
      .select('id, name, role')
      .eq('id', user.id)
      .single(),
    supabase
      .from('users')
      .select('id, name')
      .in('role', ['admin', 'team_member']),
  ])

  const displayName = currentUser?.name ?? user.email ?? ''

  return (
    <div className="min-h-screen bg-canvas flex flex-col">
      <header className="border-b border-line shrink-0 bg-canvas/95 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-[460px] mx-auto px-6 h-12 flex items-center justify-between">
          <Brand />
          <div className="flex items-center gap-3">
            <Avatar name={displayName} size={20} />
            <span className="text-sm text-ink-2">{displayName.split(' ')[0] || 'You'}</span>
            {currentUser?.role === 'admin' && <ViewSwitcher active="widget" />}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[460px] w-full mx-auto px-6 py-8">
        {projectsError && (
          <div className="mb-6 p-3 bg-blocked-bg border border-blocked-text/20 rounded-md">
            <p className="text-caption text-blocked-text font-medium mb-1">Database error</p>
            <p className="text-caption text-ink-2 font-mono">{projectsError.message}</p>
          </div>
        )}

        {!currentUser && !projectsError && (
          <div className="mb-6 p-3 bg-blocked-bg border border-blocked-text/20 rounded-md">
            <p className="text-caption text-blocked-text font-medium mb-1">Profile not set up</p>
            <p className="text-caption text-ink-2">
              Your account exists but has no profile row. Run migration 005 in the Supabase SQL editor to fix this.
            </p>
          </div>
        )}

        <WidgetClient
          projects={(projects ?? []) as unknown as Parameters<typeof WidgetClient>[0]['projects']}
          userId={user.id}
          userRole={currentUser?.role ?? 'team_member'}
          users={teamMembers ?? []}
          hasError={!!projectsError}
        />
      </main>
    </div>
  )
}
