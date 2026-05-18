'use server'

import { revalidateProjectScreens } from '@/lib/utils/revalidate'
import { requireAdmin } from '@/lib/actions/auth'

export interface IncompleteItem {
  viewLabel: string
  stageLabel: string
  status: string
}

export async function markDeliverySent(projectId: string, roundId: string) {
  const auth = await requireAdmin()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { supabase } = auth.data

  const { data, error } = await supabase.rpc('mark_delivery_sent_rpc', {
    p_project_id: projectId,
    p_round_id: roundId,
  })

  if (error) return { error: error.message }
  if (!data.ok) {
    return {
      error: data.error as string,
      incomplete: (data.incomplete ?? []) as IncompleteItem[],
    }
  }

  revalidateProjectScreens(projectId)
  return { data: true }
}

export async function createRevisionRound(projectId: string) {
  const auth = await requireAdmin()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { supabase } = auth.data

  const { data, error } = await supabase.rpc('create_revision_round_rpc', {
    p_project_id: projectId,
  })

  if (error) return { error: error.message }
  if (!data.ok) return { error: data.error as string }

  revalidateProjectScreens(projectId)
  return { data: { round_id: data.round_id as string, round_number: data.round_number as number } }
}
