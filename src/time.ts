// 83.456 -> "1:23.46", 3723 -> "1:02:03.00"
export function formatTime(seconds: number): string {
  const total = Math.round(Math.max(0, seconds) * 100) // round first, so 59.999 isn't "0:60.00"
  const h = Math.floor(total / 360_000)
  const m = Math.floor(total / 6000) % 60
  const s = ((total % 6000) / 100).toFixed(2).padStart(5, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

// Accepts "83.45", "1:23.45" and "1:02:03.45"; a comma works as the decimal
// point too. Returns null for anything else (including "1:75").
export function parseTime(text: string): number | null {
  const m = /^(?:(?:(\d+):)?(\d+):)?(\d+(?:[.,]\d*)?|[.,]\d+)$/.exec(text.trim())
  if (!m) return null
  const hours = Number(m[1] ?? 0)
  const mins = Number(m[2] ?? 0)
  const secs = Number(m[3].replace(',', '.'))
  if (m[2] !== undefined && secs >= 60) return null
  if (m[1] !== undefined && mins >= 60) return null
  const total = hours * 3600 + mins * 60 + secs
  return Number.isFinite(total) ? total : null
}
