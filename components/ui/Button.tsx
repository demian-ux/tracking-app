import { type ButtonHTMLAttributes, type ReactNode, forwardRef } from 'react'
import Link from 'next/link'
import { Icon, type IconName } from './Icon'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

const base =
  'inline-flex items-center justify-center border font-medium whitespace-nowrap select-none cursor-pointer ' +
  'transition-colors duration-100 ease-out disabled:opacity-40 disabled:cursor-not-allowed'

const variants: Record<Variant, string> = {
  primary:   'bg-accent text-canvas border-transparent hover:bg-accent-dim',
  secondary: 'bg-surface text-ink border-line-strong hover:bg-elevated hover:border-ink-3',
  ghost:     'bg-transparent text-ink-2 border-transparent hover:bg-elevated hover:text-ink',
  danger:    'bg-transparent text-blocked-text border-blocked-text/25 hover:bg-blocked-bg hover:border-blocked-text/50',
}

const sizes: Record<Size, string> = {
  md: 'h-9 px-3.5 text-body rounded-md gap-1.5',
  sm: 'h-8 px-3 text-sm rounded-sm gap-1',
}

function buttonClass(variant: Variant, size: Size, full?: boolean, extra = '') {
  return [base, variants[variant], sizes[size], full ? 'w-full' : '', extra].filter(Boolean).join(' ')
}

function Spinner() {
  return <span className="w-3 h-3 rounded-full border-[1.5px] border-current border-r-transparent animate-spin" />
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  full?: boolean
  leftIcon?: IconName
  rightIcon?: IconName
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    full = false,
    leftIcon,
    rightIcon,
    className = '',
    disabled,
    children,
    type = 'button',
    ...props
  },
  ref,
) {
  const iconSize = size === 'sm' ? 12 : 14
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={buttonClass(variant, size, full, className)}
      {...props}
    >
      {loading && <Spinner />}
      {!loading && leftIcon && <Icon name={leftIcon} size={iconSize} />}
      {children}
      {!loading && rightIcon && <Icon name={rightIcon} size={iconSize} />}
    </button>
  )
})

interface ButtonLinkProps {
  href: string
  variant?: Variant
  size?: Size
  full?: boolean
  leftIcon?: IconName
  rightIcon?: IconName
  className?: string
  children: ReactNode
}

/** A Next.js Link styled exactly like a Button — for navigation actions. */
export function ButtonLink({
  href,
  variant = 'secondary',
  size = 'md',
  full = false,
  leftIcon,
  rightIcon,
  className = '',
  children,
}: ButtonLinkProps) {
  const iconSize = size === 'sm' ? 12 : 14
  return (
    <Link href={href} className={buttonClass(variant, size, full, className)}>
      {leftIcon && <Icon name={leftIcon} size={iconSize} />}
      {children}
      {rightIcon && <Icon name={rightIcon} size={iconSize} />}
    </Link>
  )
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, className = '', type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={[
        'inline-flex items-center justify-center h-8 w-8 rounded-sm cursor-pointer',
        'bg-transparent text-ink-2 hover:bg-elevated hover:text-ink',
        'transition-colors duration-100 ease-out disabled:opacity-40 disabled:cursor-not-allowed',
        className,
      ].join(' ')}
      {...props}
    >
      <Icon name={icon} size={14} />
    </button>
  )
})
