import type { ProjectViewRound } from '@/lib/types/app'

/** Returns the active round for a given view, or null. */
export function getActiveViewRound(rounds: ProjectViewRound[], viewId: string): ProjectViewRound | null {
  return rounds.find(r => r.project_view_id === viewId && r.status === 'active') ?? null
}
