interface ProgressBarProps {
  value: number
  showPct?: boolean
  tone?: 'accent' | 'done'
}

export function ProgressBar({ value, showPct = true, tone = 'accent' }: ProgressBarProps) {
  return (
    <div className="flex items-center gap-2.5 w-full">
      <div className="flex-1 bg-elevated rounded-full h-[3px] overflow-hidden">
        <div
          className={[
            'h-full rounded-full transition-[width] duration-500 ease-out',
            tone === 'done' ? 'bg-done-text' : 'bg-accent',
          ].join(' ')}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
      {showPct && (
        <span className="text-caption text-ink-2 tabular-nums font-medium min-w-[34px] text-right shrink-0">
          {value}%
        </span>
      )}
    </div>
  )
}
