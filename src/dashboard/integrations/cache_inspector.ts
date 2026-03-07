import type { ApplicationService } from '@adonisjs/core/types'

// ---------------------------------------------------------------------------
// Minimal Redis client interface
// ---------------------------------------------------------------------------

/** Minimal interface for the Redis client methods used by CacheInspector. */
interface RedisClient {
  ping(): Promise<string>
  info(section: string): Promise<string>
  dbsize(): Promise<number>
  scan(cursor: string, ...args: (string | number)[]): Promise<[string, string[]]>
  type(key: string): Promise<string>
  ttl(key: string): Promise<number>
  get(key: string): Promise<string | null>
  del(key: string): Promise<number>
  lrange(key: string, start: number, stop: number): Promise<string[]>
  smembers(key: string): Promise<string[]>
  zrange(key: string, start: number, stop: number, ...args: string[]): Promise<string[]>
  hgetall(key: string): Promise<Record<string, string>>
  xrange(key: string, start: string, end: string, ...args: (string | number)[]): Promise<unknown[]>
  call(...args: (string | number)[]): Promise<unknown>
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface CacheStats {
  /** Whether the Redis connection is alive. */
  connected: boolean

  /** Total keyspace hits. */
  hits: number

  /** Total keyspace misses. */
  misses: number

  /** Hit rate as a percentage (0-100). */
  hitRate: number

  /** Redis memory usage in bytes. */
  memoryUsedBytes: number

  /** Human-readable memory usage (e.g. "12.34 MB"). */
  memoryUsedHuman: string

  /** Number of connected clients. */
  connectedClients: number

  /** Total number of keys across all databases. */
  totalKeys: number
}

export interface CacheKeyEntry {
  /** The full key name. */
  key: string

  /** Redis data type (string, list, set, hash, zset, stream). */
  type: string

  /** TTL in seconds, or -1 if no expiry, or -2 if key does not exist. */
  ttl: number
}

export interface CacheKeyListResult {
  /** Keys matching the scan pattern. */
  keys: CacheKeyEntry[]

  /** Cursor for the next SCAN iteration, or '0' when complete. */
  cursor: string
}

export interface CacheKeyDetail {
  /** The full key name. */
  key: string

  /** The stored value (stringified). */
  value: string

  /** Redis data type. */
  type: string

  /** TTL in seconds, or -1 if no expiry. */
  ttl: number

  /** Approximate size in bytes (from MEMORY USAGE, if available). */
  sizeBytes: number | null
}

// ---------------------------------------------------------------------------
// CacheInspector
// ---------------------------------------------------------------------------

/**
 * Inspects Redis cache keys, values, and statistics.
 *
 * Designed for the full-page dashboard's Cache section.
 * All methods are safe to call even when Redis is unavailable --
 * they catch errors and return sensible defaults.
 */
export class CacheInspector {
  constructor(private redis: RedisClient) {}

  /**
   * Detect whether `@adonisjs/cache` or `@adonisjs/redis` is available
   * in the application container.
   */
  static async isAvailable(app: ApplicationService): Promise<boolean> {
    try {
      await app.container.make('redis')
      return true
    } catch {
      return false
    }
  }

  /**
   * Get high-level cache / Redis statistics.
   */
  async getStats(): Promise<CacheStats> {
    const defaults: CacheStats = {
      connected: false,
      hits: 0,
      misses: 0,
      hitRate: 0,
      memoryUsedBytes: 0,
      memoryUsedHuman: '0 B',
      connectedClients: 0,
      totalKeys: 0,
    }

    try {
      const pong = await this.redis.ping()
      if (pong !== 'PONG') return defaults

      const [memoryInfo, statsInfo, serverInfo, dbSize] = await Promise.all([
        this.redis.info('memory') as Promise<string>,
        this.redis.info('stats') as Promise<string>,
        this.redis.info('clients') as Promise<string>,
        this.redis.dbsize() as Promise<number>,
      ])

      const memParsed = parseRedisInfo(memoryInfo)
      const statsParsed = parseRedisInfo(statsInfo)
      const clientsParsed = parseRedisInfo(serverInfo)

      const memoryUsedBytes = safeInt(memParsed['used_memory'])
      const memoryUsedHuman = memParsed['used_memory_human'] ?? formatBytes(memoryUsedBytes)
      const connectedClients = safeInt(
        clientsParsed['connected_clients'] ?? memParsed['connected_clients'] ?? '0'
      )
      const hits = safeInt(statsParsed['keyspace_hits'])
      const misses = safeInt(statsParsed['keyspace_misses'])
      const total = hits + misses
      const hitRate = total > 0 ? (hits / total) * 100 : 0

      return {
        connected: true,
        hits,
        misses,
        hitRate,
        memoryUsedBytes,
        memoryUsedHuman,
        connectedClients,
        totalKeys: typeof dbSize === 'number' ? dbSize : 0,
      }
    } catch {
      return defaults
    }
  }

  /**
   * List keys using Redis SCAN (cursor-based, non-blocking).
   *
   * @param pattern  Glob pattern for key matching (default `'*'`).
   * @param cursor   SCAN cursor from a previous call (default `'0'`).
   * @param count    Hint for how many keys to return per call (default `100`).
   */
  async listKeys(pattern = '*', cursor = '0', count = 100): Promise<CacheKeyListResult> {
    try {
      const [nextCursor, rawKeys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', count)

      const keys: CacheKeyEntry[] = await Promise.all(
        (rawKeys as string[]).map(async (key: string) => {
          const [type, ttl] = await Promise.all([
            this.redis.type(key) as Promise<string>,
            this.redis.ttl(key) as Promise<number>,
          ])
          return { key, type, ttl }
        })
      )

      return { keys, cursor: String(nextCursor) }
    } catch {
      return { keys: [], cursor: '0' }
    }
  }

  /**
   * Get full details for a single cache key.
   */
  async getKey(key: string): Promise<CacheKeyDetail | null> {
    try {
      const type = (await this.redis.type(key)) as string
      if (type === 'none') return null

      const ttl = (await this.redis.ttl(key)) as number
      const value = await this.getValueByType(key, type)

      let sizeBytes: number | null = null
      try {
        sizeBytes = (await this.redis.call('MEMORY', 'USAGE', key)) as number | null
      } catch {
        // MEMORY USAGE may not be available on older Redis versions
      }

      return { key, value, type, ttl, sizeBytes }
    } catch {
      return null
    }
  }

  /**
   * Delete a cache key.
   *
   * @returns `true` if the key was deleted, `false` otherwise.
   */
  async deleteKey(key: string): Promise<boolean> {
    try {
      const count = (await this.redis.del(key)) as number
      return count > 0
    } catch {
      return false
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Read a key's value using the appropriate Redis command for its type.
   */
  private async getValueByType(key: string, type: string): Promise<string> {
    try {
      switch (type) {
        case 'string': {
          const val = await this.redis.get(key)
          return val ?? ''
        }
        case 'list': {
          const items = await this.redis.lrange(key, 0, 99)
          return JSON.stringify(items)
        }
        case 'set': {
          const members = await this.redis.smembers(key)
          return JSON.stringify(members)
        }
        case 'zset': {
          const entries = await this.redis.zrange(key, 0, 99, 'WITHSCORES')
          return JSON.stringify(entries)
        }
        case 'hash': {
          const hash = await this.redis.hgetall(key)
          return JSON.stringify(hash)
        }
        case 'stream': {
          const messages = await this.redis.xrange(key, '-', '+', 'COUNT', 100)
          return JSON.stringify(messages)
        }
        default:
          return `(unsupported type: ${type})`
      }
    } catch {
      return '(error reading value)'
    }
  }
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

/**
 * Parse a Redis INFO response string into a key-value record.
 */
function parseRedisInfo(info: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of info.split('\r\n')) {
    const idx = line.indexOf(':')
    if (idx > 0) {
      result[line.slice(0, idx)] = line.slice(idx + 1)
    }
  }
  return result
}

/**
 * Safely parse a string to an integer, returning 0 on failure.
 */
function safeInt(value: string | undefined): number {
  if (!value) return 0
  const n = Number.parseInt(value, 10)
  return Number.isNaN(n) ? 0 : n
}

/**
 * Format bytes into a human-readable string.
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(2)} ${units[i]}`
}
