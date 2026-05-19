import Link from 'next/link'

interface Props {
  active: 'widget' | 'admin'
}

export function ViewSwitcher({ active }: Props) {
  return (
    <div className="flex items-center bg-elevated border border-line rounded-lg p-0.5 gap-0.5">
      <Link
        href="/app/widget"
        className={[
          'px-3 py-1 text-[11px] font-medium rounded-md transition-all',
          active === 'widget'
            ? 'bg-overlay text-ink'
            : 'text-ink-3 hover:text-ink-2',
        ].join(' ')}
      >
        Widget
      </Link>
      <Link
        href="/admin/projects"
        className={[
          'px-3 py-1 text-[11px] font-medium rounded-md transition-all',
          active === 'admin'
            ? 'bg-overlay text-ink'
            : 'text-ink-3 hover:text-ink-2',
        ].join(' ')}
      >
        Admin
      </Link>
    </div>
  )
}
