function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

interface AvatarProps {
  name: string
  size?: number
}

export function Avatar({ name, size = 18 }: AvatarProps) {
  return (
    <span
      title={name}
      className="inline-flex items-center justify-center rounded-full bg-elevated text-ink-2 border border-line font-bold leading-none shrink-0"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
    >
      {initials(name)}
    </span>
  )
}
