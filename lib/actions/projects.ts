'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { CreateProjectInput } from '@/lib/types/app'
import type { TimeWindow } from '@/lib/types/database'
import { viewLabel } from '@/lib/types/app'
import { STAGE_ORDER } from '@/lib/types/app'

export async function createProject(input: CreateProjectInput) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: actor } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (actor?.role !== 'admin') return { error: 'Forbidden' }

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .insert({
      name: input.name,
      client_id: input.clientId,
      notes: input.notes ?? null,
      delivery_date: input.deliveryDate,
      delivery_time_window: input.deliveryTimeWindow,
      view_count: input.viewCount,
      status: 'active',
    })
    .select()
    .single()

  if (projectError || !project) return { error: projectError?.message ?? 'Failed to create project' }

  // Create views
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

  // Create Round 00
  const { data: round, error: roundError } = await supabase
    .from('delivery_rounds')
    .insert({ project_id: project.id, round_number: 0, status: 'active' })
    .select()
    .single()

  if (roundError || !round) return { error: roundError?.message ?? 'Failed to create round' }

  // Create view_stage_states for all views × all stages
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

  // Log event
  await supabase.from('project_events').insert({
    project_id: project.id,
    actor_id: user.id,
    event_type: 'project_created',
    payload: { name: input.name, view_count: input.viewCount },
  })

  revalidatePath('/admin/projects')
  return { data: project }
}

export async function updateProjectDates(
  projectId: string,
  updates: {
    deliveryDate?: string | null
    deliveryTimeWindow?: TimeWindow | null
  }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: actor } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (actor?.role !== 'admin') return { error: 'Forbidden' }

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

  revalidatePath(`/admin/projects/${projectId}`)
  return { data: true }
}

export async function archiveProject(projectId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: actor } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (actor?.role !== 'admin') return { error: 'Forbidden' }

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

  revalidatePath('/admin/projects')
  revalidatePath(`/admin/projects/${projectId}`)
  return { data: true }
}

export async function updateProjectStatus(projectId: string, status: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: actor } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (actor?.role !== 'admin') return { error: 'Forbidden' }

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

  revalidatePath('/admin/projects')
  revalidatePath(`/admin/projects/${projectId}`)
  revalidatePath('/admin/today')
  return { data: true }
}
