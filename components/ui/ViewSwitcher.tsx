import Link from 'next/link'

interface Props {
  active: 'widget' | 'admin'
}

const pill = 'px-2.5 py-1 text-caption uppercase font-semibold tracking-wide rounded-sm transition-colors duration-100 ease-out'

export function ViewSwitcher({ active }: Props) {
  return (
    <div className="flex items-center gap-0.5 bg-surface border border-line rounded-md p-0.5">
      <Link
        href="/app/widget"
        className={`${pill} ${active === 'widget' ? 'bg-overlay text-ink' : 'text-ink-3 hover:text-ink-2'}`}
      >
        Widget
      </Link>
      <Link
        href="/admin/projects"
        className={`${pill} ${active === 'admin' ? 'bg-overlay text-ink' : 'text-ink-3 hover:text-ink-2'}`}
      >
        Admin
      </Link>
    </div>
  )
}
