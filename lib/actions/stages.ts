'use server'

import { revalidateProjectScreens } from '@/lib/utils/revalidate'
import { requireWorker, requireAdmin } from '@/lib/actions/auth'
import type { StartStageInput, FinishStageInput } from '@/lib/types/app'
import { STAGE_ORDER } from '@/lib/types/app'
import type { StageType } from '@/lib/types/database'

export async function ensureProjectWorkflow(projectId: string) {
  const auth = await requireWorker()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { supabase } = auth.data

  const { data: project } = await supabase
    .from('projects')
    .select('id, status, current_round_number')
    .eq('id', projectId)
    .single()

  if (!project) return { error: 'Project not found' }
  if (project.status === 'archived') return { error: 'Project is archived' }

  const { data: views } = await supabase
    .from('project_views')
    .select('id')
    .eq('project_id', projectId)
    .eq('active', true)

  if (!views || views.length === 0) return { error: 'Project has no active views' }

  const { data: existingRound } = await supabase
    .from('delivery_rounds')
    .select('*')
    .eq('project_id', projectId)
    .in('status', ['active', 'ready_for_admin_review'])
    .order('round_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  let activeRound = existingRound

  if (!activeRound) {
    const { data: newRound, error: roundErr } = await supabase
      .from('delivery_rounds')
      .insert({
        project_id: projectId,
        round_number: project.current_round_number ?? 0,
        status: 'active',
      })
      .select()
      .single()

    if (roundErr || !newRound) {
      return { error: roundErr?.message ?? 'Could not create workflow round' }
    }
    activeRound = newRound
  }

  const { data: existingStates } = await supabase
    .from('view_stage_states')
    .select('project_view_id, stage')
    .eq('delivery_round_id', activeRound.id)

  const existingSet = new Set(
    (existingStates ?? []).map(s => `${s.project_view_id}:${s.stage}`)
  )

  const missing = views.flatMap(view =>
    STAGE_ORDER
      .filter(stage => !existingSet.has(`${view.id}:${stage}`))
      .map(stage => ({
        project_id: projectId,
        delivery_round_id: activeRound.id,
        project_view_id: view.id,
        stage: stage as StageType,
        status: 'not_started' as const,
      }))
  )

  if (missing.length > 0) {
    const { error: insertErr } = await supabase.from('view_stage_states').insert(missing)
    if (insertErr) {
      return { error: `Could not create workflow rows: ${insertErr.message}` }
    }
  }

  const { data: states } = await supabase
    .from('view_stage_states')
    .select('*')
    .eq('delivery_round_id', activeRound.id)

  return { data: { round: activeRound, states: states ?? [] } }
}

export async function startStage(input: StartStageInput) {
  const auth = await requireWorker()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { user, supabase } = auth.data

  const { data: currentStates } = await supabase
    .from('view_stage_states')
    .select('id, project_view_id, status, assigned_user_id')
    .eq('delivery_round_id', input.roundId)
    .in('project_view_id', input.viewIds)
    .eq('stage', input.stage)

  if (!currentStates || currentStates.length !== input.viewIds.length) {
    return { error: 'Stage data not found for selected views' }
  }

  const conflictingViewIds = currentStates
    .filter(s => s.status === 'in_progress' && s.assigned_user_id !== user.id)
    .map(s => s.project_view_id)

  if (conflictingViewIds.length > 0) {
    return { error: 'conflict', conflictingViewIds }
  }

  const notStartable = currentStates.filter(
    s => s.status !== 'not_started' && s.status !== 'reopened'
  )
  if (notStartable.length > 0) {
    return { error: 'Some selected views cannot be started in their current state' }
  }

  const { error: updateErr } = await supabase
    .from('view_stage_states')
    .update({
      status: 'in_progress',
      assigned_user_id: user.id,
      started_at: new Date().toISOString(),
      latest_eta_date: input.etaDate ?? null,
      latest_eta_time_window: input.etaTimeWindow ?? null,
    })
    .eq('delivery_round_id', input.roundId)
    .in('project_view_id', input.viewIds)
    .eq('stage', input.stage)

  if (updateErr) return { error: updateErr.message }

  await supabase.from('stage_events').insert(
    input.viewIds.map(viewId => ({
      project_id: input.projectId,
      delivery_round_id: input.roundId,
      project_view_id: viewId,
      stage: input.stage,
      event_type: 'stage_started' as const,
      actor_id: user.id,
      eta_date: input.etaDate ?? null,
      eta_time_window: input.etaTimeWindow ?? null,
    }))
  )

  revalidateProjectScreens(input.projectId)
  return { data: true }
}

export async function finishStage(input: FinishStageInput) {
  const auth = await requireWorker()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { user, supabase } = auth.data

  const { data: currentStates } = await supabase
    .from('view_stage_states')
    .select('id, project_view_id, status, assigned_user_id')
    .eq('delivery_round_id', input.roundId)
    .in('project_view_id', input.viewIds)
    .eq('stage', input.stage)

  if (!currentStates || currentStates.length !== input.viewIds.length) {
    return { error: 'Stage data not found' }
  }

  const notFinishable = currentStates.filter(
    s => s.status !== 'in_progress' || s.assigned_user_id !== user.id
  )
  if (notFinishable.length > 0) {
    return { error: 'Cannot finish: some views are not in progress or assigned to you' }
  }

  const { error: updateErr } = await supabase
    .from('view_stage_states')
    .update({
      status: 'done',
      assigned_user_id: null,
      completed_at: new Date().toISOString(),
      latest_eta_date: null,
      latest_eta_time_window: null,
    })
    .eq('delivery_round_id', input.roundId)
    .in('project_view_id', input.viewIds)
    .eq('stage', input.stage)

  if (updateErr) return { error: updateErr.message }

  await supabase.from('stage_events').insert(
    input.viewIds.map(viewId => ({
      project_id: input.projectId,
      delivery_round_id: input.roundId,
      project_view_id: viewId,
      stage: input.stage,
      event_type: 'stage_finished' as const,
      actor_id: user.id,
    }))
  )

  revalidateProjectScreens(input.projectId)
  return { data: true }
}

export async function blockStage(
  projectId: string,
  roundId: string,
  viewIds: string[],
  stage: string,
  reason: string,
) {
  const auth = await requireWorker()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { user, supabase } = auth.data

  const { data: currentStates } = await supabase
    .from('view_stage_states')
    .select('id, project_view_id, status, assigned_user_id')
    .eq('delivery_round_id', roundId)
    .in('project_view_id', viewIds)
    .eq('stage', stage)

  if (!currentStates || currentStates.length !== viewIds.length) {
    return { error: 'Stage data not found' }
  }

  const notBlockable = currentStates.filter(
    s => s.status !== 'in_progress' || s.assigned_user_id !== user.id
  )
  if (notBlockable.length > 0) {
    return { error: 'Cannot block: some views are not in progress or assigned to you' }
  }

  const { error: updateErr } = await supabase
    .from('view_stage_states')
    .update({
      status: 'blocked',
      block_reason: reason,
      status_before_block: 'in_progress',
    })
    .eq('delivery_round_id', roundId)
    .in('project_view_id', viewIds)
    .eq('stage', stage)

  if (updateErr) return { error: updateErr.message }

  await supabase.from('stage_events').insert(
    viewIds.map(viewId => ({
      project_id: projectId,
      delivery_round_id: roundId,
      project_view_id: viewId,
      stage: stage as StageType,
      event_type: 'stage_blocked' as const,
      actor_id: user.id,
    }))
  )

  revalidateProjectScreens(projectId)
  return { data: true }
}

export async function unblockStage(
  projectId: string,
  roundId: string,
  viewId: string,
  stage: string,
) {
  const auth = await requireAdmin()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { user, supabase } = auth.data

  const { data: state } = await supabase
    .from('view_stage_states')
    .select('id, status, status_before_block')
    .eq('delivery_round_id', roundId)
    .eq('project_view_id', viewId)
    .eq('stage', stage)
    .single()

  if (!state) return { error: 'Stage state not found' }
  if (state.status !== 'blocked') return { error: 'Stage is not blocked' }

  const restoreStatus = state.status_before_block ?? 'not_started'

  const { error: updateErr } = await supabase
    .from('view_stage_states')
    .update({
      status: restoreStatus,
      block_reason: null,
      status_before_block: null,
    })
    .eq('id', state.id)

  if (updateErr) return { error: updateErr.message }

  await supabase.from('stage_events').insert({
    project_id: projectId,
    delivery_round_id: roundId,
    project_view_id: viewId,
    stage: stage as StageType,
    event_type: 'stage_unblocked' as const,
    actor_id: user.id,
  })

  revalidateProjectScreens(projectId)
  return { data: true }
}

export async function reopenStage(
  projectId: string,
  roundId: string,
  viewId: string,
  stage: string,
) {
  const auth = await requireAdmin()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { user, supabase } = auth.data

  const { data: state } = await supabase
    .from('view_stage_states')
    .select('id, status')
    .eq('delivery_round_id', roundId)
    .eq('project_view_id', viewId)
    .eq('stage', stage)
    .single()

  if (!state) return { error: 'Stage state not found' }
  if (state.status !== 'done') return { error: 'Stage is not done' }

  const { error: updateErr } = await supabase
    .from('view_stage_states')
    .update({
      status: 'reopened',
      assigned_user_id: null,
      completed_at: null,
    })
    .eq('id', state.id)

  if (updateErr) return { error: updateErr.message }

  await supabase.from('stage_events').insert({
    project_id: projectId,
    delivery_round_id: roundId,
    project_view_id: viewId,
    stage: stage as StageType,
    event_type: 'stage_reopened' as const,
    actor_id: user.id,
  })

  revalidateProjectScreens(projectId)
  return { data: true }
}
