'use server'

import { revalidatePath } from 'next/cache'
import { revalidateProjectScreens } from '@/lib/utils/revalidate'
import { requireAdmin } from '@/lib/actions/auth'
import type { CreateProjectInput } from '@/lib/types/app'
import { viewLabel, STAGE_ORDER } from '@/lib/types/app'
import type { TimeWindow } from '@/lib/types/database'

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

  const { data, error } = await supabase.rpc('delete_project_permanently_rpc', {
    p_project_id: projectId,
  })

  if (error) return { error: error.message }
  if (!data.ok) return { error: data.error as string }

  revalidateProjectScreens(projectId)
  return { data: { deletedName: data.deleted_name as string } }
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
