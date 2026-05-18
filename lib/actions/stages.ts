'use server'

import { revalidateProjectScreens } from '@/lib/utils/revalidate'
import { requireWorker, requireAdmin } from '@/lib/actions/auth'
import type { StartStageInput, FinishStageInput } from '@/lib/types/app'

export async function ensureProjectWorkflow(projectId: string) {
  const auth = await requireWorker()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { supabase } = auth.data

  const { data, error } = await supabase.rpc('ensure_project_workflow_rpc', {
    p_project_id: projectId,
  })

  if (error) return { error: error.message }
  if (!data.ok) return { error: data.error as string }

  return { data: { round: data.round as { id: string; round_number: number; status: string }, states: data.states as unknown[] } }
}

export async function startStage(input: StartStageInput) {
  const auth = await requireWorker()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { supabase } = auth.data

  const { data, error } = await supabase.rpc('start_stage_rpc', {
    p_project_id: input.projectId,
    p_round_id: input.roundId,
    p_view_ids: input.viewIds,
    p_stage: input.stage,
    p_eta_date: input.etaDate ?? null,
    p_eta_time_window: input.etaTimeWindow ?? null,
  })

  if (error) return { error: error.message }
  if (!data.ok) {
    return {
      error: data.error as string,
      conflictingViewIds: (data.conflicting_view_ids ?? []) as string[],
    }
  }

  revalidateProjectScreens(input.projectId)
  return { data: true }
}

export async function finishStage(input: FinishStageInput) {
  const auth = await requireWorker()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { supabase } = auth.data

  const { data, error } = await supabase.rpc('finish_stage_rpc', {
    p_project_id: input.projectId,
    p_round_id: input.roundId,
    p_view_ids: input.viewIds,
    p_stage: input.stage,
  })

  if (error) return { error: error.message }
  if (!data.ok) return { error: data.error as string }

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
  const { supabase } = auth.data

  const { data, error } = await supabase.rpc('block_stage_rpc', {
    p_project_id: projectId,
    p_round_id: roundId,
    p_view_ids: viewIds,
    p_stage: stage,
    p_reason: reason,
  })

  if (error) return { error: error.message }
  if (!data.ok) return { error: data.error as string }

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
  const { supabase } = auth.data

  const { data, error } = await supabase.rpc('unblock_stage_rpc', {
    p_project_id: projectId,
    p_round_id: roundId,
    p_view_id: viewId,
    p_stage: stage,
  })

  if (error) return { error: error.message }
  if (!data.ok) return { error: data.error as string }

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
  const { supabase } = auth.data

  const { data, error } = await supabase.rpc('reopen_stage_rpc', {
    p_project_id: projectId,
    p_round_id: roundId,
    p_view_id: viewId,
    p_stage: stage,
  })

  if (error) return { error: error.message }
  if (!data.ok) return { error: data.error as string }

  revalidateProjectScreens(projectId)
  return { data: true }
}
