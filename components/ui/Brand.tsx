import Image from 'next/image'

interface BrandMarkProps {
  size?: number
  className?: string
}

/** The OAKI logo, served from /public/logo.png. */
export function BrandMark({ size = 16, className }: BrandMarkProps) {
  return (
    <Image
      src="/logo.png"
      alt="OAKI"
      width={size}
      height={size}
      priority
      className={className}
    />
  )
}

interface BrandProps {
  size?: number
  className?: string
}

export function Brand({ size = 16, className = '' }: BrandProps) {
  return (
    <span className={['inline-flex items-center gap-2 text-ink-2 select-none', className].join(' ')}>
      <BrandMark size={size} />
      <span className="text-caption uppercase tracking-[0.18em] font-medium">OAKI Tracker</span>
    </span>
  )
}
