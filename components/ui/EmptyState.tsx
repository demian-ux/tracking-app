import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

interface EmptyStateProps {
  icon?: IconName
  title?: string
  sub?: string
  action?: ReactNode
}

/** The single empty-state treatment — 48px vertical padding everywhere. */
export function EmptyState({ icon, title, sub, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center text-center gap-3 py-12 px-6">
      {icon && (
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-line text-ink-3">
          <Icon name={icon} size={14} />
        </span>
      )}
      {title && <div className="text-heading font-semibold text-ink">{title}</div>}
      {sub && <div className="text-body text-ink-2 max-w-[260px]">{sub}</div>}
      {action}
    </div>
  )
}
