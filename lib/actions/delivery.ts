// @ts-nocheck
'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { STAGE_ORDER, viewLabel } from '@/lib/types/app'

export async function markDeliverySent(projectId: string, roundId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: actor } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (actor?.role !== 'admin') return { error: 'Forbidden' }

  const now = new Date().toISOString()

  const { error: roundError } = await supabase
    .from('delivery_rounds')
    .update({ status: 'delivered', delivered_at: now })
    .eq('id', roundId)

  if (roundError) return { error: roundError.message }

  const { data: project } = await supabase
    .from('projects')
    .select('delivery_count')
    .eq('id', projectId)
    .single()

  await supabase
    .from('projects')
    .update({
      delivery_count: (project?.delivery_count ?? 0) + 1,
      status: 'waiting_for_feedback',
    })
    .eq('id', projectId)

  await supabase.from('project_events').insert({
    project_id: projectId,
    actor_id: user.id,
    event_type: 'delivery_marked_sent',
    payload: { round_id: roundId, delivered_at: now },
  })

  revalidatePath(`/admin/projects/${projectId}`)
  revalidatePath('/admin/projects')
  revalidatePath('/admin/today')
  return { data: true }
}

export async function createRevisionRound(projectId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: actor } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (actor?.role !== 'admin') return { error: 'Forbidden' }

  const { data: project } = await supabase
    .from('projects')
    .select('current_round_number, view_count')
    .eq('id', projectId)
    .single()

  if (!project) return { error: 'Project not found' }

  const newRoundNumber = project.current_round_number + 1

  const { data: round, error: roundError } = await supabase
    .from('delivery_rounds')
    .insert({ project_id: projectId, round_number: newRoundNumber, status: 'active' })
    .select()
    .single()

  if (roundError || !round) return { error: roundError?.message ?? 'Failed to create round' }

  const { data: views } = await supabase
    .from('project_views')
    .select('*')
    .eq('project_id', projectId)
    .eq('active', true)

  if (!views) return { error: 'No views found' }

  const stateInserts = views.flatMap(view =>
    STAGE_ORDER.map(stage => ({
      project_id: projectId,
      delivery_round_id: round.id,
      project_view_id: view.id,
      stage,
      status: 'not_started' as const,
    }))
  )

  const { error: statesError } = await supabase.from('view_stage_states').insert(stateInserts)
  if (statesError) return { error: statesError.message }

  await supabase
    .from('projects')
    .update({ current_round_number: newRoundNumber, status: 'revision_in_progress' })
    .eq('id', projectId)

  await supabase.from('project_events').insert({
    project_id: projectId,
    actor_id: user.id,
    event_type: 'revision_round_created',
    payload: { round_number: newRoundNumber },
  })

  revalidatePath(`/admin/projects/${projectId}`)
  revalidatePath('/admin/today')
  return { data: round }
}
