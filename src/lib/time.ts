/**
 * Compact age for the task rail, the way zcode prints it: `2m`, `3h`, `5d`.
 * Anything under a minute reads as seconds, so a fresh task never says `0m`.
 */

export function relativeTime(from: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - from) / 1000))
  if (seconds < 45) return `${Math.max(1, seconds)}s`

  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`

  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d`

  const months = Math.round(days / 30)
  if (months < 12) return `${months}mo`

  return `${Math.round(months / 12)}y`
}
