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

  const { data: round, error: roundError } = await supabase
    .from('delivery_rounds')
    .insert({ project_id: project.id, round_number: 0, status: 'active' })
    .select()
    .single()

  if (roundError || !round) return { error: roundError?.message ?? 'Failed to create round' }

  const stateInserts = views.flatMap(view =>
    STAGE_ORDER.map(stage => ({
      project_id: project.id,
      delivery_round_id: round.id,
      project_view_id: view.id,
      stage,
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

export async function deleteProjectPermanently(projectId: string) {
  const auth = await requireAdmin()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { supabase } = auth.data

  const { data: project } = await supabase
    .from('projects')
    .select('name')
    .eq('id', projectId)
    .single()

  if (!project) return { error: 'Project not found' }

  const { error } = await supabase
    .from('projects')
    .delete()
    .eq('id', projectId)

  if (error) return { error: error.message }

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
    for (let n = 1; n <= newViewCount; n++) {
      const existing = viewsMap.get(n)
      if (existing) {
        if (!existing.active) {
          await supabase.from('project_views').update({ active: true }).eq('id', existing.id)
        }
      } else {
        await supabase.from('project_views').insert({
          project_id: projectId,
          number: n,
          label: viewLabel(n),
          active: true,
        })
      }
    }

    // Ensure stage states exist for all active views across all rounds
    const { data: rounds } = await supabase
      .from('delivery_rounds')
      .select('id')
      .eq('project_id', projectId)

    const { data: activeViews } = await supabase
      .from('project_views')
      .select('id')
      .eq('project_id', projectId)
      .eq('active', true)
      .lte('number', newViewCount)

    if (rounds && activeViews) {
      for (const round of rounds) {
        const { data: existingStates } = await supabase
          .from('view_stage_states')
          .select('project_view_id, stage')
          .eq('delivery_round_id', round.id)

        const existingSet = new Set(
          (existingStates ?? []).map(s => `${s.project_view_id}:${s.stage}`)
        )

        const missing = activeViews.flatMap(view =>
          STAGE_ORDER
            .filter(stage => !existingSet.has(`${view.id}:${stage}`))
            .map(stage => ({
              project_id: projectId,
              delivery_round_id: round.id,
              project_view_id: view.id,
              stage: stage as StageType,
              status: 'not_started' as const,
            }))
        )

        if (missing.length > 0) {
          await supabase.from('view_stage_states').insert(missing)
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
