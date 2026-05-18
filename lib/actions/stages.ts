'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { StartStageInput, FinishStageInput } from '@/lib/types/app'
import type { StageType } from '@/lib/types/database'
import { STAGE_ORDER } from '@/lib/types/app'

interface WorkflowRound {
  id: string
  project_id: string
  round_number: number
  status: string
}

interface WorkflowView {
  id: string
}

interface WorkflowState {
  id: string
  project_view_id: string
  stage: StageType
  status: string
}

export async function ensureProjectWorkflow(projectId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, status, current_round_number')
    .eq('id', projectId)
    .single()

  if (projectError || !project) return { error: projectError?.message ?? 'Project not found.' }
  if (project.status === 'archived') return { error: 'This project is archived.' }

  const { data: views, error: viewsError } = await supabase
    .from('project_views')
    .select('id')
    .eq('project_id', projectId)
    .eq('active', true)

  if (viewsError) return { error: viewsError.message }
  if (!views?.length) return { error: 'This project has no active views.' }

  const { data: existingRounds, error: roundsError } = await supabase
    .from('delivery_rounds')
    .select('id, project_id, round_number, status')
    .eq('project_id', projectId)
    .in('status', ['active', 'ready_for_admin_review'])
    .order('round_number', { ascending: false })

  if (roundsError) return { error: roundsError.message }

  let round = existingRounds?.[0] as WorkflowRound | undefined

  if (!round) {
    const { data: createdRound, error: createRoundError } = await supabase
      .from('delivery_rounds')
      .insert({
        project_id: projectId,
        round_number: project.current_round_number ?? 0,
        status: 'active',
      })
      .select('id, project_id, round_number, status')
      .single()

    if (createRoundError || !createdRound) {
      return { error: createRoundError?.message ?? 'No active delivery round exists and one could not be created.' }
    }
    round = createdRound as WorkflowRound
  }

  const { data: existingStates, error: statesError } = await supabase
    .from('view_stage_states')
    .select('id, project_view_id, stage, status')
    .eq('delivery_round_id', round.id)

  if (statesError) return { error: statesError.message }

  const existingKeys = new Set(
    ((existingStates ?? []) as WorkflowState[]).map(state => `${state.project_view_id}:${state.stage}`)
  )
  const missingStates = (views as WorkflowView[]).flatMap(view =>
    STAGE_ORDER
      .filter(stage => !existingKeys.has(`${view.id}:${stage}`))
      .map(stage => ({
        project_id: projectId,
        delivery_round_id: round.id,
        project_view_id: view.id,
        stage,
        status: 'not_started' as const,
      }))
  )

  if (missingStates.length > 0) {
    const { error: insertStatesError } = await supabase
      .from('view_stage_states')
      .insert(missingStates)

    if (insertStatesError) return { error: insertStatesError.message }
  }

  const { data: refreshedStates, error: refreshError } = await supabase
    .from('view_stage_states')
    .select('*')
    .eq('delivery_round_id', round.id)

  if (refreshError) return { error: refreshError.message }

  return { data: { round, states: refreshedStates ?? [] } }
}

export async function startStage(input: StartStageInput) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const ensured = await ensureProjectWorkflow(input.projectId)
  if (ensured.error) return { error: ensured.error }

  // Check for conflicts: another user already in_progress on same view+stage
  const { data: conflicts } = await supabase
    .from('view_stage_states')
    .select('assigned_user_id, project_view_id')
    .eq('delivery_round_id', input.roundId)
    .in('project_view_id', input.viewIds)
    .eq('stage', input.stage)
    .eq('status', 'in_progress')

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
  if (input.viewIds.length > 0 && updateError === null) {
    const { data: updatedRows, error: verifyError } = await supabase
      .from('view_stage_states')
      .select('id')
      .eq('delivery_round_id', input.roundId)
      .in('project_view_id', input.viewIds)
      .eq('stage', input.stage)
      .eq('status', 'in_progress')

    if (verifyError) return { error: verifyError.message }
    if ((updatedRows?.length ?? 0) < input.viewIds.length) {
      return { error: 'Start blocked because one or more selected stage rows are missing.' }
    }
  }

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
