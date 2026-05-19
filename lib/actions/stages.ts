'use server'

import { revalidateProjectScreens } from '@/lib/utils/revalidate'
import { requireWorker, requireAdmin } from '@/lib/actions/auth'
import type { StartStageInput, FinishStageInput, ProjectViewRound } from '@/lib/types/app'
import { STAGE_ORDER, STAGE_LABELS } from '@/lib/types/app'
import type { StageType, StageStatus } from '@/lib/types/database'

export async function ensureProjectWorkflow(projectId: string) {
  const auth = await requireWorker()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { supabase } = auth.data

  const { data: project } = await supabase
    .from('projects')
    .select('id, status')
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

  // Fetch all existing view rounds for this project
  const { data: existingRounds, error: roundsError } = await supabase
    .from('project_view_rounds')
    .select('*')
    .eq('project_id', projectId)

  if (roundsError) return { error: roundsError.message }

  const rounds: ProjectViewRound[] = []

  for (const view of views) {
    const viewRounds = (existingRounds ?? []).filter(r => r.project_view_id === view.id)
    let activeRound = viewRounds.find(r => r.status === 'active') ?? null

    if (!activeRound) {
      // Find latest round and reactivate, or create round 0
      const latestRound = viewRounds.sort((a, b) => b.round_number - a.round_number)[0] ?? null

      if (latestRound) {
        const { data: reactivated, error: reactivateErr } = await supabase
          .from('project_view_rounds')
          .update({ status: 'active' })
          .eq('id', latestRound.id)
          .select()
          .single()

        if (reactivateErr) return { error: reactivateErr.message }
        activeRound = reactivated
      } else {
        const { data: newRound, error: createErr } = await supabase
          .from('project_view_rounds')
          .insert({
            project_id: projectId,
            project_view_id: view.id,
            round_number: 0,
            status: 'active',
          })
          .select()
          .single()

        if (createErr || !newRound) {
          return { error: createErr?.message ?? 'Could not create view round' }
        }
        activeRound = newRound
      }
    }

    rounds.push(activeRound)
  }

  // Ensure stage states exist for all active view rounds
  const { data: existingStates } = await supabase
    .from('view_stage_states')
    .select('project_view_round_id, project_view_id, stage')
    .in('project_view_round_id', rounds.map(r => r.id))

  const existingSet = new Set(
    (existingStates ?? []).map(s => `${s.project_view_round_id}:${s.project_view_id}:${s.stage}`)
  )

  const missing = rounds.flatMap(round =>
    STAGE_ORDER
      .filter(stage => !existingSet.has(`${round.id}:${round.project_view_id}:${stage}`))
      .map(stage => ({
        project_id: projectId,
        project_view_round_id: round.id,
        project_view_id: round.project_view_id,
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
    .in('project_view_round_id', rounds.map(r => r.id))

  return { data: { rounds, states: states ?? [] } }
}

export async function startStage(input: StartStageInput) {
  const auth = await requireWorker()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { user, profile, supabase } = auth.data

  // Find the active round for each selected view
  const { data: activeRounds } = await supabase
    .from('project_view_rounds')
    .select('id, project_view_id')
    .eq('project_id', input.projectId)
    .eq('status', 'active')
    .in('project_view_id', input.viewIds)

  if (!activeRounds || activeRounds.length !== input.viewIds.length) {
    return { error: 'Could not find active round for all selected views' }
  }

  const roundIds = activeRounds.map(r => r.id)

  // Sequential stage enforcement â€” team members cannot skip stages
  if (profile.role !== 'admin') {
    const idx = STAGE_ORDER.indexOf(input.stage)
    if (idx > 0) {
      const prevStage = STAGE_ORDER[idx - 1]
      const { data: prevStates } = await supabase
        .from('view_stage_states')
        .select('project_view_id, status')
        .in('project_view_round_id', roundIds)
        .in('project_view_id', input.viewIds)
        .eq('stage', prevStage)
      const notReady = (prevStates ?? []).filter(s => s.status !== 'done')
      if (notReady.length > 0) {
        return { error: `Finish ${STAGE_LABELS[prevStage as StageType]} first` }
      }
    }
  }

  const { data: currentStates } = await supabase
    .from('view_stage_states')
    .select('id, project_view_id, project_view_round_id, status, assigned_user_id')
    .in('project_view_round_id', roundIds)
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

  const stateIds = currentStates.map(s => s.id)

  const { data: updatedStates, error: updateErr } = await supabase
    .from('view_stage_states')
    .update({
      status: 'in_progress',
      assigned_user_id: user.id,
      started_at: new Date().toISOString(),
      latest_eta_date: input.etaDate ?? null,
      latest_eta_time_window: input.etaTimeWindow ?? null,
    })
    .in('id', stateIds)
    .select('id, project_view_id, project_view_round_id, stage, status, assigned_user_id, started_at, completed_at, latest_eta_date, latest_eta_time_window')

  if (updateErr) return { error: updateErr.message }

  await supabase.from('stage_events').insert(
    currentStates.map(s => ({
      project_id: input.projectId,
      project_view_round_id: s.project_view_round_id,
      project_view_id: s.project_view_id,
      stage: input.stage,
      event_type: 'stage_started' as const,
      actor_id: user.id,
      eta_date: input.etaDate ?? null,
      eta_time_window: input.etaTimeWindow ?? null,
    }))
  )

  revalidateProjectScreens(input.projectId)
  return { data: { updatedStates: updatedStates ?? [] } }
}

export async function finishStage(input: FinishStageInput) {
  const auth = await requireWorker()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { user, supabase } = auth.data

  // Find the active round for each selected view
  const { data: activeRounds } = await supabase
    .from('project_view_rounds')
    .select('id, project_view_id')
    .eq('project_id', input.projectId)
    .eq('status', 'active')
    .in('project_view_id', input.viewIds)

  if (!activeRounds || activeRounds.length !== input.viewIds.length) {
    return { error: 'Could not find active round for all selected views' }
  }

  const roundIds = activeRounds.map(r => r.id)

  const { data: currentStates } = await supabase
    .from('view_stage_states')
    .select('id, project_view_id, project_view_round_id, status, assigned_user_id')
    .in('project_view_round_id', roundIds)
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

  const stateIds = currentStates.map(s => s.id)

  const { data: updatedStates, error: updateErr } = await supabase
    .from('view_stage_states')
    .update({
      status: 'done',
      assigned_user_id: null,
      completed_at: new Date().toISOString(),
      latest_eta_date: null,
      latest_eta_time_window: null,
    })
    .in('id', stateIds)
    .select('id, project_view_id, project_view_round_id, stage, status, assigned_user_id, started_at, completed_at, latest_eta_date, latest_eta_time_window')

  if (updateErr) return { error: updateErr.message }

  await supabase.from('stage_events').insert(
    currentStates.map(s => ({
      project_id: input.projectId,
      project_view_round_id: s.project_view_round_id,
      project_view_id: s.project_view_id,
      stage: input.stage,
      event_type: 'stage_finished' as const,
      actor_id: user.id,
    }))
  )

  revalidateProjectScreens(input.projectId)
  return { data: { updatedStates: updatedStates ?? [] } }
}

export async function blockStage(
  projectId: string,
  viewIds: string[],
  stage: string,
  reason: string,
) {
  const auth = await requireWorker()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { user, supabase } = auth.data

  // Find the active round for each selected view
  const { data: activeRounds } = await supabase
    .from('project_view_rounds')
    .select('id, project_view_id')
    .eq('project_id', projectId)
    .eq('status', 'active')
    .in('project_view_id', viewIds)

  if (!activeRounds || activeRounds.length !== viewIds.length) {
    return { error: 'Could not find active round for all selected views' }
  }

  const roundIds = activeRounds.map(r => r.id)

  const { data: currentStates } = await supabase
    .from('view_stage_states')
    .select('id, project_view_id, project_view_round_id, status, assigned_user_id')
    .in('project_view_round_id', roundIds)
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

  const stateIds = currentStates.map(s => s.id)

  const { data: updatedStates, error: updateErr } = await supabase
    .from('view_stage_states')
    .update({
      status: 'blocked',
      block_reason: reason,
      status_before_block: 'in_progress',
    })
    .in('id', stateIds)
    .select('id, project_view_id, project_view_round_id, stage, status, assigned_user_id, started_at, completed_at, latest_eta_date, latest_eta_time_window, block_reason')

  if (updateErr) return { error: updateErr.message }

  await supabase.from('stage_events').insert(
    currentStates.map(s => ({
      project_id: projectId,
      project_view_round_id: s.project_view_round_id,
      project_view_id: s.project_view_id,
      stage: stage as StageType,
      event_type: 'stage_blocked' as const,
      actor_id: user.id,
    }))
  )

  revalidateProjectScreens(projectId)
  return { data: { updatedStates: updatedStates ?? [] } }
}

export async function unblockStage(
  projectId: string,
  viewId: string,
  stage: string,
) {
  const auth = await requireAdmin()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { user, supabase } = auth.data

  // Find the active round for this view
  const { data: activeRound } = await supabase
    .from('project_view_rounds')
    .select('id')
    .eq('project_id', projectId)
    .eq('project_view_id', viewId)
    .eq('status', 'active')
    .single()

  if (!activeRound) return { error: 'No active round found for this view' }

  const { data: state } = await supabase
    .from('view_stage_states')
    .select('id, status, status_before_block')
    .eq('project_view_round_id', activeRound.id)
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
    project_view_round_id: activeRound.id,
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
  viewId: string,
  stage: string,
) {
  const auth = await requireAdmin()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { user, supabase } = auth.data

  // Find the active round for this view
  const { data: activeRound } = await supabase
    .from('project_view_rounds')
    .select('id')
    .eq('project_id', projectId)
    .eq('project_view_id', viewId)
    .eq('status', 'active')
    .single()

  if (!activeRound) return { error: 'No active round found for this view' }

  const { data: state } = await supabase
    .from('view_stage_states')
    .select('id, status')
    .eq('project_view_round_id', activeRound.id)
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
    project_view_round_id: activeRound.id,
    project_view_id: viewId,
    stage: stage as StageType,
    event_type: 'stage_reopened' as const,
    actor_id: user.id,
  })

  revalidateProjectScreens(projectId)
  return { data: true }
}

export async function undoStageAction(
  projectId: string,
  restores: { id: string; status: string; assigned_user_id: string | null }[],
) {
  const auth = await requireWorker()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { supabase } = auth.data

  const results = await Promise.all(restores.map(r => {
    const update: Record<string, unknown> = {
      status: r.status as StageStatus,
      assigned_user_id: r.assigned_user_id,
    }
    if (r.status === 'not_started' || r.status === 'reopened') {
      update.started_at = null
      update.latest_eta_date = null
      update.latest_eta_time_window = null
    }
    if (r.status !== 'done') {
      update.completed_at = null
    }
    return supabase.from('view_stage_states').update(update).eq('id', r.id)
  }))

  const firstError = results.find(r => r.error)
  if (firstError?.error) return { error: firstError.error.message }

  revalidateProjectScreens(projectId)
  return { data: true }
}

export async function resetStage(
  projectId: string,
  viewIds: string[],
  stage: StageType,
) {
  const auth = await requireWorker()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { user, profile, supabase } = auth.data

  const { data: activeRounds } = await supabase
    .from('project_view_rounds')
    .select('id, project_view_id')
    .eq('project_id', projectId)
    .eq('status', 'active')
    .in('project_view_id', viewIds)

  if (!activeRounds || activeRounds.length !== viewIds.length) {
    return { error: 'Could not find active round for all selected views' }
  }

  const roundIds = activeRounds.map(r => r.id)

  // Cascade: reset the selected stage and all subsequent stages
  const stageIdx = STAGE_ORDER.indexOf(stage)
  const stagesToReset = STAGE_ORDER.slice(stageIdx)

  const { data: currentStates } = await supabase
    .from('view_stage_states')
    .select('id, project_view_id, project_view_round_id, stage, status, assigned_user_id')
    .in('project_view_round_id', roundIds)
    .in('project_view_id', viewIds)
    .in('stage', stagesToReset)

  if (!currentStates) return { error: 'Could not fetch stage states' }

  // Permission: admin can reset anything; team members can only reset stages assigned to them
  if (profile.role !== 'admin') {
    const primaryStates = currentStates.filter(s => s.stage === stage && s.status !== 'not_started')
    const unauthorized = primaryStates.filter(s => s.assigned_user_id !== user.id)
    if (unauthorized.length > 0) {
      return { error: 'You can only reset stages assigned to you' }
    }
  }

  const statesToReset = currentStates.filter(s => s.status !== 'not_started')

  if (statesToReset.length === 0) {
    return { error: 'All selected stages are already not started' }
  }

  const stateIds = statesToReset.map(s => s.id)

  const { data: updatedStates, error: updateErr } = await supabase
    .from('view_stage_states')
    .update({
      status: 'not_started' as StageStatus,
      assigned_user_id: null,
      started_at: null,
      completed_at: null,
      latest_eta_date: null,
      latest_eta_time_window: null,
      block_reason: null,
      status_before_block: null,
    })
    .in('id', stateIds)
    .select('id, project_view_id, project_view_round_id, stage, status, assigned_user_id, started_at, completed_at, latest_eta_date, latest_eta_time_window, block_reason')

  if (updateErr) return { error: updateErr.message }

  await supabase.from('stage_events').insert(
    statesToReset.map(s => ({
      project_id: projectId,
      project_view_round_id: s.project_view_round_id,
      project_view_id: s.project_view_id,
      stage: s.stage as StageType,
      event_type: 'stage_reset' as const,
      actor_id: user.id,
    }))
  )

  revalidateProjectScreens(projectId)
  return { data: { updatedStates: updatedStates ?? [] } }
}