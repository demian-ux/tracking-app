interface BrandMarkProps {
  size?: number
  className?: string
}

/** The Oaki isotype — a striped sphere, rendered as SVG so it stays crisp. */
export function BrandMark({ size = 14, className }: BrandMarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} aria-label="Oaki">
      <defs>
        <clipPath id="oaki-clip">
          <circle cx="8" cy="8" r="7" />
        </clipPath>
      </defs>
      <g clipPath="url(#oaki-clip)">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <rect key={i} x={i * 2} y="0" width="1" height="16" fill="currentColor" opacity="0.85" />
        ))}
      </g>
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}

interface BrandProps {
  size?: number
  className?: string
}

export function Brand({ size = 14, className = '' }: BrandProps) {
  return (
    <span className={['inline-flex items-center gap-2 text-ink-2 select-none', className].join(' ')}>
      <BrandMark size={size} />
      <span className="text-caption uppercase tracking-[0.18em] font-medium">Oaki</span>
    </span>
  )
}
