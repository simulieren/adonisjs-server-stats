import { log, dim, bold } from '../utils/logger.js'

import type { MetricCollector } from './collector.js'

let warnedNotInstalled = false
let warnedPingFailed = false
let warnedConnectionError = false

/**
 * Monitors Redis health, memory, connections, keys, and cache hit rate.
 *
 * Uses the AdonisJS Redis service to send `PING`, `INFO`, and `DBSIZE`
 * commands. Returns safe defaults if Redis is unavailable.
 *
 * **Metrics produced:**
 * - `redisOk` -- `true` if PING returned PONG
 * - `redisMemoryUsedMb` -- server memory usage (MB)
 * - `redisConnectedClients` -- connected client count
 * - `redisKeysCount` -- total keys across all databases
 * - `redisHitRate` -- cache hit rate (%)
 *
 * **Peer dependencies:** `@adonisjs/redis`
 */
export function redisCollector(): MetricCollector {
  return {
    name: 'redis',
    label: 'redis — memory, clients, keys, hit rate',

    async collect() {
      const defaults = {
        redisOk: false,
        redisMemoryUsedMb: 0,
        redisConnectedClients: 0,
        redisKeysCount: 0,
        redisHitRate: 0,
      }

      let redis: Awaited<typeof import('@adonisjs/redis/services/main')>['default']

      try {
        const mod = await import('@adonisjs/redis/services/main')
        redis = mod.default
      } catch {
        if (!warnedNotInstalled) {
          warnedNotInstalled = true
          log.block(`Redis collector ${bold('skipped')} — @adonisjs/redis is not installed`, [
            dim('Redis metrics will return defaults until the package is added.'),
            `Run ${bold('node ace add @adonisjs/redis')} to install it.`,
          ])
        }
        return defaults
      }

      try {
        const pong = await redis.ping()
        if (pong !== 'PONG') {
          if (!warnedPingFailed) {
            warnedPingFailed = true
            log.block(
              `Redis collector ${bold('unhealthy')} — PING returned ${bold(String(pong))} instead of PONG`,
              [
                dim('Redis may be down or misconfigured.'),
                `Check your connection settings in ${bold('config/redis.ts')}.`,
              ]
            )
          }
          return defaults
        }

        const [memoryInfo, statsInfo, dbSize] = await Promise.all([
          redis.info('memory') as Promise<string>,
          redis.info('stats') as Promise<string>,
          redis.dbsize() as Promise<number>,
        ])

        const parseInfo = (info: string): Record<string, string> => {
          const result: Record<string, string> = {}
          for (const line of info.split('\r\n')) {
            const idx = line.indexOf(':')
            if (idx > 0) {
              result[line.slice(0, idx)] = line.slice(idx + 1)
            }
          }
          return result
        }

        const memParsed = parseInfo(memoryInfo)
        const statsParsed = parseInfo(statsInfo)

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
      } catch (error) {
        if (!warnedConnectionError) {
          warnedConnectionError = true
          const message = error instanceof Error ? error.message : String(error)
          log.block(`Redis collector ${bold('error')} — failed to communicate with Redis`, [
            dim(message),
            `Make sure Redis is running and accessible. Check ${bold('config/redis.ts')} for connection details.`,
          ])
        }
        return defaults
      }
    },
  }
}
