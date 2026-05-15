import { type ButtonHTMLAttributes, forwardRef } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
}

const variants = {
  primary:   'bg-accent text-canvas hover:bg-accent-dim font-medium',
  secondary: 'bg-surface border border-line-strong text-ink hover:bg-elevated',
  ghost:     'text-ink-2 hover:text-ink hover:bg-elevated',
  danger:    'text-blocked-text hover:bg-blocked-bg hover:text-blocked-text',
}

const sizes = {
  sm: 'px-3 py-1.5 text-[12px] rounded',
  md: 'px-4 py-2 text-[13px] rounded-md',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'md', className = '', disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled}
        className={[
          'inline-flex items-center justify-center transition-colors cursor-pointer',
          'disabled:opacity-40 disabled:cursor-not-allowed',
          'focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent',
          variants[variant],
          sizes[size],
          className,
        ].join(' ')}
        {...props}
      >
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'
