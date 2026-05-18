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

export async function markDeliverySent(projectId: string, roundId: string) {
  const auth = await requireAdmin()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { user, supabase } = auth.data

  const { data: states } = await supabase
    .from('view_stage_states')
    .select('id, status, stage, project_view_id, project_views ( label )')
    .eq('delivery_round_id', roundId)

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

  const { error: roundErr } = await supabase
    .from('delivery_rounds')
    .update({ status: 'delivered', delivered_at: new Date().toISOString() })
    .eq('id', roundId)

  if (roundErr) return { error: roundErr.message }

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
    payload: { round_id: roundId },
  })

  revalidateProjectScreens(projectId)
  return { data: true }
}

export async function createRevisionRound(projectId: string) {
  const auth = await requireAdmin()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { user, supabase } = auth.data

  const { data: project } = await supabase
    .from('projects')
    .select('id, status, current_round_number')
    .eq('id', projectId)
    .single()

  if (!project) return { error: 'Project not found' }
  if (project.status !== 'waiting_for_feedback' && project.status !== 'delivered') {
    return { error: 'Project is not waiting for feedback or delivered' }
  }

  const { data: currentRound } = await supabase
    .from('delivery_rounds')
    .select('id')
    .eq('project_id', projectId)
    .eq('round_number', project.current_round_number)
    .single()

  if (currentRound) {
    await supabase
      .from('delivery_rounds')
      .update({ status: 'revision_requested' })
      .eq('id', currentRound.id)
  }

  const newRoundNumber = project.current_round_number + 1

  const { data: newRound, error: roundErr } = await supabase
    .from('delivery_rounds')
    .insert({
      project_id: projectId,
      round_number: newRoundNumber,
      status: 'active',
    })
    .select()
    .single()

  if (roundErr || !newRound) return { error: roundErr?.message ?? 'Failed to create revision round' }

  const { data: activeViews } = await supabase
    .from('project_views')
    .select('id')
    .eq('project_id', projectId)
    .eq('active', true)

  if (activeViews && activeViews.length > 0) {
    const stateInserts = activeViews.flatMap(view =>
      STAGE_ORDER.map(stage => ({
        project_id: projectId,
        delivery_round_id: newRound.id,
        project_view_id: view.id,
        stage: stage as StageType,
        status: 'not_started' as const,
      }))
    )
    await supabase.from('view_stage_states').insert(stateInserts)
  }

  const { error: projectErr } = await supabase
    .from('projects')
    .update({ current_round_number: newRoundNumber, status: 'revision' })
    .eq('id', projectId)

  if (projectErr) return { error: projectErr.message }

  await supabase.from('project_events').insert({
    project_id: projectId,
    actor_id: user.id,
    event_type: 'revision_round_created',
    payload: { round_number: newRoundNumber },
  })

  revalidateProjectScreens(projectId)
  return { data: { round_id: newRound.id, round_number: newRoundNumber } }
}
