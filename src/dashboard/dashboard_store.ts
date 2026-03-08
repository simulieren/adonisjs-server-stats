import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import { log } from '../utils/logger.js'
import { ChartAggregator } from './chart_aggregator.js'
import { CoalesceCache } from './coalesce_cache.js'
import { buildEmailRecordFromEvent } from './email_event_builder.js'
import { executeExplain } from './explain_query.js'
import { FlushManager } from './flush_manager.js'
import { createKnexConnection, applyPragmas } from './knex_factory.js'
import { autoMigrate, runRetentionCleanup } from './migrator.js'
import {
  fetchOverviewMetrics,
  fetchChartData,
  fetchOverviewWidgets,
  fetchSparklineData,
} from './overview_store_queries.js'
import {
  queryRequests,
  queryQueries,
  queryQueriesGrouped,
  queryEvents,
  queryEmails,
  queryEmailHtml,
  queryLogs,
  queryTraces,
  queryTraceDetail,
  queryRequestDetail,
} from './read_queries.js'
import { fetchSavedFilters, insertSavedFilter, removeSavedFilter } from './saved_filter_queries.js'
import { fetchStorageStats } from './storage_stats.js'

import type { DevToolbarConfig, EventRecord, EmailRecord } from '../debug/types.js'
import type { StorageStatsResult } from './storage_stats.js'
import type { Knex } from 'knex'

export type {
  RequestInput,
  PersistRequestInput,
  RequestFilters,
  QueryFilters,
  EventFilters,
  EmailFilters,
  LogFilters,
  TraceFilters,
  PaginatedResult,
  PaginateOptions,
} from './dashboard_types.js'

import type {
  EventEmitter,
  PersistRequestInput,
  RequestFilters,
  QueryFilters,
  EventFilters,
  EmailFilters,
  LogFilters,
  TraceFilters,
  PaginatedResult,
} from './dashboard_types.js'

const EMPTY_PAGINATED = (p: number, pp: number) => ({
  data: [],
  total: 0,
  page: p,
  perPage: pp,
  lastPage: 0,
})

const EMPTY_WIDGETS = {
  topEvents: [] as { eventName: string; count: number }[],
  emailActivity: { sent: 0, queued: 0, failed: 0 },
  logLevelBreakdown: { error: 0, warn: 0, info: 0, debug: 0 },
  statusDistribution: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 },
  slowestQueries: [] as { sqlNormalized: string; avgDuration: number; count: number }[],
}

export class DashboardStore {
  private db: Knex | null = null
  private emitter: EventEmitter | null = null
  private config: DevToolbarConfig
  private dashboardPath: string
  private retentionTimer: ReturnType<typeof setInterval> | null = null
  private chartAggregator: ChartAggregator | null = null
  private handlers: { event: string; fn: (...args: unknown[]) => void }[] = []
  private dbFilePath: string = ''
  private lastCleanupAt: number | null = null
  private cache = new CoalesceCache()
  private cachedStorageStats: { data: unknown; cachedAt: number } | null = null
  private flushMgr = new FlushManager(() => this.db)

  private static readonly STORAGE_TTL = 10_000

  constructor(config: DevToolbarConfig) {
    this.config = config
    this.dashboardPath = config.dashboardPath
  }

  async start(_lucidDb: unknown, emitter: EventEmitter | null, appRoot: string): Promise<void> {
    this.emitter = emitter
    this.dbFilePath = appRoot + '/' + this.config.dbPath
    await mkdir(dirname(this.dbFilePath), { recursive: true })
    this.db = await createKnexConnection(this.dbFilePath)
    await applyPragmas(this.db)
    await this.initMigrations()
    this.chartAggregator = new ChartAggregator(this.db)
    this.chartAggregator.start()
    this.wireEventListeners()
    log.info('dashboard: store initialized')
  }

  private async initMigrations(): Promise<void> {
    log.info('dashboard: running migrations...')
    await autoMigrate(this.db!)
    log.info('dashboard: migrations complete')
    const cleanup = async () => {
      try {
        if (this.db) {
          await runRetentionCleanup(this.db, this.config.retentionDays)
          this.lastCleanupAt = Date.now()
          log.info('dashboard: retention cleanup complete')
        }
      } catch (err) {
        log.warn('dashboard: retention cleanup failed — ' + (err as Error)?.message)
      }
    }
    setTimeout(() => cleanup(), 30_000)
    this.retentionTimer = setInterval(() => cleanup(), 3_600_000)
  }

  async stop(): Promise<void> {
    await this.flushMgr.stop()
    if (this.retentionTimer) {
      clearInterval(this.retentionTimer)
      this.retentionTimer = null
    }
    this.chartAggregator?.stop()
    this.removeListeners()
    if (this.db && typeof this.db.destroy === 'function') {
      try {
        await this.db.destroy()
      } catch (err) {
        log.warn('dashboard: error closing SQLite — ' + (err as Error)?.message)
      }
    }
    this.db = null
  }

  private removeListeners(): void {
    if (this.emitter) {
      for (const h of this.handlers) {
        if (typeof this.emitter.off === 'function') this.emitter.off(h.event, h.fn)
      }
    }
    this.handlers = []
  }

  getDb(): Knex | null {
    return this.db
  }
  isReady(): boolean {
    return this.db !== null
  }

  async getStorageStats(): Promise<StorageStatsResult> {
    const empty: StorageStatsResult = {
      ready: false,
      dbPath: this.config.dbPath,
      fileSizeMb: 0,
      walSizeMb: 0,
      retentionDays: this.config.retentionDays,
      tables: [],
      lastCleanupAt: null,
    }
    if (!this.db) return empty
    if (
      this.cachedStorageStats &&
      Date.now() - this.cachedStorageStats.cachedAt < DashboardStore.STORAGE_TTL
    )
      return this.cachedStorageStats.data as StorageStatsResult
    return fetchStorageStats({
      db: this.db,
      cache: this.cache,
      dbFilePath: this.dbFilePath,
      dbPath: this.config.dbPath,
      retentionDays: this.config.retentionDays,
      lastCleanupAt: this.lastCleanupAt,
      onResult: (stats) => {
        this.cachedStorageStats = { data: stats, cachedAt: Date.now() }
      },
    })
  }

  persistRequest(input: PersistRequestInput): Promise<number | null> {
    this.flushMgr.persistRequest(input, this.dashboardPath)
    return Promise.resolve(null)
  }

  queueEvents(requestIndex: number, events: EventRecord[]): void {
    this.flushMgr.queueEvents(requestIndex, events)
  }

  recordLog(entry: Record<string, unknown>): void {
    this.flushMgr.recordLog(entry)
  }

  recordEmail(record: EmailRecord): void {
    this.flushMgr.recordEmail(record)
  }

  async flushWriteQueue(): Promise<void> {
    return this.flushMgr.flush()
  }

  private get readCtx() {
    return { db: this.db!, cache: this.cache }
  }

  async getRequests(
    p = 1,
    pp = 50,
    f?: RequestFilters
  ): Promise<PaginatedResult<Record<string, unknown>>> {
    return this.db ? queryRequests(this.readCtx, p, pp, f) : EMPTY_PAGINATED(p, pp)
  }

  async getQueries(
    p = 1,
    pp = 50,
    f?: QueryFilters
  ): Promise<PaginatedResult<Record<string, unknown>>> {
    return this.db ? queryQueries(this.readCtx, p, pp, f) : EMPTY_PAGINATED(p, pp)
  }

  async getQueriesGrouped(
    limit = 200,
    sort = 'total_duration',
    search?: string
  ): Promise<Record<string, unknown>[]> {
    return this.db ? queryQueriesGrouped(this.readCtx, { limit, sort, search }) : []
  }

  async getEvents(
    p = 1,
    pp = 50,
    f?: EventFilters
  ): Promise<PaginatedResult<Record<string, unknown>>> {
    return this.db ? queryEvents(this.readCtx, p, pp, f) : EMPTY_PAGINATED(p, pp)
  }

  async getEmails(
    p = 1,
    pp = 50,
    f?: EmailFilters,
    excludeBody = false
  ): Promise<PaginatedResult<Record<string, unknown>>> {
    return this.db
      ? queryEmails(this.readCtx, { page: p, perPage: pp, filters: f, excludeBody })
      : EMPTY_PAGINATED(p, pp)
  }

  async getEmailHtml(id: number): Promise<string | null> {
    return this.db ? queryEmailHtml(this.readCtx, id) : null
  }

  async getLogs(p = 1, pp = 50, f?: LogFilters): Promise<PaginatedResult<Record<string, unknown>>> {
    return this.db ? queryLogs(this.readCtx, p, pp, f) : EMPTY_PAGINATED(p, pp)
  }

  async getTraces(
    p = 1,
    pp = 50,
    f?: TraceFilters
  ): Promise<PaginatedResult<Record<string, unknown>>> {
    return this.db ? queryTraces(this.readCtx, p, pp, f) : EMPTY_PAGINATED(p, pp)
  }

  async getTraceDetail(id: number): Promise<Record<string, unknown> | null> {
    return this.db ? queryTraceDetail(this.readCtx, id) : null
  }

  async getRequestDetail(id: number): Promise<Record<string, unknown> | null> {
    return this.db ? queryRequestDetail(this.readCtx, id) : null
  }

  async getOverviewMetrics(range = '1h'): Promise<Record<string, unknown> | null> {
    return this.db ? fetchOverviewMetrics(this.db, this.cache, range) : null
  }

  async getChartData(range = '1h'): Promise<Record<string, unknown>[]> {
    return this.db ? fetchChartData(this.db, this.cache, range) : []
  }

  async getOverviewWidgets(range = '1h') {
    return this.db ? fetchOverviewWidgets(this.db, this.cache, range) : EMPTY_WIDGETS
  }

  async getSparklineData(range: string): Promise<Record<string, unknown>[]> {
    return this.db ? fetchSparklineData(this.db, this.cache, range) : []
  }

  async getSavedFilters(section?: string): Promise<Record<string, unknown>[]> {
    return this.db ? fetchSavedFilters(this.db, this.cache, section) : []
  }

  async createSavedFilter(
    name: string,
    section: string,
    filterConfig: Record<string, unknown>
  ): Promise<Record<string, unknown> | null> {
    return this.db ? insertSavedFilter(this.db, name, section, filterConfig) : null
  }

  async deleteSavedFilter(id: number): Promise<boolean> {
    return this.db ? removeSavedFilter(this.db, id) : false
  }

  async runExplain(queryId: number, appDb: unknown): Promise<Record<string, unknown> | null> {
    if (!this.db) return { error: 'Dashboard store not initialized' }
    return executeExplain(this.db, this.cache, queryId, appDb)
  }

  private wireEventListeners(): void {
    if (!this.emitter || typeof this.emitter.on !== 'function') {
      log.warn('dashboard: emitter not available — email collection disabled')
      return
    }
    const persist = (data: unknown, status: EmailRecord['status']) =>
      this.recordEmail(buildEmailRecordFromEvent(data, status))
    this.handlers = [
      { event: 'mail:sending', fn: (data: unknown) => persist(data, 'sending') },
      { event: 'mail:sent', fn: (data: unknown) => persist(data, 'sent') },
      { event: 'mail:queueing', fn: (data: unknown) => persist(data, 'queueing') },
      { event: 'mail:queued', fn: (data: unknown) => persist(data, 'queued') },
      { event: 'queued:mail:error', fn: (data: unknown) => persist(data, 'failed') },
    ]
    for (const h of this.handlers) this.emitter.on(h.event, h.fn)
    log.info(`dashboard: email listeners wired (${this.handlers.length} events)`)
  }
}
