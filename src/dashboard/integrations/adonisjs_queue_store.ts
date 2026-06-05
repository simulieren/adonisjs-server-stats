import { appImport } from '../../utils/app_import.js'
import type {
  QueueJobSummary,
  QueueJobDetail,
  QueueJobListResult,
} from './queue_inspector.js'

// ---------------------------------------------------------------------------
// Local structural interfaces for @boringnode/queue / @adonisjs/queue
//
// We duck-type rather than import their types because @adonisjs/queue and
// @boringnode/queue are not in this package's devDeps.  All shapes are
// derived from the verified ground-truth in queue-ground-truth.md and the
// installed build under …/node_modules/@boringnode/queue/build.
// ---------------------------------------------------------------------------

/** JobStatus as stored in the queue_jobs table / Redis hashes. */
type BoringJobStatus = 'pending' | 'active' | 'delayed' | 'completed' | 'failed'

/** JobData — the JSON blob stored in queue_jobs.data / Redis ::data hash. */
interface BoringJobData {
  id: string
  name: string
  payload?: unknown
  attempts: number
  priority?: number
  nextRetryAt?: Date
  stalledCount?: number
  groupId?: string
  /** Unix ms timestamp set when the job was dispatched. */
  createdAt?: number
  /** Not persisted per-row; best-effort from static job options. */
  maxRetries?: number
  [key: string]: unknown
}

/** JobRecord — returned by adapter.getJob / stored in completed|failed hashes. */
interface BoringJobRecord {
  status: BoringJobStatus
  data: BoringJobData
  finishedAt?: number
  error?: string
}

/** Minimal Lucid db service interface. */
interface LucidDb {
  primaryConnectionName: string
  connection(name?: string): { getWriteClient(): unknown }
}

/** Minimal @adonisjs/redis manager interface. */
interface AdonisRedisManager {
  connection(name?: string): AdonisRedisConnection
}

/**
 * Minimal ioredis-compatible connection interface.
 * All methods present on a real ioredis client that we call.
 */
interface AdonisRedisConnection {
  zcard(key: string): Promise<number>
  hlen(key: string): Promise<number>
  zrange(key: string, start: number, stop: number): Promise<string[]>
  hget(key: string, field: string): Promise<string | null>
  hscan(key: string, cursor: string, countKeyword: string, count: string): Promise<[string, string[]]>
  hset(key: string, field: string, value: string): Promise<number>
  zadd(key: string, score: number, member: string): Promise<number>
  hdel(key: string, field: string): Promise<number>
  zrem(key: string, member: string): Promise<number>
  zscore(key: string, member: string): Promise<string | null>
  hkeys(key: string): Promise<string[]>
}

/** Minimal adapter interface (only what we need for driver detection). */
interface BoringAdapter {
  constructor: { name: string }
}

/** Minimal QueueManagerSingleton (only what we call). */
interface BoringQueueManager {
  use(name?: string): BoringAdapter
}

/** Config shape for @adonisjs/queue. */
interface QueueConfig {
  default?: string
  adapters?: Record<string, { connectionName?: string }>
  queues?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

/** Job counts aggregated across all configured queues. */
export interface QueueCounts {
  active: number
  waiting: number
  delayed: number
  completed: number
  failed: number
}

/** Thin interface implemented by both the database and redis readers. */
export interface QueueStoreReader {
  getCounts(): Promise<QueueCounts>
  listJobs(
    status: QueueJobSummary['status'] | 'all',
    page: number,
    perPage: number
  ): Promise<QueueJobListResult>
  getJob(id: string): Promise<QueueJobDetail | null>
  retryJob(id: string): Promise<boolean>
  getWorkerCount(): Promise<number>
}

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

/** Map a @boringnode JobStatus → dashboard status. */
function mapStatus(s: BoringJobStatus): QueueJobSummary['status'] {
  switch (s) {
    case 'pending':   return 'waiting'
    case 'active':    return 'active'
    case 'delayed':   return 'delayed'
    case 'completed': return 'completed'
    case 'failed':    return 'failed'
    default:          return 'waiting'
  }
}

/** Map a dashboard status → @boringnode store statuses for queries. */
function mapStatusToStore(s: QueueJobSummary['status'] | 'all'): BoringJobStatus[] {
  switch (s) {
    case 'waiting':   return ['pending']
    case 'active':    return ['active']
    case 'delayed':   return ['delayed']
    case 'completed': return ['completed']
    case 'failed':    return ['failed']
    case 'paused':    return []  // no paused concept in @boringnode/queue
    case 'all':
    default:
      return ['pending', 'active', 'delayed', 'completed', 'failed']
  }
}

// ---------------------------------------------------------------------------
// Named export: JobRecord → QueueJobSummary mapper (unit-testable without store)
// ---------------------------------------------------------------------------

/**
 * Map a @boringnode `JobRecord` (plus optional DB `acquired_at` timestamp) to
 * the `QueueJobSummary` shape used by the dashboard.
 *
 * Known gaps (no per-row data; documented inline):
 *   - `progress`: always 0 — @boringnode/queue does not persist per-row progress.
 *   - `returnValue`: always null — not stored in the queue table/hash.
 *   - `maxAttempts`: best-effort from `data.maxRetries`; falls back to `attempts`.
 *   - `stackTrace`: collapsed to `[record.error]`; no real stack trace in store.
 *
 * @param record       The raw job record from the store.
 * @param acquiredAtMs Unix-ms timestamp from DB `acquired_at` column, or null.
 */
export function mapJobRecordToSummary(
  record: BoringJobRecord,
  acquiredAtMs: number | null
): QueueJobSummary {
  const { data } = record
  const processedAt = acquiredAtMs
  const finishedAt = record.finishedAt ?? null
  const createdAt = data.createdAt ?? 0
  const duration = processedAt !== null && finishedAt !== null ? finishedAt - processedAt : null

  return {
    id: data.id,
    name: cleanJobName(data.name),
    status: mapStatus(record.status),
    data: (data.payload ?? null) as Record<string, unknown> | null,
    payload: (data.payload ?? null) as Record<string, unknown> | null,
    attempts: data.attempts ?? 0,
    // maxRetries is not persisted per row in @boringnode/queue; best effort
    maxAttempts: data.maxRetries ?? data.attempts ?? 1,
    // progress not persisted by @boringnode/queue
    progress: 0,
    failedReason: record.error ?? null,
    createdAt,
    timestamp: createdAt,
    processedAt,
    finishedAt,
    duration,
  }
}

/**
 * Extract a human-readable job name from the raw name stored by @boringnode/queue.
 * Mirrors the heuristic in QueueInspector for BullMQ jobs.
 */
function cleanJobName(raw: string): string {
  if (!raw || raw === '__default__') return 'default'
  // Strip file:// URLs down to the filename
  if (raw.startsWith('file://') || raw.startsWith('/')) {
    const filename = raw.split('/').pop() ?? raw
    const base = filename.replace(/\.(ts|js|mjs|cjs)$/, '')
    return base
      .split(/[-_]/)
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join('')
  }
  return raw
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Derive the list of queue names to aggregate from config. */
function resolveQueueNames(config: QueueConfig): string[] {
  const names = new Set<string>(['default'])
  if (config.queues) {
    for (const k of Object.keys(config.queues)) names.add(k)
  }
  return Array.from(names)
}

type KnexClient = (table: string) => KnexBuilder

interface KnexBuilder {
  whereIn(col: string, vals: unknown[]): this
  where(col: string, val: unknown): this
  andWhere(col: string, val: unknown): this
  select(...cols: string[]): this
  count(expr: string): this
  groupBy(col: string): this
  orderBy(col: string, dir: string): this
  limit(n: number): this
  offset(n: number): this
  first(): Promise<Record<string, unknown> | undefined>
  update(vals: Record<string, unknown>): Promise<number>
  then(onfulfilled: (rows: Array<Record<string, unknown>>) => unknown): Promise<unknown>
  [Symbol.toPrimitive]?: unknown
}

interface KnexClientWithRaw extends KnexClient {
  raw(sql: string, bindings: unknown[]): Promise<unknown>
}

// ---------------------------------------------------------------------------
// DatabaseStoreReader — reads queue_jobs via Lucid knex
// ---------------------------------------------------------------------------

const TABLE = 'queue_jobs'

class DatabaseStoreReader implements QueueStoreReader {
  readonly #db: LucidDb
  readonly #connectionName: string
  readonly #queues: string[]

  constructor(db: LucidDb, connectionName: string, queues: string[]) {
    this.#db = db
    this.#connectionName = connectionName
    this.#queues = queues
  }

  #knex(): KnexClientWithRaw {
    return this.#db.connection(this.#connectionName).getWriteClient() as KnexClientWithRaw
  }

  async getCounts(): Promise<QueueCounts> {
    const defaults: QueueCounts = { active: 0, waiting: 0, delayed: 0, completed: 0, failed: 0 }
    try {
      const rows = await (this.#knex()(TABLE)
        .whereIn('queue', this.#queues)
        .select('status')
        .count('* as count')
        .groupBy('status') as unknown as Promise<Array<{ status: string; count: string | number }>>)

      const counts = { ...defaults }
      for (const row of rows) {
        const n = Number(row.count)
        const ui = mapStatus(row.status as BoringJobStatus)
        if (ui === 'waiting')   counts.waiting   += n
        else if (ui === 'active')    counts.active    += n
        else if (ui === 'delayed')   counts.delayed   += n
        else if (ui === 'completed') counts.completed += n
        else if (ui === 'failed')    counts.failed    += n
      }
      return counts
    } catch {
      return defaults
    }
  }

  async listJobs(
    status: QueueJobSummary['status'] | 'all',
    page = 1,
    perPage = 25
  ): Promise<QueueJobListResult> {
    try {
      const storeStatuses = mapStatusToStore(status)
      if (storeStatuses.length === 0) return { jobs: [], total: 0 }

      const offset = (page - 1) * perPage
      const knex = this.#knex()

      const [rows, totalRows] = await Promise.all([
        (knex(TABLE)
          .whereIn('queue', this.#queues)
          .whereIn('status', storeStatuses)
          .orderBy('finished_at', 'desc')
          .limit(perPage)
          .offset(offset) as unknown as Promise<Array<Record<string, unknown>>>),
        (knex(TABLE)
          .whereIn('queue', this.#queues)
          .whereIn('status', storeStatuses)
          .count('* as count') as unknown as Promise<Array<{ count: string | number }>>),
      ])

      return {
        jobs: rows.map((row) => this.#rowToSummary(row)),
        total: Number(totalRows[0]?.count ?? 0),
      }
    } catch {
      return { jobs: [], total: 0 }
    }
  }

  async getJob(id: string): Promise<QueueJobDetail | null> {
    try {
      const row = await (this.#knex()(TABLE)
        .where('id', id)
        .first() as unknown as Promise<Record<string, unknown> | undefined>)
      if (!row) return null

      const summary = this.#rowToSummary(row)
      return {
        ...summary,
        stackTrace: row.error ? [String(row.error)] : [],
        returnValue: null,
        opts: {},
      }
    } catch {
      return null
    }
  }

  async retryJob(id: string): Promise<boolean> {
    try {
      const updated = await (this.#knex()(TABLE)
        .where('id', id)
        .andWhere('status', 'failed')
        .update({
          status: 'pending',
          worker_id: null,
          acquired_at: null,
          finished_at: null,
          error: null,
          score: Date.now(),
        }) as unknown as Promise<number>)
      return updated > 0
    } catch {
      return false
    }
  }

  async getWorkerCount(): Promise<number> {
    try {
      // COUNT(DISTINCT worker_id) is a reasonable proxy for active workers
      const result = await this.#knex().raw(
        `SELECT COUNT(DISTINCT worker_id) as count FROM ${TABLE} WHERE status = ? AND worker_id IS NOT NULL`,
        ['active']
      )
      // pg-style: result.rows; sqlite/mysql-style: result[0] array
      const rows = (result as unknown as { rows?: Array<{ count: string | number }> })?.rows
        ?? ((result as unknown as Array<unknown>)?.[0] as Array<{ count: string | number }>)
        ?? []
      return Number((rows as Array<{ count: string | number }>)[0]?.count ?? 0)
    } catch {
      return 0
    }
  }

  #rowToSummary(row: Record<string, unknown>): QueueJobSummary {
    let data: BoringJobData
    try {
      data = JSON.parse(String(row.data ?? '{}')) as BoringJobData
    } catch {
      data = { id: String(row.id ?? ''), name: 'unknown', attempts: 0 }
    }
    const record: BoringJobRecord = {
      status: (row.status as BoringJobStatus) ?? 'pending',
      data,
      finishedAt: row.finished_at != null ? Number(row.finished_at) : undefined,
      error: row.error != null ? String(row.error) : undefined,
    }
    return mapJobRecordToSummary(record, row.acquired_at != null ? Number(row.acquired_at) : null)
  }
}

// ---------------------------------------------------------------------------
// RedisStoreReader — reads jobs::{queue}::* keys via @adonisjs/redis
// ---------------------------------------------------------------------------

class RedisStoreReader implements QueueStoreReader {
  readonly #redis: AdonisRedisManager
  readonly #connectionName: string
  readonly #queues: string[]

  constructor(redis: AdonisRedisManager, connectionName: string, queues: string[]) {
    this.#redis = redis
    this.#connectionName = connectionName
    this.#queues = queues
  }

  #conn(): AdonisRedisConnection {
    return this.#redis.connection(this.#connectionName)
  }

  #key(queue: string, suffix: string): string {
    return `jobs::${queue}::${suffix}`
  }

  async getCounts(): Promise<QueueCounts> {
    const defaults: QueueCounts = { active: 0, waiting: 0, delayed: 0, completed: 0, failed: 0 }
    try {
      const conn = this.#conn()
      let active = 0, waiting = 0, delayed = 0, completed = 0, failed = 0

      await Promise.all(
        this.#queues.map(async (q) => {
          const [w, d, a, c, f] = await Promise.all([
            conn.zcard(this.#key(q, 'pending')),
            conn.zcard(this.#key(q, 'delayed')),
            conn.hlen(this.#key(q, 'active')),
            conn.hlen(this.#key(q, 'completed')),
            conn.hlen(this.#key(q, 'failed')),
          ])
          waiting   += w
          delayed   += d
          active    += a
          completed += c
          failed    += f
        })
      )

      return { active, waiting, delayed, completed, failed }
    } catch {
      return defaults
    }
  }

  async listJobs(
    status: QueueJobSummary['status'] | 'all',
    page = 1,
    perPage = 25
  ): Promise<QueueJobListResult> {
    try {
      const storeStatuses = mapStatusToStore(status)
      if (storeStatuses.length === 0) return { jobs: [], total: 0 }

      const conn = this.#conn()
      const allJobs: QueueJobSummary[] = []

      for (const q of this.#queues) {
        for (const ss of storeStatuses) {
          const jobs = await this.#listByStatus(conn, q, ss)
          allJobs.push(...jobs)
        }
      }

      // Sort newest-first then paginate in-memory (Redis has no ORDER BY)
      allJobs.sort((a, b) => b.createdAt - a.createdAt)
      const start = (page - 1) * perPage
      return { jobs: allJobs.slice(start, start + perPage), total: allJobs.length }
    } catch {
      return { jobs: [], total: 0 }
    }
  }

  async getJob(id: string): Promise<QueueJobDetail | null> {
    try {
      const conn = this.#conn()
      for (const q of this.#queues) {
        // Try completed / failed hashes first — they contain full JobRecord JSON
        for (const suffix of ['completed', 'failed'] as const) {
          const raw = await conn.hget(this.#key(q, suffix), id)
          if (raw) {
            try {
              const record = JSON.parse(raw) as BoringJobRecord
              return {
                ...mapJobRecordToSummary(record, null),
                stackTrace: record.error ? [record.error] : [],
                returnValue: null,
                opts: {},
              }
            } catch {
              // malformed — try next
            }
          }
        }
        // Fall back to ::data hash (pending / delayed / active)
        const raw = await conn.hget(this.#key(q, 'data'), id)
        if (raw) {
          try {
            const data = JSON.parse(raw) as BoringJobData
            const bStatus = await this.#detectStatus(conn, q, id)
            return {
              ...mapJobRecordToSummary({ status: bStatus, data }, null),
              stackTrace: [],
              returnValue: null,
              opts: {},
            }
          } catch {
            // malformed
          }
        }
      }
      return null
    } catch {
      return null
    }
  }

  async retryJob(id: string): Promise<boolean> {
    try {
      const conn = this.#conn()
      for (const q of this.#queues) {
        const raw = await conn.hget(this.#key(q, 'failed'), id)
        if (!raw) continue
        try {
          const record = JSON.parse(raw) as BoringJobRecord
          // Restore data entry and move back to pending ZSET
          await conn.hset(this.#key(q, 'data'), id, JSON.stringify(record.data))
          await conn.zadd(this.#key(q, 'pending'), Date.now(), id)
          await conn.hdel(this.#key(q, 'failed'), id)
          // Remove from optional failed index ZSET if it exists
          try { await conn.zrem(this.#key(q, 'failed::index'), id) } catch { /* optional */ }
          return true
        } catch {
          // continue to next queue
        }
      }
      return false
    } catch {
      return false
    }
  }

  async getWorkerCount(): Promise<number> {
    try {
      // Best-effort proxy: count of entries in ::active hashes
      const conn = this.#conn()
      let total = 0
      for (const q of this.#queues) {
        total += await conn.hlen(this.#key(q, 'active'))
      }
      return total
    } catch {
      return 0
    }
  }

  /** Enumerate jobs in one queue+status bucket. */
  async #listByStatus(
    conn: AdonisRedisConnection,
    queue: string,
    status: BoringJobStatus
  ): Promise<QueueJobSummary[]> {
    if (status === 'pending' || status === 'delayed') {
      // Stored as a ZSET; members are job IDs; full data is in ::data hash
      const setKey = this.#key(queue, status === 'pending' ? 'pending' : 'delayed')
      const ids = await conn.zrange(setKey, 0, -1)
      const jobs: QueueJobSummary[] = []
      for (const id of ids) {
        const raw = await conn.hget(this.#key(queue, 'data'), id)
        if (!raw) continue
        try {
          const data = JSON.parse(raw) as BoringJobData
          jobs.push(mapJobRecordToSummary({ status, data }, null))
        } catch { /* skip malformed */ }
      }
      return jobs
    }

    if (status === 'active') {
      // Stored as a HASH (field=jobId, value=workerId); data is in ::data hash
      const ids = await this.#hkeys(conn, this.#key(queue, 'active'))
      const jobs: QueueJobSummary[] = []
      for (const id of ids) {
        const raw = await conn.hget(this.#key(queue, 'data'), id)
        if (!raw) continue
        try {
          const data = JSON.parse(raw) as BoringJobData
          jobs.push(mapJobRecordToSummary({ status: 'active', data }, null))
        } catch { /* skip */ }
      }
      return jobs
    }

    // completed | failed — HASH; values are full JobRecord JSON
    return this.#scanHashAsRecords(conn, this.#key(queue, status))
  }

  /** HSCAN a hash and parse each value as a JobRecord, returning summaries. */
  async #scanHashAsRecords(
    conn: AdonisRedisConnection,
    key: string
  ): Promise<QueueJobSummary[]> {
    const jobs: QueueJobSummary[] = []
    let cursor = '0'
    do {
      const [nextCursor, entries] = await conn.hscan(key, cursor, 'COUNT', '100')
      cursor = nextCursor
      // entries: [field0, value0, field1, value1, …]
      for (let i = 1; i < entries.length; i += 2) {
        try {
          const record = JSON.parse(entries[i]) as BoringJobRecord
          jobs.push(mapJobRecordToSummary(record, null))
        } catch { /* skip */ }
      }
    } while (cursor !== '0')
    return jobs
  }

  /**
   * Return all field names of a Redis hash.
   * Uses native HKEYS if available; falls back to HSCAN for compatibility.
   */
  async #hkeys(conn: AdonisRedisConnection, key: string): Promise<string[]> {
    if (typeof conn.hkeys === 'function') {
      try { return await conn.hkeys(key) } catch { /* fallback */ }
    }
    const keys: string[] = []
    let cursor = '0'
    do {
      const [nextCursor, entries] = await conn.hscan(key, cursor, 'COUNT', '100')
      cursor = nextCursor
      for (let i = 0; i < entries.length; i += 2) keys.push(entries[i])
    } while (cursor !== '0')
    return keys
  }

  /** Detect the current bucket of a job ID within a queue. */
  async #detectStatus(
    conn: AdonisRedisConnection,
    queue: string,
    id: string
  ): Promise<BoringJobStatus> {
    const inActive = await conn.hget(this.#key(queue, 'active'), id)
    if (inActive !== null) return 'active'
    const score = await conn.zscore(this.#key(queue, 'pending'), id)
    if (score !== null) return 'pending'
    const dscore = await conn.zscore(this.#key(queue, 'delayed'), id)
    if (dscore !== null) return 'delayed'
    return 'pending'
  }
}

// ---------------------------------------------------------------------------
// Driver detection
// ---------------------------------------------------------------------------

function detectDriver(queueManager: BoringQueueManager, config: QueueConfig): 'database' | 'redis' | 'unknown' {
  try {
    const name = queueManager.use()?.constructor?.name ?? ''
    if (name === 'KnexAdapter')  return 'database'
    if (name === 'RedisAdapter') return 'redis'
  } catch {
    // fall through
  }
  // Regex fallback on the default adapter key
  const key = config.default ?? Object.keys(config.adapters ?? {})[0] ?? ''
  if (/redis/i.test(key))                return 'redis'
  if (/database|sql|knex/i.test(key))    return 'database'
  return 'unknown'
}

// ---------------------------------------------------------------------------
// Factory inputs & exported factory
// ---------------------------------------------------------------------------

/** Pre-resolved services, accepted by the factory for both call paths. */
export interface QueueStoreReaderServices {
  queueManager: BoringQueueManager
  config: QueueConfig
  /** Lucid db instance — required for the database driver. */
  db?: LucidDb
  /** AdonisJS redis manager — required for the redis driver. */
  redis?: AdonisRedisManager
  /** Override the database/redis connection name derived from config. */
  connectionName?: string
}

/**
 * Build a {@link QueueStoreReader} from already-resolved services.
 *
 * Both the inspector path (`app.container.make`) and the collector path
 * (`appImport`) resolve their own services and pass them here.
 * Returns a safe-defaults no-op reader if driver detection fails or the
 * required service (db or redis) is absent.
 */
export function buildQueueStoreReader(services: QueueStoreReaderServices): QueueStoreReader {
  const { queueManager, config, db, redis, connectionName } = services
  const queues = resolveQueueNames(config)
  const driver = detectDriver(queueManager, config)

  if (driver === 'database') {
    if (!db) return noopReader()
    const cfgConn = config.adapters?.[config.default ?? '']?.connectionName
    const connName = connectionName ?? cfgConn ?? db.primaryConnectionName
    return new DatabaseStoreReader(db, connName, queues)
  }

  if (driver === 'redis') {
    if (!redis) return noopReader()
    const cfgConn = config.adapters?.[config.default ?? '']?.connectionName
    const connName = connectionName ?? cfgConn ?? 'main'
    return new RedisStoreReader(redis, connName, queues)
  }

  return noopReader()
}

// ---------------------------------------------------------------------------
// Convenience resolver — from an Application instance
// ---------------------------------------------------------------------------

/** Minimal shape of the AdonisJS Application instance we depend on. */
interface ApplicationLike {
  config: { get(key: string): unknown }
  container: { make(binding: string): Promise<unknown> }
}

/**
 * Resolve services from an AdonisJS Application instance and build a store reader.
 *
 * This is the canonical resolver: the queue config lives in the app's
 * `config/queue.ts` (there is no package-level config export), so it can only
 * be read from `app.config.get('queue')`. Both the inspector and collector
 * paths funnel through here.
 *
 * Returns null if @adonisjs/queue is not registered (e.g. wrong environment).
 */
export async function resolveFromApplication(
  app: ApplicationLike
): Promise<QueueStoreReader | null> {
  try {
    const queueManager = (await app.container.make('queue.manager')) as BoringQueueManager
    const config = (app.config.get('queue') ?? {}) as QueueConfig

    // db and redis are optional; ignore failures
    const [dbResult, redisResult] = await Promise.allSettled([
      app.container.make('lucid.db') as Promise<LucidDb>,
      app.container.make('redis') as Promise<AdonisRedisManager>,
    ])

    return buildQueueStoreReader({
      queueManager,
      config,
      db:    dbResult.status    === 'fulfilled' ? dbResult.value    : undefined,
      redis: redisResult.status === 'fulfilled' ? redisResult.value : undefined,
    })
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Convenience resolver — inspector path (ApplicationService)
// ---------------------------------------------------------------------------

/**
 * Resolve services for the inspector path.
 *
 * Accepts either a full Application-like object (with `config` + `container`)
 * or a bare container (legacy). When given a bare container it resolves the
 * application via the `app` binding to read the queue config.
 *
 * Returns null if @adonisjs/queue is not registered (e.g. wrong environment).
 */
export async function resolveFromContainer(
  appOrContainer:
    | ApplicationLike
    | { make(binding: string): Promise<unknown> }
): Promise<QueueStoreReader | null> {
  // Full application instance (has its own config) — preferred path.
  if ('config' in appOrContainer && 'container' in appOrContainer) {
    return resolveFromApplication(appOrContainer)
  }

  // Bare container — recover the application from the `app` binding.
  try {
    const app = (await appOrContainer.make('app')) as ApplicationLike
    return resolveFromApplication({ config: app.config, container: appOrContainer })
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Convenience resolver — collector path (appImport)
// ---------------------------------------------------------------------------

/**
 * Resolve services via `appImport` and build a store reader.
 *
 * Designed for the collector path where no IoC container reference is held.
 * Resolves the running Application via `@adonisjs/core/services/app` (the same
 * service the official `@adonisjs/queue` package uses), then reads the queue
 * config and services from it.
 *
 * Returns null if @adonisjs/queue is not installed in the host application.
 */
export async function resolveFromAppImport(): Promise<QueueStoreReader | null> {
  try {
    const appMod = await appImport<{ default: ApplicationLike }>('@adonisjs/core/services/app')
    return await resolveFromApplication(appMod.default)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// No-op reader — safe defaults when driver is unknown or services are absent
// ---------------------------------------------------------------------------

function noopReader(): QueueStoreReader {
  const zero: QueueCounts = { active: 0, waiting: 0, delayed: 0, completed: 0, failed: 0 }
  return {
    async getCounts()               { return { ...zero } },
    async listJobs()                { return { jobs: [], total: 0 } },
    async getJob()                  { return null },
    async retryJob()                { return false },
    async getWorkerCount()          { return 0 },
  }
}
