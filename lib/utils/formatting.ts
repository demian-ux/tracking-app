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

export function roundLabel(n: number): string {
  return `Round ${String(n).padStart(2, '0')}`
}
