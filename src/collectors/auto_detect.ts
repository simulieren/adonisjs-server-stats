import { log, dim, green, bold } from '../utils/logger.js'

import type { MetricCollector } from './collector.js'

/**
 * Probe whether a package is importable at runtime.
 *
 * Uses dynamic `import()` wrapped in try/catch so a missing
 * optional dependency simply returns `false` instead of crashing.
 */
async function isInstalled(pkg: string): Promise<boolean> {
  try {
    await import(pkg)
    return true
  } catch {
    return false
  }
}

/**
 * Describes a single collector entry for the boot log.
 */
interface CollectorEntry {
  /** Short name shown in the log (e.g. "process", "db-pool"). */
  name: string
  /** Brief description of what the collector tracks. */
  description: string
  /** Whether the collector was enabled. */
  enabled: boolean
  /**
   * For optional collectors: the package that was found (when enabled)
   * or the package to install (when skipped).
   */
  reason?: string
}

/** Result returned by {@link autoDetectCollectors}. */
export interface AutoDetectResult {
  /** Collector instances ready for the {@link StatsEngine}. */
  collectors: MetricCollector[]
  /** Total number of available collectors (enabled + skipped). */
  total: number
  /** Number of collectors that were enabled. */
  active: number
}

/**
 * Auto-detect which metric collectors to enable based on installed packages.
 *
 * Always enables collectors with no external dependencies:
 * - `processCollector` -- Node.js process metrics
 * - `systemCollector` -- OS-level system metrics
 * - `httpCollector` -- HTTP request metrics
 * - `logCollector` -- log stream metrics
 *
 * Conditionally enables collectors when their peer dependency is importable:
 * - `dbPoolCollector` + `appCollector` -- when `@adonisjs/lucid` is installed
 * - `redisCollector` -- when `@adonisjs/redis` is installed
 * - `queueCollector` -- when `bullmq` is installed
 *
 * This function is meant to run at startup, so the async overhead of
 * probing packages is acceptable.
 *
 * @returns Resolved collectors and detection metadata for the boot summary.
 */
export async function autoDetectCollectors(): Promise<AutoDetectResult> {
  const collectors: MetricCollector[] = []
  const entries: CollectorEntry[] = []

  // ── Always-on collectors (no external deps) ──────────────────────
  const { processCollector } = await import('./process_collector.js')
  const { systemCollector } = await import('./system_collector.js')
  const { httpCollector } = await import('./http_collector.js')
  const { logCollector } = await import('./log_collector.js')

  collectors.push(processCollector())
  entries.push({ name: 'process', description: 'CPU, memory, event loop', enabled: true })

  collectors.push(systemCollector())
  entries.push({ name: 'system', description: 'OS load, memory, uptime', enabled: true })

  collectors.push(httpCollector())
  entries.push({ name: 'http', description: 'req/s, latency, errors', enabled: true })

  collectors.push(logCollector())
  entries.push({ name: 'log', description: 'error & warning counts', enabled: true })

  // ── Conditional: @adonisjs/lucid ─────────────────────────────────
  const hasLucid = await isInstalled('@adonisjs/lucid')

  if (hasLucid) {
    const { dbPoolCollector } = await import('./db_pool_collector.js')
    const { appCollector } = await import('./app_collector.js')

    collectors.push(dbPoolCollector())
    collectors.push(appCollector())
  }

  entries.push({
    name: 'db-pool',
    description: 'connection pool stats',
    enabled: hasLucid,
    reason: hasLucid ? 'found @adonisjs/lucid' : 'install @adonisjs/lucid to enable',
  })

  entries.push({
    name: 'app',
    description: 'app-level DB metrics',
    enabled: hasLucid,
    reason: hasLucid ? 'found @adonisjs/lucid' : 'install @adonisjs/lucid to enable',
  })

  // ── Conditional: @adonisjs/redis ─────────────────────────────────
  const hasRedis = await isInstalled('@adonisjs/redis')

  if (hasRedis) {
    const { redisCollector } = await import('./redis_collector.js')
    collectors.push(redisCollector())
  }

  entries.push({
    name: 'redis',
    description: 'connections, commands, memory',
    enabled: hasRedis,
    reason: hasRedis ? 'found @adonisjs/redis' : 'install @adonisjs/redis to enable',
  })

  // ── Conditional: bullmq ──────────────────────────────────────────
  const hasBullMQ = await isInstalled('bullmq')

  if (hasBullMQ) {
    const { queueCollector } = await import('./queue_collector.js')
    collectors.push(
      queueCollector({
        queueName: 'default',
        connection: { host: '127.0.0.1', port: 6379 },
      })
    )
  }

  entries.push({
    name: 'queue',
    description: 'jobs, wait time, throughput',
    enabled: hasBullMQ,
    reason: hasBullMQ ? 'found bullmq' : 'install bullmq to enable',
  })

  // ── Rich boot log ────────────────────────────────────────────────
  const total = entries.length
  const active = entries.filter((e) => e.enabled).length
  const maxNameLen = Math.max(...entries.map((e) => e.name.length))

  const lines = entries.map((entry) => {
    const paddedName = entry.name.padEnd(maxNameLen)

    if (entry.enabled) {
      const mark = green('✔')
      const detail = entry.reason
        ? dim('— ' + entry.reason)
        : dim('— ' + entry.description)
      return `  ${mark} ${bold(paddedName)}  ${detail}`
    }

    const mark = dim('✗')
    const detail = dim('— ' + (entry.reason ?? entry.description))
    return `  ${mark} ${dim(paddedName)}  ${detail}`
  })

  log.block('collectors (auto-detected):', lines)

  return { collectors, total, active }
}
