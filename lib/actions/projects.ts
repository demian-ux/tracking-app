'use server'

import { revalidatePath } from 'next/cache'
import { revalidateProjectScreens } from '@/lib/utils/revalidate'
import { requireAdmin } from '@/lib/actions/auth'
import type { CreateProjectInput } from '@/lib/types/app'
import type { TimeWindow } from '@/lib/types/database'

export async function createProject(input: CreateProjectInput) {
  const auth = await requireAdmin()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { supabase } = auth.data

  const { data, error } = await supabase.rpc('create_project_workflow_rpc', {
    p_name: input.name,
    p_client_id: input.clientId ?? null,
    p_delivery_date: input.deliveryDate ?? null,
    p_delivery_time_window: input.deliveryTimeWindow ?? null,
    p_view_count: input.viewCount,
    p_notes: input.notes ?? null,
  })

  if (error) return { error: error.message }
  if (!data.ok) return { error: data.error as string }

  revalidatePath('/admin/projects')
  return { data: { id: data.project_id as string } }
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
