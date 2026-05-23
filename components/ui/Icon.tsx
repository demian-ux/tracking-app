import type { CSSProperties } from 'react'

const s = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

const paths = {
  check: <polyline points="3,8 6.5,11.5 13,4" {...s} />,
  x: (
    <>
      <line x1="3.5" y1="3.5" x2="12.5" y2="12.5" {...s} />
      <line x1="12.5" y1="3.5" x2="3.5" y2="12.5" {...s} />
    </>
  ),
  block: (
    <>
      <circle cx="8" cy="8" r="5.5" {...s} />
      <line x1="4.5" y1="11.5" x2="11.5" y2="4.5" {...s} />
    </>
  ),
  'arrow-right': (
    <>
      <line x1="3" y1="8" x2="13" y2="8" {...s} />
      <polyline points="9,4 13,8 9,12" {...s} />
    </>
  ),
  'arrow-left': (
    <>
      <line x1="13" y1="8" x2="3" y2="8" {...s} />
      <polyline points="7,4 3,8 7,12" {...s} />
    </>
  ),
  plus: (
    <>
      <line x1="8" y1="3" x2="8" y2="13" {...s} />
      <line x1="3" y1="8" x2="13" y2="8" {...s} />
    </>
  ),
  pencil: <path d="M11.5 2.5l2 2-7 7H4.5v-2z" {...s} />,
  bell: (
    <path
      d="M8 2.5c-2.2 0-3.5 1.5-3.5 3.5v2.5L3 10h10l-1.5-1.5V6c0-2-1.3-3.5-3.5-3.5zM6.5 12.5c0 1 .8 1.5 1.5 1.5s1.5-.5 1.5-1.5"
      {...s}
    />
  ),
  flag: (
    <>
      <line x1="3.5" y1="2.5" x2="3.5" y2="13.5" {...s} />
      <path d="M3.5 3h8l-2 2.5 2 2.5h-8" {...s} />
    </>
  ),
  dot: <circle cx="8" cy="8" r="2" fill="currentColor" />,
  rotate: (
    <>
      <path d="M2.5 8a5.5 5.5 0 0 1 9.5-3.8" {...s} />
      <polyline points="12,2 12,4.5 9.5,4.5" {...s} />
      <path d="M13.5 8a5.5 5.5 0 0 1-9.5 3.8" {...s} />
      <polyline points="4,14 4,11.5 6.5,11.5" {...s} />
    </>
  ),
  eye: (
    <>
      <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z" {...s} />
      <circle cx="8" cy="8" r="2" {...s} />
    </>
  ),
  send: (
    <>
      <path d="M14 2L7 9" {...s} />
      <path d="M14 2L9.5 14 7 9 2 6.5z" {...s} />
    </>
  ),
  archive: (
    <>
      <rect x="2" y="3" width="12" height="3" rx="0.5" {...s} />
      <path d="M3 6v7h10V6" {...s} />
      <line x1="6" y1="9" x2="10" y2="9" {...s} />
    </>
  ),
  user: (
    <>
      <circle cx="8" cy="5.5" r="2.5" {...s} />
      <path d="M3 14c0-2.5 2.2-4 5-4s5 1.5 5 4" {...s} />
    </>
  ),
  folder: (
    <path
      d="M2 4.5C2 3.7 2.7 3 3.5 3h3l1.5 1.5h4.5c.8 0 1.5.7 1.5 1.5v6.5c0 .8-.7 1.5-1.5 1.5h-9c-.8 0-1.5-.7-1.5-1.5z"
      {...s}
    />
  ),
  inbox: (
    <>
      <path d="M2 9.5L3.5 3h9L14 9.5v3.5c0 .3-.2.5-.5.5h-11c-.3 0-.5-.2-.5-.5z" {...s} />
      <path d="M2 9.5h3.5l.8 1.5h3.4l.8-1.5H14" {...s} />
    </>
  ),
  calendar: (
    <>
      <rect x="2.5" y="3.5" width="11" height="10" rx="1" {...s} />
      <line x1="2.5" y1="6.5" x2="13.5" y2="6.5" {...s} />
      <line x1="5.5" y1="2" x2="5.5" y2="5" {...s} />
      <line x1="10.5" y1="2" x2="10.5" y2="5" {...s} />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4.5" {...s} />
      <line x1="10.5" y1="10.5" x2="13.5" y2="13.5" {...s} />
    </>
  ),
  settings: (
    <>
      <circle cx="8" cy="8" r="2" {...s} />
      <path
        d="M8 1.5v2M8 12.5v2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M1.5 8h2M12.5 8h2M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"
        {...s}
      />
    </>
  ),
  kebab: (
    <>
      <circle cx="3" cy="8" r="1.2" fill="currentColor" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" />
      <circle cx="13" cy="8" r="1.2" fill="currentColor" />
    </>
  ),
}

export type IconName = keyof typeof paths

interface IconProps {
  name: IconName
  size?: number
  className?: string
  style?: CSSProperties
}

export function Icon({ name, size = 14, className, style }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}
