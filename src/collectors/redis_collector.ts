import type { MetricCollector } from './collector.js'

export function redisCollector(): MetricCollector {
  return {
    name: 'redis',

    async collect() {
      const defaults = {
        redisOk: false,
        redisMemoryUsedMb: 0,
        redisConnectedClients: 0,
        redisKeysCount: 0,
        redisHitRate: 0,
      }

      try {
        const { default: redis } = await import('@adonisjs/redis/services/main')
        const pong = await redis.ping()
        if (pong !== 'PONG') return defaults

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
      } catch {
        return defaults
      }
    },
  }
}
