import type { ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  className?: string
}

export function Card({ children, className = '' }: CardProps) {
  return (
    <div className={['bg-surface border border-line rounded-md p-4', className].join(' ')}>
      {children}
    </div>
  )
}
