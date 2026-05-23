import type { ReactNode } from 'react'

interface SectionLabelProps {
  children: ReactNode
  count?: number
  action?: ReactNode
  rule?: boolean
  className?: string
}

/** The single section-label treatment — replaces all bespoke variants. */
export function SectionLabel({
  children,
  count,
  action,
  rule = true,
  className = '',
}: SectionLabelProps) {
  return (
    <div className={['flex items-center gap-2.5 mb-3', className].join(' ')}>
      <span className="text-label font-semibold uppercase text-ink-3 select-none">
        {children}
      </span>
      {count != null && (
        <span className="text-label font-semibold text-ink-3 tabular-nums px-2 py-0.5 bg-surface border border-line rounded-full">
          {count}
        </span>
      )}
      {rule && <span className="flex-1 border-t border-line" />}
      {action && <span className="shrink-0">{action}</span>}
    </div>
  )
}
