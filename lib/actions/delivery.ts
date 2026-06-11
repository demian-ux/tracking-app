'use server'

import { revalidateProjectScreens } from '@/lib/utils/revalidate'
import { requireAdmin } from '@/lib/actions/auth'
import { STAGE_LABELS } from '@/lib/types/app'
import type { StageType } from '@/lib/types/database'

export interface IncompleteItem {
  viewLabel: string
  stageLabel: string
  status: string
}

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

export async function markDeliverySent(projectId: string, viewIds: string[]) {
  const auth = await requireAdmin()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { supabase } = auth.data

  if (!viewIds || viewIds.length === 0) return { error: 'No views selected' }

  const { data, error } = await supabase.rpc('mark_delivery_sent_v2_rpc', {
    p_project_id: projectId,
    p_view_ids: viewIds,
  })

  if (error) return { error: rpcErrorToString(error) }
  const result = data as RpcResult<{ deliveredAt: string; roundCount: number }> & {
    incomplete?: { viewLabel: string; stage: StageType; status: string }[]
  }
  if (!result?.ok) {
    if (result?.error === 'incomplete') {
      const incomplete: IncompleteItem[] = (result.incomplete ?? []).map(item => ({
        viewLabel: item.viewLabel,
        stageLabel: STAGE_LABELS[item.stage],
        status: item.status,
      }))
      return { error: `${incomplete.length} stage(s) not done`, incomplete }
    }
    return { error: result?.error ?? 'Delivery failed' }
  }

  revalidateProjectScreens(projectId)
  return { data: true }
}

export async function undoDeliverySent(projectId: string, deliveredAt: string) {
  const auth = await requireAdmin()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { supabase } = auth.data

  const { data, error } = await supabase.rpc('undo_delivery_sent_v2_rpc', {
    p_project_id: projectId,
    p_delivered_at: deliveredAt,
  })

  if (error) return { error: rpcErrorToString(error) }
  const result = data as RpcResult<{ revertedCount: number; revisionRoundsRemoved: number }>
  if (!result?.ok) return { error: result?.error ?? 'Undo failed' }

  revalidateProjectScreens(projectId)
  return {
    data: {
      revertedCount: result.revertedCount,
      revisionRoundsRemoved: result.revisionRoundsRemoved,
    },
  }
}

export async function createRevisionRound(projectId: string, viewIds: string[]) {
  const auth = await requireAdmin()
  if (auth.error || !auth.data) return { error: auth.error ?? 'Auth error' }
  const { supabase } = auth.data

  if (!viewIds || viewIds.length === 0) return { error: 'No views selected' }

  const { data, error } = await supabase.rpc('create_revision_round_v2_rpc', {
    p_project_id: projectId,
    p_view_ids: viewIds,
  })

  if (error) return { error: rpcErrorToString(error) }
  const result = data as RpcResult<{ viewIds: string[] }>
  if (!result?.ok) return { error: result?.error ?? 'Could not create revision round' }

  revalidateProjectScreens(projectId)
  return { data: { view_ids: result.viewIds ?? viewIds } }
}
