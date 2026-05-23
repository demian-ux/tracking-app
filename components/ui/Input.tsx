import { type InputHTMLAttributes, type SelectHTMLAttributes, forwardRef } from 'react'

const fieldClass =
  'w-full h-9 px-3 bg-surface border border-line rounded-sm text-body text-ink ' +
  'placeholder:text-ink-3 transition-colors duration-100 ease-out [color-scheme:dark] ' +
  'hover:border-line-strong focus:outline-none focus:border-accent'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = '', ...props }, ref) {
    return <input ref={ref} className={`${fieldClass} ${className}`} {...props} />
  },
)

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className = '', children, ...props }, ref) {
    return (
      <select ref={ref} className={`${fieldClass} cursor-pointer ${className}`} {...props}>
        {children}
      </select>
    )
  },
)
