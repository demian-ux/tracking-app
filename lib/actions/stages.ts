'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { StartStageInput, FinishStageInput } from '@/lib/types/app'

export async function startStage(input: StartStageInput) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Check for conflicts: another user already in_progress on same view+stage
  const { data: conflicts } = await supabase
    .from('view_stage_states')
    .select('assigned_user_id, project_view_id')
    .eq('delivery_round_id', input.roundId)
    .in('project_view_id', input.viewIds)
    .eq('stage', input.stage)
    .eq('status', 'in_progress')
    .neq('assigned_user_id', user.id)

  if (conflicts && conflicts.length > 0) {
    return {
      error: 'conflict',
      conflictingViewIds: conflicts.map(c => c.project_view_id),
    }
  }

  const now = new Date().toISOString()
  const { error: updateError } = await supabase
    .from('view_stage_states')
    .update({
      status: 'in_progress',
      assigned_user_id: user.id,
      started_at: now,
      latest_eta_date: input.etaDate,
      latest_eta_time_window: input.etaTimeWindow,
      block_reason: null,
    })
    .eq('delivery_round_id', input.roundId)
    .in('project_view_id', input.viewIds)
    .eq('stage', input.stage)

  if (updateError) return { error: updateError.message }

  const events = input.viewIds.map(viewId => ({
    project_id: input.projectId,
    delivery_round_id: input.roundId,
    project_view_id: viewId,
    stage: input.stage,
    event_type: 'stage_started' as const,
    actor_id: user.id,
    eta_date: input.etaDate,
    eta_time_window: input.etaTimeWindow,
  }))
  await supabase.from('stage_events').insert(events)

  revalidatePath('/app/widget')
  revalidatePath(`/admin/projects/${input.projectId}`)
  return { data: true }
}

export async function finishStage(input: FinishStageInput) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const now = new Date().toISOString()
  const { error: updateError } = await supabase
    .from('view_stage_states')
    .update({ status: 'done', completed_at: now })
    .eq('delivery_round_id', input.roundId)
    .in('project_view_id', input.viewIds)
    .eq('stage', input.stage)

  if (updateError) return { error: updateError.message }

  const events = input.viewIds.map(viewId => ({
    project_id: input.projectId,
    delivery_round_id: input.roundId,
    project_view_id: viewId,
    stage: input.stage,
    event_type: 'stage_finished' as const,
    actor_id: user.id,
  }))
  await supabase.from('stage_events').insert(events)

  revalidatePath('/app/widget')
  revalidatePath(`/admin/projects/${input.projectId}`)
  return { data: true }
}

export async function blockStage(
  projectId: string,
  roundId: string,
  viewIds: string[],
  stage: string,
  reason: string,
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('view_stage_states')
    .update({ status: 'blocked', block_reason: reason })
    .eq('delivery_round_id', roundId)
    .in('project_view_id', viewIds)
    .eq('stage', stage)

  if (error) return { error: error.message }

  const events = viewIds.map(viewId => ({
    project_id: projectId,
    delivery_round_id: roundId,
    project_view_id: viewId,
    stage: stage as never,
    event_type: 'stage_blocked' as const,
    actor_id: user.id,
  }))
  await supabase.from('stage_events').insert(events)

  revalidatePath('/app/widget')
  revalidatePath(`/admin/projects/${projectId}`)
  return { data: true }
}

export async function unblockStage(
  projectId: string,
  roundId: string,
  viewId: string,
  stage: string,
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: actor } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (actor?.role !== 'admin') return { error: 'Forbidden' }

  const { error } = await supabase
    .from('view_stage_states')
    .update({ status: 'not_started', block_reason: null })
    .eq('delivery_round_id', roundId)
    .eq('project_view_id', viewId)
    .eq('stage', stage)

  if (error) return { error: error.message }

  await supabase.from('stage_events').insert({
    project_id: projectId,
    delivery_round_id: roundId,
    project_view_id: viewId,
    stage: stage as never,
    event_type: 'stage_unblocked',
    actor_id: user.id,
  })

  revalidatePath(`/admin/projects/${projectId}`)
  revalidatePath('/admin/today')
  return { data: true }
}

export async function reopenStage(
  projectId: string,
  roundId: string,
  viewId: string,
  stage: string,
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: actor } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (actor?.role !== 'admin') return { error: 'Forbidden' }

  const { error } = await supabase
    .from('view_stage_states')
    .update({ status: 'reopened', completed_at: null })
    .eq('delivery_round_id', roundId)
    .eq('project_view_id', viewId)
    .eq('stage', stage)

  if (error) return { error: error.message }

  await supabase.from('stage_events').insert({
    project_id: projectId,
    delivery_round_id: roundId,
    project_view_id: viewId,
    stage: stage as never,
    event_type: 'stage_reopened',
    actor_id: user.id,
  })

  revalidatePath(`/admin/projects/${projectId}`)
  return { data: true }
}

// Creates a delivery round + view_stage_states for a project that is missing one.
// Recovers projects where the round insert failed mid-flight during creation.
export async function initializeRound(projectId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: actor } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (actor?.role !== 'admin') return { error: 'Forbidden' }

  const { data: views, error: viewsError } = await supabase
    .from('project_views')
    .select('id')
    .eq('project_id', projectId)
    .eq('active', true)

  if (viewsError || !views?.length) return { error: 'No views found for this project.' }

  const { data: round, error: roundError } = await supabase
    .from('delivery_rounds')
    .insert({ project_id: projectId, round_number: 0, status: 'active' })
    .select()
    .single()

  if (roundError || !round) return { error: roundError?.message ?? 'Failed to create round.' }

  const { STAGE_ORDER } = await import('@/lib/types/app')
  const states = views.flatMap(view =>
    STAGE_ORDER.map(stage => ({
      project_id: projectId,
      delivery_round_id: round.id,
      project_view_id: view.id,
      stage,
      status: 'not_started' as const,
    }))
  )

  const { error: statesError } = await supabase.from('view_stage_states').insert(states)
  if (statesError) return { error: statesError.message }

  revalidatePath('/app/widget')
  revalidatePath(`/admin/projects/${projectId}`)
  return { data: round }
}
