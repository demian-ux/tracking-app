'use client'

import { useRouter, usePathname } from 'next/navigation'
import { roundLabel } from '@/lib/utils/formatting'

interface Round {
  id: string
  round_number: number
  status: string
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  delivered: 'Delivered',
  revision_requested: 'Revision req.',
}

export function RoundSelector({
  rounds,
  selectedRoundNumber,
}: {
  rounds: Round[]
  selectedRoundNumber: number
}) {
  const router = useRouter()
  const pathname = usePathname()

  if (rounds.length <= 1) return null

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {rounds.map(r => (
        <button
          key={r.id}
          onClick={() => router.push(`${pathname}?round=${r.round_number}`)}
          className={`px-2.5 py-1 text-[11px] rounded border transition-colors ${
            r.round_number === selectedRoundNumber
              ? 'border-accent text-accent bg-surface'
              : 'border-line text-ink-3 bg-surface hover:border-line-strong hover:text-ink-2'
          }`}
        >
          {roundLabel(r.round_number)}
          <span className="mx-1 opacity-40">·</span>
          <span className="opacity-70">{STATUS_LABELS[r.status] ?? r.status}</span>
        </button>
      ))}
    </div>
  )
}
