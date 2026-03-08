import { appImport } from '../utils/app_import.js'
import { log, dim, green, bold } from '../utils/logger.js'

import type { MetricCollector } from './collector.js'

async function isInstalled(pkg: string): Promise<boolean> {
  try {
    await appImport(pkg)
    return true
  } catch {
    return false
  }
}

interface CollectorEntry {
  name: string
  description: string
  enabled: boolean
  reason?: string
}

export interface AutoDetectResult {
  collectors: MetricCollector[]
  total: number
  active: number
}

/** Push an optional collector entry with auto-generated reason. */
function pushOptionalEntry(
  entries: CollectorEntry[],
  opts: { name: string; description: string; enabled: boolean; pkg: string }
): void {
  entries.push({
    name: opts.name,
    description: opts.description,
    enabled: opts.enabled,
    reason: opts.enabled ? `found ${opts.pkg}` : `install ${opts.pkg} to enable`,
  })
}

async function registerCoreCollectors(
  collectors: MetricCollector[],
  entries: CollectorEntry[]
): Promise<void> {
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
}

async function registerOptionalCollectors(
  collectors: MetricCollector[],
  entries: CollectorEntry[]
): Promise<void> {
  const hasLucid = await isInstalled('@adonisjs/lucid')
  if (hasLucid) {
    const { dbPoolCollector } = await import('./db_pool_collector.js')
    const { appCollector } = await import('./app_collector.js')
    collectors.push(dbPoolCollector())
    collectors.push(appCollector())
  }
  pushOptionalEntry(entries, {
    name: 'db-pool',
    description: 'connection pool stats',
    enabled: hasLucid,
    pkg: '@adonisjs/lucid',
  })
  pushOptionalEntry(entries, {
    name: 'app',
    description: 'app-level DB metrics',
    enabled: hasLucid,
    pkg: '@adonisjs/lucid',
  })

  const hasRedis = await isInstalled('@adonisjs/redis')
  if (hasRedis) {
    const { redisCollector } = await import('./redis_collector.js')
    collectors.push(redisCollector())
  }
  pushOptionalEntry(entries, {
    name: 'redis',
    description: 'connections, commands, memory',
    enabled: hasRedis,
    pkg: '@adonisjs/redis',
  })

  const hasBullMQ = await isInstalled('bullmq')
  if (hasBullMQ) {
    const { queueCollector } = await import('./queue_collector.js')
    collectors.push(
      queueCollector({ queueName: 'default', connection: { host: '127.0.0.1', port: 6379 } })
    )
  }
  pushOptionalEntry(entries, {
    name: 'queue',
    description: 'jobs, wait time, throughput',
    enabled: hasBullMQ,
    pkg: 'bullmq',
  })
}

function printBootLog(entries: CollectorEntry[]): void {
  const maxNameLen = Math.max(...entries.map((e) => e.name.length))
  const lines = entries.map((entry) => {
    const paddedName = entry.name.padEnd(maxNameLen)
    if (entry.enabled) {
      const detail = entry.reason ? dim('— ' + entry.reason) : dim('— ' + entry.description)
      return `  ${green('✔')} ${bold(paddedName)}  ${detail}`
    }
    const detail = dim('— ' + (entry.reason ?? entry.description))
    return `  ${dim('✗')} ${dim(paddedName)}  ${detail}`
  })
  log.block('collectors (auto-detected):', lines)
}

export async function autoDetectCollectors(): Promise<AutoDetectResult> {
  const collectors: MetricCollector[] = []
  const entries: CollectorEntry[] = []

  await registerCoreCollectors(collectors, entries)
  await registerOptionalCollectors(collectors, entries)

  printBootLog(entries)
  return { collectors, total: entries.length, active: entries.filter((e) => e.enabled).length }
}
