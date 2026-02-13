export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)}G`
  return `${mb.toFixed(0)}M`
}

export function formatMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)}G`
  return `${mb.toFixed(1)}M`
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return `${n}`
}

export function formatStatNum(v: number, unit?: string): string {
  if (unit === '%') return `${v.toFixed(1)}%`
  if (unit === 'ms') return `${v.toFixed(0)}ms`
  if (unit === 'MB') return `${v.toFixed(1)}M`
  if (unit === 'bytes') return formatBytes(v)
  if (unit === '/s') return v.toFixed(1)
  return v.toFixed(1)
}

export function computeStats(data: number[]) {
  if (data.length === 0) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const avg = data.reduce((a, b) => a + b, 0) / data.length
  return { min, max, avg }
}

export function cpuColor(v: number) {
  return v > 80 ? 'text-red-400' : v > 50 ? 'text-amber-400' : 'text-emerald-400'
}

export function latencyColor(v: number, warn: number, crit: number) {
  return v > crit ? 'text-red-400' : v > warn ? 'text-amber-400' : 'text-emerald-400'
}

export function errorRateColor(v: number) {
  return v > 5 ? 'text-red-400' : v > 1 ? 'text-amber-400' : 'text-emerald-400'
}

export function ratioColor(used: number, max: number) {
  if (max === 0) return 'text-neutral-500'
  const pct = used / max
  return pct > 0.8 ? 'text-red-400' : pct > 0.5 ? 'text-amber-400' : 'text-emerald-400'
}

export function hitRateColor(v: number) {
  return v < 70 ? 'text-red-400' : v < 90 ? 'text-amber-400' : 'text-emerald-400'
}

export function warnIfPositive(v: number, threshold = 0) {
  return v > threshold ? 'text-amber-400' : 'text-emerald-400'
}

export function cpuHex(v: number) {
  return v > 80 ? '#f87171' : v > 50 ? '#fbbf24' : '#34d399'
}

export function latencyHex(v: number, warn: number, crit: number) {
  return v > crit ? '#f87171' : v > warn ? '#fbbf24' : '#34d399'
}
