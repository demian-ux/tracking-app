export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 bg-elevated rounded-full h-[3px] overflow-hidden">
        <div
          className="bg-accent h-full rounded-full transition-all duration-500 ease-out"
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="text-[11px] text-ink-2 tabular-nums w-7 text-right shrink-0 font-medium">{value}%</span>
    </div>
  )
}
