export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex-1 bg-line-strong rounded-full h-[2px]">
        <div
          className="bg-accent h-[2px] rounded-full transition-all duration-300"
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="text-[11px] text-ink-3 tabular-nums w-7 text-right shrink-0">{value}%</span>
    </div>
  )
}
