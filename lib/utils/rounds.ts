import type { DeliveryRound, Project } from '@/lib/types/app'

export const WORKING_ROUND_STATUSES = ['active', 'ready_for_admin_review'] as const

/** Returns the round matching project.current_round_number, falling back to the highest-numbered round. */
export function getCurrentRoundFromList(
  rounds: DeliveryRound[],
  project: Pick<Project, 'current_round_number'>
): DeliveryRound | null {
  return (
    rounds.find(r => r.round_number === project.current_round_number) ??
    [...rounds].sort((a, b) => b.round_number - a.round_number)[0] ??
    null
  )
}

/** Returns the latest round that is still in a working state (active or ready_for_admin_review). */
export function getLatestWorkingRoundFromList(rounds: DeliveryRound[]): DeliveryRound | null {
  return (
    [...rounds]
      .filter(r => (WORKING_ROUND_STATUSES as readonly string[]).includes(r.status))
      .sort((a, b) => b.round_number - a.round_number)[0] ?? null
  )
}
