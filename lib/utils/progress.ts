export function calculateProgress(states: { status: string }[]): number {
  if (states.length === 0) return 0
  const completed = states.filter(s => s.status === 'done').length
  return Math.round((completed / states.length) * 100)
}
