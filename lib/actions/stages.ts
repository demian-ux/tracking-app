'use server'

import { revalidateProjectScreens } from '@/lib/utils/revalidate'
import { requireWorker, requireAdmin } from '@/lib/actions/auth'
import type { StartStageInput, FinishStageInput, ProjectViewRound } from '@/lib/types/app'
import type { StageType, StageStatus } from '@/lib/types/database'

type RpcResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: string; [key: string]: unknown }

function rpcErrorToString(error: unknown): string {
  if (!error) return 'Unexpected error.'
  if (typeof error === 'string') return error
  if (typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string') {
    return (error as { message: string }).message
  }
  return 'Unexpected error.'
}

export async function ensureProjectWorkflow(projectId: string) {
  const auth = await requireWorker()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { supabase } = auth.data

  const { data, error } = await supabase.rpc('ensure_workflow_v2_rpc', {
    p_project_id: projectId,
  })

  if (error) return { error: rpcErrorToString(error) }
  const result = data as RpcResult<{ rounds: ProjectViewRound[]; states: unknown[] }>
  if (!result?.ok) return { error: result?.error ?? 'Workflow error' }

  return { data: { rounds: result.rounds, states: result.states } }
}

export async function startStage(input: StartStageInput) {
  const auth = await requireWorker()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { supabase } = auth.data

  const { data, error } = await supabase.rpc('start_stage_v2_rpc', {
    p_project_id: input.projectId,
    p_view_ids: input.viewIds,
    p_stage: input.stage,
    p_eta_date: input.etaDate ?? null,
    p_eta_time_window: input.etaTimeWindow ?? null,
  })

  if (error) return { error: rpcErrorToString(error) }
  const result = data as RpcResult<{ updatedStates: unknown[] }> & { conflictingViewIds?: string[] }
  if (!result?.ok) {
    if (result?.error === 'conflict') {
      return { error: 'conflict' as const, conflictingViewIds: result.conflictingViewIds ?? [] }
    }
    return { error: result?.error ?? 'Start failed' }
  }

  revalidateProjectScreens(input.projectId)
  return { data: { updatedStates: result.updatedStates ?? [] } }
}

export async function finishStage(input: FinishStageInput) {
  const auth = await requireWorker()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { supabase } = auth.data

  const { data, error } = await supabase.rpc('finish_stage_v2_rpc', {
    p_project_id: input.projectId,
    p_view_ids: input.viewIds,
    p_stage: input.stage,
  })

  if (error) return { error: rpcErrorToString(error) }
  const result = data as RpcResult<{ updatedStates: unknown[] }>
  if (!result?.ok) return { error: result?.error ?? 'Finish failed' }

  revalidateProjectScreens(input.projectId)
  return { data: { updatedStates: result.updatedStates ?? [] } }
}

export async function blockStage(
  projectId: string,
  viewIds: string[],
  stage: string,
  reason: string,
) {
  const auth = await requireWorker()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { supabase } = auth.data

  const { data, error } = await supabase.rpc('block_stage_v2_rpc', {
    p_project_id: projectId,
    p_view_ids: viewIds,
    p_stage: stage,
    p_reason: reason,
  })

  if (error) return { error: rpcErrorToString(error) }
  const result = data as RpcResult<{ updatedStates: unknown[] }>
  if (!result?.ok) return { error: result?.error ?? 'Block failed' }

  revalidateProjectScreens(projectId)
  return { data: { updatedStates: result.updatedStates ?? [] } }
}

export async function resetStage(
  projectId: string,
  viewIds: string[],
  stage: StageType,
) {
  const auth = await requireWorker()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { supabase } = auth.data

  const { data, error } = await supabase.rpc('reset_stage_v2_rpc', {
    p_project_id: projectId,
    p_view_ids: viewIds,
    p_stage: stage,
  })

  if (error) return { error: rpcErrorToString(error) }
  const result = data as RpcResult<{ updatedStates: unknown[] }>
  if (!result?.ok) return { error: result?.error ?? 'Reset failed' }

  revalidateProjectScreens(projectId)
  return { data: { updatedStates: result.updatedStates ?? [] } }
}

// ── Low-frequency admin actions — left as direct writes ──────────────────────
// unblockStage / reopenStage are admin-only and used rarely, so the multi-query
// pattern doesn't measurably hurt UX. Keeping them direct avoids extra RPCs.

export async function unblockStage(
  projectId: string,
  viewId: string,
  stage: string,
) {
  const auth = await requireAdmin()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { user, supabase } = auth.data

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
