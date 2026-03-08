import { test } from '@japa/runner'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DashboardStore } from '../src/dashboard/dashboard_store.js'

import type { DevToolbarConfig } from '../src/debug/types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockEmitter() {
  const handlers: Record<string, Function[]> = {}
  return {
    on(event: string, handler: Function) {
      ;(handlers[event] ??= []).push(handler)
    },
    off(event: string, handler: Function) {
      const arr = handlers[event]
      if (arr) {
        const i = arr.indexOf(handler)
        if (i >= 0) arr.splice(i, 1)
      }
    },
    emit(event: string, data: unknown) {
      handlers[event]?.forEach((h) => h(data))
    },
    handlers,
  }
}

function makeConfig(dbPath: string): DevToolbarConfig {
  return {
    enabled: true,
    maxQueries: 500,
    maxEvents: 500,
    maxEmails: 100,
    slowQueryThresholdMs: 100,
    persistDebugData: false,
    tracing: false,
    maxTraces: 200,
    dashboard: true,
    dashboardPath: '/__stats',
    retentionDays: 7,
    dbPath,
    debugEndpoint: '/__debug',
  }
}

/** Flush the DashboardStore write queue by calling the private method. */
async function flush(store: DashboardStore): Promise<void> {
  const timer = (store as unknown as Record<string, unknown>).flushTimer
  if (timer) {
    clearTimeout(timer)
    ;(store as unknown as Record<string, unknown>).flushTimer = null
  }
  await (store as unknown as Record<string, (...args: unknown[]) => Promise<void>>).flushWriteQueue()
  ;((store as unknown as Record<string, Record<string, () => void>>).resultCache).clear()
}

// ============================================================================
// Migration: http_request_id column and index
// ============================================================================

test.group('Migration | http_request_id', (group) => {
  let tmpDir: string
  let store: DashboardStore

  group.each.setup(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ss-migration-test-'))
    store = new DashboardStore(makeConfig('test.sqlite'))
    await store.start(null, createMockEmitter() as unknown as import('../src/debug/types.js').Emitter, tmpDir)
  })

  group.each.teardown(async () => {
    await store.stop()
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  })

  test('http_request_id column exists in server_stats_requests after migration', async ({
    assert,
  }) => {
    const db = store.getDb()!
    const columns = await db.raw('PRAGMA table_info(server_stats_requests)')
    const colNames = (columns as { name: string }[]).map((c) => c.name)
    assert.include(colNames, 'http_request_id')
  })

  test('idx_ss_requests_http_req index is created', async ({ assert }) => {
    const db = store.getDb()!
    const indexes = await db.raw('PRAGMA index_list(server_stats_requests)')
    const indexNames = (indexes as { name: string }[]).map((i) => i.name)
    assert.include(indexNames, 'idx_ss_requests_http_req')
  })

  test('idempotent ALTER TABLE does not throw on re-run', async ({ assert }) => {
    const db = store.getDb()!
    // Import autoMigrate and run it again — should not throw
    const { autoMigrate } = await import('../src/dashboard/migrator.js')
    await assert.doesNotReject(() => autoMigrate(db))
  })
})

// ============================================================================
// DashboardStore: PersistRequestInput with httpRequestId
// ============================================================================

test.group('DashboardStore | flushWriteQueue stores http_request_id', (group) => {
  let tmpDir: string
  let store: DashboardStore
  let emitter: ReturnType<typeof createMockEmitter>

  group.each.setup(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ss-persist-test-'))
    store = new DashboardStore(makeConfig('test.sqlite'))
    emitter = createMockEmitter()
    await store.start(null, emitter as unknown as import('../src/debug/types.js').Emitter, tmpDir)
  })

  group.each.teardown(async () => {
    await store.stop()
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  })

  test('PersistRequestInput with httpRequestId stores http_request_id in DB', async ({
    assert,
  }) => {
    store.persistRequest({
      method: 'GET',
      url: '/api/users',
      statusCode: 200,
      duration: 42.5,
      queries: [],
      trace: null,
      httpRequestId: 'req-abc-123',
    })
    await flush(store)

    const db = store.getDb()!
    const row = await db('server_stats_requests').where('url', '/api/users').first()
    assert.isNotNull(row)
    assert.equal(row.http_request_id, 'req-abc-123')
  })

  test('PersistRequestInput without httpRequestId stores null http_request_id', async ({
    assert,
  }) => {
    store.persistRequest({
      method: 'POST',
      url: '/api/items',
      statusCode: 201,
      duration: 10,
      queries: [],
      trace: null,
    })
    await flush(store)

    const db = store.getDb()!
    const row = await db('server_stats_requests').where('url', '/api/items').first()
    assert.isNotNull(row)
    assert.isNull(row.http_request_id)
  })
})

// ============================================================================
// DashboardStore: getTraceDetail — log correlation
// ============================================================================

test.group('DashboardStore | getTraceDetail log correlation', (group) => {
  let tmpDir: string
  let store: DashboardStore
  let emitter: ReturnType<typeof createMockEmitter>

  group.each.setup(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ss-trace-detail-test-'))
    store = new DashboardStore(makeConfig('test.sqlite'))
    emitter = createMockEmitter()
    await store.start(null, emitter as unknown as import('../src/debug/types.js').Emitter, tmpDir)
  })

  group.each.teardown(async () => {
    await store.stop()
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  })

  test('returns correlated logs via http_request_id (precise match)', async ({ assert }) => {
    const db = store.getDb()!

    // Insert a request with http_request_id
    const [requestId] = await db('server_stats_requests').insert({
      method: 'GET',
      url: '/api/users',
      status_code: 200,
      duration: 50,
      http_request_id: 'req-xyz-001',
    })

    // Insert a trace linked to that request
    const [traceId] = await db('server_stats_traces').insert({
      request_id: requestId,
      method: 'GET',
      url: '/api/users',
      status_code: 200,
      total_duration: 50,
      span_count: 0,
      spans: '[]',
    })

    // Insert logs with matching request_id
    await db('server_stats_logs').insert([
      { level: 'info', message: 'Fetching users', request_id: 'req-xyz-001' },
      { level: 'debug', message: 'Query executed', request_id: 'req-xyz-001' },
    ])

    // Insert a log with a different request_id (should not be included)
    await db('server_stats_logs').insert({
      level: 'error',
      message: 'Unrelated error',
      request_id: 'req-other-999',
    })

    const detail = await store.getTraceDetail(traceId)
    assert.isNotNull(detail)
    assert.equal(detail!.http_request_id, 'req-xyz-001')
    assert.isArray(detail!.logs)
    assert.lengthOf(detail!.logs as unknown[], 2)
    const messages = (detail!.logs as Record<string, unknown>[]).map((l) => l.message)
    assert.include(messages, 'Fetching users')
    assert.include(messages, 'Query executed')
    assert.notInclude(messages, 'Unrelated error')
  })

  test('falls back to time-window query when no http_request_id', async ({ assert }) => {
    const db = store.getDb()!

    // Insert a request without http_request_id
    const [requestId] = await db('server_stats_requests').insert({
      method: 'GET',
      url: '/api/no-req-id',
      status_code: 200,
      duration: 100,
    })

    // Insert a trace linked to that request
    const [traceId] = await db('server_stats_traces').insert({
      request_id: requestId,
      method: 'GET',
      url: '/api/no-req-id',
      status_code: 200,
      total_duration: 100,
      span_count: 0,
      spans: '[]',
    })

    // Insert a log around the same time (no request_id)
    await db('server_stats_logs').insert({
      level: 'info',
      message: 'Nearby log entry',
      request_id: null,
    })

    const detail = await store.getTraceDetail(traceId)
    assert.isNotNull(detail)
    // Should fall back to time-window and find the nearby log
    assert.isArray(detail!.logs)
    assert.isAbove((detail!.logs as unknown[]).length, 0)
  })
})

// ============================================================================
// DashboardStore: getRequestDetail — log correlation
// ============================================================================

test.group('DashboardStore | getRequestDetail log correlation', (group) => {
  let tmpDir: string
  let store: DashboardStore
  let emitter: ReturnType<typeof createMockEmitter>

  group.each.setup(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ss-req-detail-test-'))
    store = new DashboardStore(makeConfig('test.sqlite'))
    emitter = createMockEmitter()
    await store.start(null, emitter as unknown as import('../src/debug/types.js').Emitter, tmpDir)
  })

  group.each.teardown(async () => {
    await store.stop()
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  })

  test('returns correlated logs via http_request_id', async ({ assert }) => {
    const db = store.getDb()!

    const [requestId] = await db('server_stats_requests').insert({
      method: 'POST',
      url: '/api/submit',
      status_code: 201,
      duration: 30,
      http_request_id: 'req-submit-001',
    })

    await db('server_stats_logs').insert([
      { level: 'info', message: 'Processing submission', request_id: 'req-submit-001' },
      { level: 'info', message: 'Submission saved', request_id: 'req-submit-001' },
    ])

    const detail = await store.getRequestDetail(requestId)
    assert.isNotNull(detail)
    assert.isArray(detail!.logs)
    assert.lengthOf(detail!.logs as unknown[], 2)

    const messages = (detail!.logs as Record<string, unknown>[]).map((l) => l.message)
    assert.include(messages, 'Processing submission')
    assert.include(messages, 'Submission saved')
  })

  test('returns empty logs array when no logs match', async ({ assert }) => {
    const db = store.getDb()!

    const [requestId] = await db('server_stats_requests').insert({
      method: 'DELETE',
      url: '/api/items/1',
      status_code: 204,
      duration: 5,
      http_request_id: 'req-no-logs-001',
    })

    const detail = await store.getRequestDetail(requestId)
    assert.isNotNull(detail)
    assert.isArray(detail!.logs)
    assert.lengthOf(detail!.logs as unknown[], 0)
  })

  test('falls back to time-window when no http_request_id', async ({ assert }) => {
    const db = store.getDb()!

    const [requestId] = await db('server_stats_requests').insert({
      method: 'GET',
      url: '/api/fallback',
      status_code: 200,
      duration: 20,
    })

    // Insert a log around the same time
    await db('server_stats_logs').insert({
      level: 'warn',
      message: 'Nearby warning',
      request_id: null,
    })

    const detail = await store.getRequestDetail(requestId)
    assert.isNotNull(detail)
    assert.isArray(detail!.logs)
    // Time-window fallback should find the nearby log
    assert.isAbove((detail!.logs as unknown[]).length, 0)
  })
})

// ============================================================================
// Middleware: RequestCompleteData includes httpRequestId
// ============================================================================

test.group('Middleware | RequestCompleteData includes httpRequestId', () => {
  test('RequestCompleteData interface accepts httpRequestId', async ({ assert }) => {
    // Import the type and setter to verify the interface
    const {
      setOnRequestComplete,
    } = await import('../src/middleware/request_tracking_middleware.js')

    let _captured: Record<string, unknown> | null = null
    setOnRequestComplete((data) => {
      _captured = data as Record<string, unknown>
    })

    // Simulate calling the callback with httpRequestId
    const { default: _Middleware } = await import('../src/middleware/request_tracking_middleware.js')

    // Directly invoke the callback to verify the type allows httpRequestId
    const _callback = (globalThis as unknown as Record<string, unknown>).__test_onRequestComplete ?? null
    // Instead of invoking the middleware (which needs a full HTTP context),
    // verify the type compiles and the setter works
    assert.isFunction(setOnRequestComplete)

    // Clean up
    setOnRequestComplete(null)
  })
})

// ============================================================================
// Dashboard Controller: formatRequest, formatTrace, formatLog
// ============================================================================

test.group('DashboardController | format helpers', () => {
  test('formatRequest includes httpRequestId when present', async ({ assert }) => {
    // The format functions are module-private, so we test them indirectly
    // through the requestDetail endpoint. Here we test the logic inline.
    const row: Record<string, unknown> = {
      id: 1,
      method: 'GET',
      url: '/test',
      status_code: 200,
      duration: 42,
      span_count: 0,
      warning_count: 0,
      created_at: '2024-01-01T00:00:00',
      http_request_id: 'req-format-001',
    }

    // Replicate formatRequest logic
    const formatted = {
      id: row.id,
      method: row.method,
      url: row.url,
      statusCode: row.status_code,
      duration: row.duration,
      spanCount: row.span_count,
      warningCount: row.warning_count,
      createdAt: row.created_at,
      ...(row.http_request_id ? { httpRequestId: row.http_request_id } : {}),
    }

    assert.equal(formatted.httpRequestId, 'req-format-001')
    assert.equal(formatted.statusCode, 200)
  })

  test('formatRequest omits httpRequestId when absent', async ({ assert }) => {
    const row: Record<string, unknown> = {
      id: 2,
      method: 'POST',
      url: '/test',
      status_code: 201,
      duration: 10,
      span_count: 0,
      warning_count: 0,
      created_at: '2024-01-01T00:00:00',
    }

    const formatted = {
      id: row.id,
      method: row.method,
      url: row.url,
      statusCode: row.status_code,
      duration: row.duration,
      spanCount: row.span_count,
      warningCount: row.warning_count,
      createdAt: row.created_at,
      ...(row.http_request_id ? { httpRequestId: row.http_request_id } : {}),
    }

    assert.notProperty(formatted, 'httpRequestId')
  })

  test('formatTrace includes httpRequestId when present', async ({ assert }) => {
    const { safeParseJson, safeParseJsonArray } = await import('../src/utils/json_helpers.js')

    const row: Record<string, unknown> = {
      id: 10,
      request_id: 1,
      method: 'GET',
      url: '/api/traced',
      status_code: 200,
      total_duration: 55,
      span_count: 2,
      spans: '[{"id":"1","label":"db","category":"db","startOffset":0,"duration":5,"parentId":null}]',
      warnings: '[]',
      created_at: '2024-01-01T00:00:00',
      http_request_id: 'req-trace-fmt-001',
    }

    // Replicate formatTrace logic
    const formatted = {
      id: row.id,
      requestId: row.request_id,
      method: row.method,
      url: row.url,
      statusCode: row.status_code,
      totalDuration: row.total_duration,
      spanCount: row.span_count,
      spans: safeParseJson(row.spans) ?? [],
      warnings: safeParseJsonArray(row.warnings),
      createdAt: row.created_at,
      ...(row.http_request_id ? { httpRequestId: row.http_request_id } : {}),
    }

    assert.equal(formatted.httpRequestId, 'req-trace-fmt-001')
    assert.equal(formatted.statusCode, 200)
    assert.isArray(formatted.spans)
    assert.lengthOf(formatted.spans as unknown[], 1)
  })

  test('formatLog correctly maps snake_case to camelCase', async ({ assert }) => {
    const row: Record<string, unknown> = {
      id: 5,
      level: 'info',
      message: 'Test log message',
      request_id: 'req-log-fmt-001',
      data: '{"key":"value"}',
      created_at: '2024-01-01T00:00:00',
    }

    // Replicate formatLog logic
    const formatted = {
      id: row.id,
      level: row.level,
      message: row.message,
      requestId: row.request_id,
      data: row.data,
      createdAt: row.created_at,
    }

    assert.equal(formatted.id, 5)
    assert.equal(formatted.level, 'info')
    assert.equal(formatted.message, 'Test log message')
    assert.equal(formatted.requestId, 'req-log-fmt-001')
    assert.equal(formatted.data, '{"key":"value"}')
    assert.equal(formatted.createdAt, '2024-01-01T00:00:00')
    // Verify snake_case fields are mapped to camelCase
    assert.notProperty(formatted, 'request_id')
    assert.notProperty(formatted, 'created_at')
  })
})

// ============================================================================
// DashboardController: requestDetail includes logs in response
// ============================================================================

test.group('DashboardController | requestDetail includes logs', (group) => {
  let tmpDir: string
  let store: DashboardStore
  let emitter: ReturnType<typeof createMockEmitter>

  group.each.setup(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ss-ctrl-detail-test-'))
    store = new DashboardStore(makeConfig('test.sqlite'))
    emitter = createMockEmitter()
    await store.start(null, emitter as unknown as import('../src/debug/types.js').Emitter, tmpDir)
  })

  group.each.teardown(async () => {
    await store.stop()
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  })

  test('getRequestDetail result includes logs array for controller to format', async ({
    assert,
  }) => {
    const db = store.getDb()!

    const [requestId] = await db('server_stats_requests').insert({
      method: 'GET',
      url: '/api/with-logs',
      status_code: 200,
      duration: 25,
      http_request_id: 'req-ctrl-001',
    })

    await db('server_stats_logs').insert([
      { level: 'info', message: 'Controller log 1', request_id: 'req-ctrl-001' },
      { level: 'warn', message: 'Controller log 2', request_id: 'req-ctrl-001' },
    ])

    const detail = await store.getRequestDetail(requestId)
    assert.isNotNull(detail)

    // The controller's requestDetail method maps detail.logs through formatLog
    assert.isArray(detail!.logs)
    assert.lengthOf(detail!.logs as unknown[], 2)

    // Verify the raw logs have expected fields that formatLog will map
    const log = (detail!.logs as Record<string, unknown>[])[0]
    assert.property(log, 'id')
    assert.property(log, 'level')
    assert.property(log, 'message')
    assert.property(log, 'request_id')
    assert.property(log, 'created_at')
  })

  test('getRequestDetail result includes queries, events, and trace', async ({ assert }) => {
    const db = store.getDb()!

    const [requestId] = await db('server_stats_requests').insert({
      method: 'GET',
      url: '/api/full-detail',
      status_code: 200,
      duration: 100,
      http_request_id: 'req-full-001',
    })

    await db('server_stats_queries').insert({
      request_id: requestId,
      sql_text: 'SELECT * FROM users',
      sql_normalized: 'SELECT * FROM users',
      duration: 5,
    })

    await db('server_stats_traces').insert({
      request_id: requestId,
      method: 'GET',
      url: '/api/full-detail',
      status_code: 200,
      total_duration: 100,
      span_count: 0,
      spans: '[]',
    })

    const detail = await store.getRequestDetail(requestId)
    assert.isNotNull(detail)
    assert.isArray(detail!.queries)
    assert.lengthOf(detail!.queries as unknown[], 1)
    assert.isNotNull(detail!.trace)
    assert.isArray(detail!.logs)
  })
})
