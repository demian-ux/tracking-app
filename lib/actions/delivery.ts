'use server'

import { revalidateProjectScreens } from '@/lib/utils/revalidate'
import { requireAdmin } from '@/lib/actions/auth'
import { STAGE_ORDER, STAGE_LABELS } from '@/lib/types/app'
import type { StageType } from '@/lib/types/database'

export interface IncompleteItem {
  viewLabel: string
  stageLabel: string
  status: string
}

export async function markDeliverySent(projectId: string, viewIds: string[]) {
  const auth = await requireAdmin()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { user, supabase } = auth.data

  if (!viewIds || viewIds.length === 0) return { error: 'No views selected' }

  // Find active rounds for selected views
  const { data: activeRounds } = await supabase
    .from('project_view_rounds')
    .select('id, project_view_id')
    .eq('project_id', projectId)
    .eq('status', 'active')
    .in('project_view_id', viewIds)

  if (!activeRounds || activeRounds.length === 0) {
    return { error: 'No active rounds found for selected views' }
  }

  const roundIds = activeRounds.map(r => r.id)

  // Check all stages are done
  const { data: states } = await supabase
    .from('view_stage_states')
    .select('id, status, stage, project_view_id, project_views ( label )')
    .in('project_view_round_id', roundIds)

  if (!states) return { error: 'Could not fetch stage states' }

  const incomplete: IncompleteItem[] = states
    .filter(s => s.status !== 'done')
    .map(s => ({
      viewLabel: (s.project_views as unknown as { label: string } | null)?.label ?? '?',
      stageLabel: STAGE_LABELS[s.stage as StageType],
      status: s.status,
    }))

  if (incomplete.length > 0) {
    return {
      error: `${incomplete.length} stage(s) not done`,
      incomplete,
    }
  }

  // Mark selected rounds as delivered
  const { error: roundErr } = await supabase
    .from('project_view_rounds')
    .update({ status: 'delivered', delivered_at: new Date().toISOString() })
    .in('id', roundIds)

  if (roundErr) return { error: roundErr.message }

  // Increment delivery_count and set project status
  const { data: project } = await supabase
    .from('projects')
    .select('delivery_count')
    .eq('id', projectId)
    .single()

  const { error: projectErr } = await supabase
    .from('projects')
    .update({
      status: 'waiting_for_feedback',
      delivery_count: (project?.delivery_count ?? 0) + 1,
    })
    .eq('id', projectId)

  if (projectErr) return { error: projectErr.message }

  await supabase.from('project_events').insert({
    project_id: projectId,
    actor_id: user.id,
    event_type: 'delivery_marked_sent',
    payload: { view_ids: viewIds },
  })

  revalidateProjectScreens(projectId)
  return { data: true }
}

export async function createRevisionRound(projectId: string, viewIds: string[]) {
  const auth = await requireAdmin()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { user, supabase } = auth.data

  if (!viewIds || viewIds.length === 0) return { error: 'No views selected' }

  const { data: project } = await supabase
    .from('projects')
    .select('id, status')
    .eq('id', projectId)
    .single()

  if (!project) return { error: 'Project not found' }
  if (project.status !== 'waiting_for_feedback' && project.status !== 'delivered') {
    return { error: 'Project is not waiting for feedback or delivered' }
  }

  // For each selected view, find its latest round and create a new one
  const { data: latestRounds } = await supabase
    .from('project_view_rounds')
    .select('*')
    .eq('project_id', projectId)
    .in('project_view_id', viewIds)
    .order('round_number', { ascending: false })

  const newRoundNumbers: Record<string, number> = {}
  const viewsProcessed = new Set<string>()

  for (const round of latestRounds ?? []) {
    if (!viewsProcessed.has(round.project_view_id)) {
      newRoundNumbers[round.project_view_id] = round.round_number + 1
      viewsProcessed.add(round.project_view_id)
    }
  }

  // Default to round 1 for views with no existing round
  for (const viewId of viewIds) {
    if (!newRoundNumbers[viewId]) {
      newRoundNumbers[viewId] = 1
    }
  }

  // Create new rounds for selected views
  const roundInserts = viewIds.map(viewId => ({
    project_id: projectId,
    project_view_id: viewId,
    round_number: newRoundNumbers[viewId],
    status: 'active' as const,
  }))

  const { data: newRounds, error: roundErr } = await supabase
    .from('project_view_rounds')
    .insert(roundInserts)
    .select()

  if (roundErr || !newRounds) return { error: roundErr?.message ?? 'Failed to create revision rounds' }

  // Create stage states for new rounds
  const stateInserts = newRounds.flatMap(round =>
    STAGE_ORDER.map(stage => ({
      project_id: projectId,
      project_view_round_id: round.id,
      project_view_id: round.project_view_id,
      stage: stage as StageType,
      status: 'not_started' as const,
    }))
  )

  if (stateInserts.length > 0) {
    const { error: statesErr } = await supabase.from('view_stage_states').insert(stateInserts)
    if (statesErr) return { error: statesErr.message }
  }

  // Update current_round_number on each affected view
  for (const viewId of viewIds) {
    await supabase
      .from('project_views')
      .update({ current_round_number: newRoundNumbers[viewId] })
      .eq('id', viewId)
  }

  const { error: projectErr } = await supabase
    .from('projects')
    .update({ status: 'revision' })
    .eq('id', projectId)

  if (projectErr) return { error: projectErr.message }

  await supabase.from('project_events').insert({
    project_id: projectId,
    actor_id: user.id,
    event_type: 'revision_round_created',
    payload: { view_ids: viewIds },
  })

  revalidateProjectScreens(projectId)
  return { data: { view_ids: viewIds } }
}
