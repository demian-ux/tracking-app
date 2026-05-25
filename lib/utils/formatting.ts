import type { TimeWindow } from '@/lib/types/database'

export function formatDate(date: string | null): string {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatDelivery(date: string | null, window: TimeWindow | null): string {
  if (!date) return '—'
  const d = formatDate(date)
  return window ? `${d} · ${window}` : d
}

/**
 * Per-view delivery label. round_number is 0-indexed: round 0 is the first
 * delivery, round 1 is the second (first revision), etc.
 */
export function deliveryLabel(roundNumber: number): string {
  return `Delivery ${roundNumber + 1}`
}
