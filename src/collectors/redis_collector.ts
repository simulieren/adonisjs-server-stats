import { appImport } from '../utils/app_import.js'
import { log, dim, bold } from '../utils/logger.js'

import type { MetricCollector } from './collector.js'

let warnedNotInstalled = false
let warnedPingFailed = false
let warnedConnectionError = false

/** Default metrics returned when Redis is unavailable. */
const REDIS_DEFAULTS = {
  redisOk: false,
  redisMemoryUsedMb: 0,
  redisConnectedClients: 0,
  redisKeysCount: 0,
  redisHitRate: 0,
}

/** Parse a Redis INFO section into key-value pairs. */
export function parseRedisInfo(info: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of info.split('\r\n')) {
    const idx = line.indexOf(':')
    if (idx > 0) {
      result[line.slice(0, idx)] = line.slice(idx + 1)
    }
  }
  return result
}

/** Compute metrics from parsed Redis INFO sections + DBSIZE. */
export function computeRedisMetrics(
  memParsed: Record<string, string>,
  statsParsed: Record<string, string>,
  dbSize: unknown
) {
  const usedMemoryBytes = Number.parseInt(memParsed['used_memory'] ?? '0', 10)
  const connectedClients = Number.parseInt(
    memParsed['connected_clients'] ?? statsParsed['connected_clients'] ?? '0',
    10
  )
  const hits = Number.parseInt(statsParsed['keyspace_hits'] ?? '0', 10)
  const misses = Number.parseInt(statsParsed['keyspace_misses'] ?? '0', 10)
  const total = hits + misses
  const hitRate = total > 0 ? (hits / total) * 100 : 0

  return {
    redisOk: true,
    redisMemoryUsedMb: usedMemoryBytes / (1024 * 1024),
    redisConnectedClients: connectedClients,
    redisKeysCount: typeof dbSize === 'number' ? dbSize : 0,
    redisHitRate: hitRate,
  }
}

/** Import Redis service, returning null if unavailable. */
async function importRedis() {
  try {
    const mod = await appImport<typeof import('@adonisjs/redis/services/main')>(
      '@adonisjs/redis/services/main'
    )
    return mod.default
  } catch {
    if (!warnedNotInstalled) {
      warnedNotInstalled = true
      log.block(`Redis collector ${bold('skipped')} — @adonisjs/redis is not installed`, [
        dim('Redis metrics will return defaults until the package is added.'),
        `Run ${bold('node ace add @adonisjs/redis')} to install it.`,
      ])
    }
    return null
  }
}

/** Warn once when PING fails. */
function warnPingFailed(pong: unknown): void {
  if (warnedPingFailed) return
  warnedPingFailed = true
  log.block(
    `Redis collector ${bold('unhealthy')} — PING returned ${bold(String(pong))} instead of PONG`,
    [
      dim('Redis may be down or misconfigured.'),
      `Check your connection settings in ${bold('config/redis.ts')}.`,
    ]
  )
}

/**
 * Monitors Redis health, memory, connections, keys, and cache hit rate.
 *
 * **Peer dependencies:** `@adonisjs/redis`
 */
export function redisCollector(): MetricCollector {
  return {
    name: 'redis',
    label: 'redis — memory, clients, keys, hit rate',

    getConfig() {
      return {}
    },

    async collect() {
      const redis = await importRedis()
      if (!redis) return REDIS_DEFAULTS

      try {
        const pong = await redis.ping()
        if (pong !== 'PONG') {
          warnPingFailed(pong)
          return REDIS_DEFAULTS
        }

        const [memoryInfo, statsInfo, dbSize] = await Promise.all([
          redis.info('memory') as Promise<string>,
          redis.info('stats') as Promise<string>,
          redis.dbsize() as Promise<number>,
        ])

        return computeRedisMetrics(parseRedisInfo(memoryInfo), parseRedisInfo(statsInfo), dbSize)
      } catch (error) {
        if (!warnedConnectionError) {
          warnedConnectionError = true
          const message = error instanceof Error ? error.message : String(error)
          log.block(`Redis collector ${bold('error')} — failed to communicate with Redis`, [
            dim(message),
            `Make sure Redis is running and accessible. Check ${bold('config/redis.ts')} for connection details.`,
          ])
        }
        return REDIS_DEFAULTS
      }
    },
  }
}
