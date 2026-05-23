import type { ReactNode } from 'react'

interface FilterChipProps {
  active?: boolean
  count?: number
  onClick?: () => void
  children: ReactNode
}

export function FilterChip({ active = false, count, onClick, children }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-sm cursor-pointer border',
        'text-sm transition-colors duration-100 ease-out',
        active
          ? 'bg-elevated text-ink border-line-strong'
          : 'bg-transparent text-ink-2 border-line hover:text-ink hover:border-line-strong',
      ].join(' ')}
    >
      {children}
      {count != null && (
        <span
          className={[
            'text-[10px] px-1.5 rounded-full tabular-nums',
            active ? 'text-ink-2 bg-canvas' : 'text-ink-3 bg-surface',
          ].join(' ')}
        >
          {count}
        </span>
      )}
    </button>
  )
}
