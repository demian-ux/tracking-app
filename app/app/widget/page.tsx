import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { WidgetClient } from '@/components/widget/WidgetClient'
import { ensureUserProfile } from '@/lib/utils/ensure-profile'

export default async function WidgetPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  await ensureUserProfile(supabase, user)

  const [
    { data: projects, error: projectsError },
    { data: currentUser },
  ] = await Promise.all([
    supabase
      .from('projects')
      .select('id, name, status, delivery_date, delivery_time_window, current_round_number, view_count, clients ( name )')
      .in('status', [
        'active',
        'revision',
        'waiting_for_info',
        'ready_to_start',
        'in_production',
        'ready_to_deliver',
        'revision_in_progress',
        'not_started',
        'in_progress',
      ])
      .order('name'),
    supabase
      .from('users')
      .select('id, name, role')
      .eq('id', user.id)
      .single(),
  ])

  return (
    <div className="min-h-screen bg-canvas flex flex-col">
      <header className="border-b border-line shrink-0">
        <div className="max-w-[460px] mx-auto px-6 h-11 flex items-center justify-between">
          <span className="text-[11px] tracking-[0.15em] uppercase text-ink-3">Oaki Studio</span>
          <div className="flex items-center gap-4">
            <span className="text-[12px] text-ink-2">{currentUser?.name ?? user.email}</span>
            {currentUser?.role === 'admin' && (
              <Link
                href="/admin/projects"
                className="text-[11px] text-ink-3 hover:text-ink-2 transition-colors tracking-wide"
              >
                Admin -&gt;
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[460px] w-full mx-auto px-6 py-8">
        {projectsError && (
          <div className="mb-6 p-3 bg-blocked-bg border border-blocked-text/20 rounded-md">
            <p className="text-[11px] text-blocked-text font-medium mb-1">Database error</p>
            <p className="text-[11px] text-ink-2 font-mono">{projectsError.message}</p>
          </div>
        )}

        {!currentUser && !projectsError && (
          <div className="mb-6 p-3 bg-blocked-bg border border-blocked-text/20 rounded-md">
            <p className="text-[11px] text-blocked-text font-medium mb-1">Profile not set up</p>
            <p className="text-[11px] text-ink-2">
              Your account exists but has no profile row. Run migration 005 in the Supabase SQL editor to fix this.
            </p>
          </div>
        )}

        <WidgetClient
          projects={(projects ?? []) as unknown as Parameters<typeof WidgetClient>[0]['projects']}
          userId={user.id}
          hasError={!!projectsError}
        />
      </main>
    </div>
  )
}
