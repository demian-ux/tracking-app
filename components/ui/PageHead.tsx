import type { ReactNode } from 'react'

interface PageHeadProps {
  title: ReactNode
  sub?: ReactNode
  actions?: ReactNode
}

/** Page grammar: a title row (text-display) with optional sub + right-aligned actions. */
export function PageHead({ title, sub, actions }: PageHeadProps) {
  return (
    <div className="flex items-end justify-between gap-4 mb-6">
      <div className="flex items-baseline gap-3 min-w-0">
        <h1 className="text-display font-semibold text-ink">{title}</h1>
        {sub && <span className="text-caption text-ink-2 shrink-0">{sub}</span>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}
