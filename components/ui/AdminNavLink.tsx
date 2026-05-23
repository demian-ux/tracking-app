'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function AdminNavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname()
  const isActive = pathname === href || pathname.startsWith(href + '/')

  return (
    <Link
      href={href}
      className={[
        'px-2.5 py-1.5 text-sm rounded-sm transition-colors duration-100 ease-out',
        isActive
          ? 'bg-elevated text-ink font-medium'
          : 'text-ink-3 hover:text-ink hover:bg-elevated',
      ].join(' ')}
    >
      {children}
    </Link>
  )
}
