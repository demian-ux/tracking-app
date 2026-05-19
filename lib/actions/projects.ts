'use server'

import { revalidatePath } from 'next/cache'
import { revalidateProjectScreens } from '@/lib/utils/revalidate'
import { requireAdmin } from '@/lib/actions/auth'
import type { CreateProjectInput } from '@/lib/types/app'
import { viewLabel, STAGE_ORDER } from '@/lib/types/app'
import type { TimeWindow, StageType } from '@/lib/types/database'

export async function createProject(input: CreateProjectInput) {
  const auth = await requireAdmin()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { user, supabase } = auth.data

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .insert({
      name: input.name,
      client_id: input.clientId ?? null,
      delivery_date: input.deliveryDate ?? null,
      delivery_time_window: input.deliveryTimeWindow ?? null,
      view_count: input.viewCount,
      status: 'active',
    })
    .select()
    .single()

  if (projectError || !project) return { error: projectError?.message ?? 'Failed to create project' }

  const viewInserts = Array.from({ length: input.viewCount }, (_, i) => ({
    project_id: project.id,
    number: i + 1,
    label: viewLabel(i + 1),
  }))

  const { data: views, error: viewError } = await supabase
    .from('project_views')
    .insert(viewInserts)
    .select()

  if (viewError || !views) return { error: viewError?.message ?? 'Failed to create views' }

  // Create one project_view_round per view (round 0, active)
  const roundInserts = views.map(view => ({
    project_id: project.id,
    project_view_id: view.id,
    round_number: 0,
    status: 'active' as const,
  }))

  const { data: rounds, error: roundError } = await supabase
    .from('project_view_rounds')
    .insert(roundInserts)
    .select()

  if (roundError || !rounds) return { error: roundError?.message ?? 'Failed to create view rounds' }

  // Create stage states for each view's round
  const stateInserts = rounds.flatMap(round =>
    STAGE_ORDER.map(stage => ({
      project_id: project.id,
      project_view_round_id: round.id,
      project_view_id: round.project_view_id,
      stage: stage as StageType,
      status: 'not_started' as const,
    }))
  )

  const { error: statesError } = await supabase.from('view_stage_states').insert(stateInserts)
  if (statesError) return { error: statesError.message }

  await supabase.from('project_events').insert({
    project_id: project.id,
    actor_id: user.id,
    event_type: 'project_created',
    payload: { name: input.name, view_count: input.viewCount },
  })

  revalidatePath('/admin/projects')
  return { data: { id: project.id } }
}

export async function updateProjectDates(
  projectId: string,
  updates: {
    deliveryDate?: string | null
    deliveryTimeWindow?: TimeWindow | null
  }
) {
  const auth = await requireAdmin()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { user, supabase } = auth.data

  const { error } = await supabase
    .from('projects')
    .update({
      delivery_date: updates.deliveryDate,
      delivery_time_window: updates.deliveryTimeWindow,
    })
    .eq('id', projectId)

  if (error) return { error: error.message }

  if (updates.deliveryDate !== undefined) {
    await supabase.from('project_events').insert({
      project_id: projectId,
      actor_id: user.id,
      event_type: 'delivery_date_changed',
      payload: { delivery_date: updates.deliveryDate, delivery_time_window: updates.deliveryTimeWindow },
    })
  }

  revalidateProjectScreens(projectId)
  return { data: true }
}

export async function archiveProject(projectId: string) {
  const auth = await requireAdmin()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { user, supabase } = auth.data

  const { error } = await supabase
    .from('projects')
    .update({ status: 'archived' })
    .eq('id', projectId)

  if (error) return { error: error.message }

  await supabase.from('project_events').insert({
    project_id: projectId,
    actor_id: user.id,
    event_type: 'project_archived',
  })

  revalidateProjectScreens(projectId)
  return { data: true }
}

export async function deleteProjectPermanently(projectId: string, confirmation: string) {
  const auth = await requireAdmin()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { user, supabase } = auth.data

  if (confirmation !== 'DELETE PROJECT') {
    return { error: 'Type DELETE PROJECT to confirm permanent deletion.' }
  }

  const { data: project } = await supabase
    .from('projects')
    .select('name')
    .eq('id', projectId)
    .single()

  if (!project) return { error: 'Project not found' }

  await supabase.from('project_events').insert({
    project_id: projectId,
    actor_id: user.id,
    event_type: 'project_archived',
    payload: { action: 'delete_permanently_requested', project_name: project.name },
  })

  const deleteSteps = [
    supabase.from('stage_events').delete().eq('project_id', projectId),
    supabase.from('project_events').delete().eq('project_id', projectId),
    supabase.from('view_stage_states').delete().eq('project_id', projectId),
    supabase.from('project_view_rounds').delete().eq('project_id', projectId),
    supabase.from('project_views').delete().eq('project_id', projectId),
    supabase.from('projects').delete().eq('id', projectId),
  ]

  for (const step of deleteSteps) {
    const { error } = await step
    if (error) return { error: error.message }
  }


  revalidateProjectScreens(projectId)
  return { data: { deletedName: project.name } }
}

export async function updateProjectStatus(projectId: string, status: string) {
  const auth = await requireAdmin()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { user, supabase } = auth.data

  const { error } = await supabase
    .from('projects')
    .update({ status })
    .eq('id', projectId)

  if (error) return { error: error.message }

  await supabase.from('project_events').insert({
    project_id: projectId,
    actor_id: user.id,
    event_type: 'project_status_changed',
    payload: { status },
  })

  revalidateProjectScreens(projectId)
  return { data: true }
}

export async function updateProjectViewCount(projectId: string, newViewCount: number) {
  if (!Number.isInteger(newViewCount) || newViewCount < 1 || newViewCount > 99) {
    return { error: 'View count must be between 1 and 99.' }
  }

  const auth = await requireAdmin()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { user, supabase } = auth.data

  const { data: project } = await supabase
    .from('projects')
    .select('id, status, view_count')
    .eq('id', projectId)
    .single()

  if (!project) return { error: 'Project not found' }
  if (project.status === 'archived') return { error: 'Archived projects cannot be edited.' }

  const oldCount = project.view_count

  const { data: allViews } = await supabase
    .from('project_views')
    .select('*')
    .eq('project_id', projectId)
    .order('number')

  const viewsMap = new Map((allViews ?? []).map(v => [v.number, v]))

  if (newViewCount >= oldCount) {
    // Activate or create views up to newViewCount
    const upsertedViews: { id: string }[] = []

    for (let n = 1; n <= newViewCount; n++) {
      const existing = viewsMap.get(n)
      if (existing) {
        if (!existing.active) {
          await supabase.from('project_views').update({ active: true }).eq('id', existing.id)
        }
        upsertedViews.push({ id: existing.id })
      } else {
        const { data: newView } = await supabase
          .from('project_views')
          .insert({
            project_id: projectId,
            number: n,
            label: viewLabel(n),
            active: true,
          })
          .select('id')
          .single()
        if (newView) upsertedViews.push(newView)
      }
    }

    // For each newly active/created view, ensure a project_view_round exists
    for (const view of upsertedViews) {
      // Check if an active round already exists
      const { data: existingRound } = await supabase
        .from('project_view_rounds')
        .select('id')
        .eq('project_id', projectId)
        .eq('project_view_id', view.id)
        .eq('status', 'active')
        .maybeSingle()

      if (!existingRound) {
        // Find latest round to determine round_number
        const { data: latestRound } = await supabase
          .from('project_view_rounds')
          .select('round_number')
          .eq('project_id', projectId)
          .eq('project_view_id', view.id)
          .order('round_number', { ascending: false })
          .limit(1)
          .maybeSingle()

        const roundNumber = latestRound ? latestRound.round_number : 0

        const { data: newRound } = await supabase
          .from('project_view_rounds')
          .insert({
            project_id: projectId,
            project_view_id: view.id,
            round_number: roundNumber,
            status: 'active',
          })
          .select('id, project_view_id')
          .single()

        if (newRound) {
          // Create missing stage states for this new round
          const { data: existingStates } = await supabase
            .from('view_stage_states')
            .select('stage')
            .eq('project_view_round_id', newRound.id)

          const existingStageSet = new Set((existingStates ?? []).map(s => s.stage))

          const missingStates = STAGE_ORDER
            .filter(stage => !existingStageSet.has(stage))
            .map(stage => ({
              project_id: projectId,
              project_view_round_id: newRound.id,
              project_view_id: newRound.project_view_id,
              stage: stage as StageType,
              status: 'not_started' as const,
            }))

          if (missingStates.length > 0) {
            await supabase.from('view_stage_states').insert(missingStates)
          }
        }
      }
    }
  } else {
    // Deactivate views with number > newViewCount
    await supabase
      .from('project_views')
      .update({ active: false })
      .eq('project_id', projectId)
      .gt('number', newViewCount)
  }

  const { error: updateErr } = await supabase
    .from('projects')
    .update({ view_count: newViewCount })
    .eq('id', projectId)

  if (updateErr) return { error: updateErr.message }

  await supabase.from('project_events').insert({
    project_id: projectId,
    actor_id: user.id,
    event_type: 'view_count_changed',
    payload: { previous_view_count: oldCount, new_view_count: newViewCount },
  })

  revalidatePath('/admin/projects')
  revalidatePath(`/admin/projects/${projectId}`)
  revalidatePath('/app/widget')
  return { data: true }
}
