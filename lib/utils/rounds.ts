import type { DeliveryRound, Project } from '@/lib/types/app'

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

/** Returns the latest active round, or the highest-numbered round if none is active. */
export function getLatestWorkingRoundFromList(rounds: DeliveryRound[]): DeliveryRound | null {
  const active = rounds.filter(r => r.status === 'active')
  if (active.length > 0) {
    return [...active].sort((a, b) => b.round_number - a.round_number)[0]
  }
  return [...rounds].sort((a, b) => b.round_number - a.round_number)[0] ?? null
}
