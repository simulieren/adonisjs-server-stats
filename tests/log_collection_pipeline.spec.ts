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
// Group 1: recordLog -> flush -> SQLite (basic pipeline)
// ============================================================================

test.group('Log collection | recordLog to SQLite', (group) => {
  let tmpDir: string
  let store: DashboardStore

  group.each.setup(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ss-log-pipeline-'))
    store = new DashboardStore(makeConfig('test.sqlite'))
    await store.start(null, createMockEmitter() as unknown as import('../src/debug/types.js').Emitter, tmpDir)
  })

  group.each.teardown(async () => {
    await store.stop()
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  })

  test('recordLog queues entry and flush writes it to server_stats_logs', async ({ assert }) => {
    store.recordLog({ level: 30, msg: 'test message', time: Date.now() })
    await flush(store)
    const db = store.getDb()!
    const rows = await db('server_stats_logs').select('*')
    assert.lengthOf(rows, 1)
    // level 30 without levelName -> stored as String(30) = '30'
    assert.equal(rows[0].level, '30')
    assert.equal(rows[0].message, 'test message')
  })

  test('multiple logs are flushed in a single batch', async ({ assert }) => {
    for (let i = 0; i < 10; i++) {
      store.recordLog({ level: 30, msg: `log ${i}`, time: Date.now() })
    }
    await flush(store)
    const db = store.getDb()!
    const count = await db('server_stats_logs').count('* as cnt').first()
    assert.equal(count.cnt, 10)
  })

  test('log level is stored as numeric string when levelName is absent', async ({ assert }) => {
    store.recordLog({ level: 50, msg: 'error!', time: Date.now() })
    store.recordLog({ level: 40, msg: 'warning!', time: Date.now() })
    store.recordLog({ level: 20, msg: 'debug!', time: Date.now() })
    await flush(store)
    const db = store.getDb()!
    const rows = await db('server_stats_logs').orderBy('id', 'asc')
    assert.equal(rows[0].level, '50')
    assert.equal(rows[1].level, '40')
    assert.equal(rows[2].level, '20')
  })

  test('log with levelName stores the name', async ({ assert }) => {
    store.recordLog({ level: 30, levelName: 'info', msg: 'named level', time: Date.now() })
    await flush(store)
    const db = store.getDb()!
    const row = await db('server_stats_logs').first()
    assert.equal(row.level, 'info')
  })
})

// ============================================================================
// Group 2: request_id capture (snake_case vs camelCase)
// ============================================================================

test.group('Log collection | request_id capture', (group) => {
  let tmpDir: string
  let store: DashboardStore

  group.each.setup(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ss-log-reqid-'))
    store = new DashboardStore(makeConfig('test.sqlite'))
    await store.start(null, createMockEmitter() as unknown as import('../src/debug/types.js').Emitter, tmpDir)
  })

  group.each.teardown(async () => {
    await store.stop()
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  })

  test('captures request_id from snake_case field (Pino format)', async ({ assert }) => {
    store.recordLog({ level: 30, msg: 'pino log', request_id: 'req-123', time: Date.now() })
    await flush(store)
    const db = store.getDb()!
    const row = await db('server_stats_logs').first()
    assert.equal(row.request_id, 'req-123')
  })

  test('captures requestId from camelCase field', async ({ assert }) => {
    store.recordLog({ level: 30, msg: 'camel log', requestId: 'req-456', time: Date.now() })
    await flush(store)
    const db = store.getDb()!
    const row = await db('server_stats_logs').first()
    assert.equal(row.request_id, 'req-456')
  })

  test('captures x-request-id header field', async ({ assert }) => {
    store.recordLog({
      level: 30,
      msg: 'header log',
      'x-request-id': 'req-789',
      time: Date.now(),
    })
    await flush(store)
    const db = store.getDb()!
    const row = await db('server_stats_logs').first()
    assert.equal(row.request_id, 'req-789')
  })

  test('snake_case request_id takes priority over camelCase', async ({ assert }) => {
    store.recordLog({
      level: 30,
      msg: 'priority',
      request_id: 'snake',
      requestId: 'camel',
      time: Date.now(),
    })
    await flush(store)
    const db = store.getDb()!
    const row = await db('server_stats_logs').first()
    assert.equal(row.request_id, 'snake')
  })

  test('null request_id when no request ID field present', async ({ assert }) => {
    store.recordLog({ level: 30, msg: 'no req id', time: Date.now() })
    await flush(store)
    const db = store.getDb()!
    const row = await db('server_stats_logs').first()
    assert.isNull(row.request_id)
  })
})

// ============================================================================
// Group 3: data field stores full JSON
// ============================================================================

test.group('Log collection | data field stores full entry JSON', (group) => {
  let tmpDir: string
  let store: DashboardStore

  group.each.setup(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ss-log-data-'))
    store = new DashboardStore(makeConfig('test.sqlite'))
    await store.start(null, createMockEmitter() as unknown as import('../src/debug/types.js').Emitter, tmpDir)
  })

  group.each.teardown(async () => {
    await store.stop()
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  })

  test('full log entry is stored as JSON in data column', async ({ assert }) => {
    const entry = {
      level: 30,
      msg: 'with extra',
      time: Date.now(),
      userId: 42,
      action: 'login',
    }
    store.recordLog(entry)
    await flush(store)
    const db = store.getDb()!
    const row = await db('server_stats_logs').first()
    const data = JSON.parse(row.data)
    assert.equal(data.userId, 42)
    assert.equal(data.action, 'login')
    assert.equal(data.msg, 'with extra')
  })
})

// ============================================================================
// Group 4: flush recovery after errors
// ============================================================================

test.group('Log collection | flush recovery', (group) => {
  let tmpDir: string
  let store: DashboardStore

  group.each.setup(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ss-log-recovery-'))
    store = new DashboardStore(makeConfig('test.sqlite'))
    await store.start(null, createMockEmitter() as unknown as import('../src/debug/types.js').Emitter, tmpDir)
  })

  group.each.teardown(async () => {
    await store.stop()
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  })

  test('flush recovers after BigInt serialization error and writes subsequent logs', async ({
    assert,
  }) => {
    // BigInt causes JSON.stringify to throw during data preparation
    store.recordLog({ level: 30, msg: 'bad entry', value: BigInt(999)  } as unknown as Record<string, unknown>)
    await flush(store)

    // Now queue a normal entry -- this should work if flushing recovered
    store.recordLog({ level: 30, msg: 'good entry after bad', time: Date.now() })
    await flush(store)

    const db = store.getDb()!
    const rows = await db('server_stats_logs').select('*')
    // The bad entry's batch was lost but the good entry should be present
    assert.isAbove(rows.length, 0)
    assert.equal(rows[rows.length - 1].message, 'good entry after bad')
  })

  test('multiple consecutive errors dont permanently lock flushing', async ({ assert }) => {
    // Three consecutive bad batches
    store.recordLog({ level: 30, msg: 'bad1', value: BigInt(1)  } as unknown as Record<string, unknown>)
    await flush(store)
    store.recordLog({ level: 30, msg: 'bad2', value: BigInt(2)  } as unknown as Record<string, unknown>)
    await flush(store)
    store.recordLog({ level: 30, msg: 'bad3', value: BigInt(3)  } as unknown as Record<string, unknown>)
    await flush(store)

    // Then a good entry
    store.recordLog({ level: 30, msg: 'recovery', time: Date.now() })
    await flush(store)

    const db = store.getDb()!
    const rows = await db('server_stats_logs').where('message', 'recovery')
    assert.lengthOf(rows, 1)
  })
})

// ============================================================================
// Group 5: End-to-end request + log correlation
// ============================================================================

test.group('Log collection | end-to-end request-log correlation', (group) => {
  let tmpDir: string
  let store: DashboardStore

  group.each.setup(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ss-log-e2e-'))
    store = new DashboardStore(makeConfig('test.sqlite'))
    await store.start(null, createMockEmitter() as unknown as import('../src/debug/types.js').Emitter, tmpDir)
  })

  group.each.teardown(async () => {
    await store.stop()
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  })

  test('logs recorded with matching request_id are correlated with request detail', async ({
    assert,
  }) => {
    // 1. Record logs with a specific request_id
    store.recordLog({
      level: 30,
      levelName: 'info',
      msg: 'Processing request',
      request_id: 'req-e2e-001',
      time: Date.now(),
    })
    store.recordLog({
      level: 30,
      levelName: 'info',
      msg: 'DB query done',
      request_id: 'req-e2e-001',
      time: Date.now(),
    })
    await flush(store)

    // 2. Persist a request with matching httpRequestId
    store.persistRequest({
      method: 'GET',
      url: '/api/e2e-test',
      statusCode: 200,
      duration: 45,
      queries: [],
      trace: null,
      httpRequestId: 'req-e2e-001',
    })
    await flush(store)

    // 3. Fetch request detail -- should include correlated logs
    const db = store.getDb()!
    const request = await db('server_stats_requests').where('url', '/api/e2e-test').first()
    const detail = await store.getRequestDetail(request.id)

    assert.isNotNull(detail)
    assert.isArray(detail!.logs)
    assert.lengthOf(detail!.logs as unknown[], 2)
    const messages = (detail!.logs as Record<string, unknown>[]).map((l) => l.message)
    assert.include(messages, 'Processing request')
    assert.include(messages, 'DB query done')
  })

  test('logs from different requests are not mixed up', async ({ assert }) => {
    store.recordLog({
      level: 30,
      msg: 'Request A log',
      request_id: 'req-a',
      time: Date.now(),
    })
    store.recordLog({
      level: 30,
      msg: 'Request B log',
      request_id: 'req-b',
      time: Date.now(),
    })
    await flush(store)

    store.persistRequest({
      method: 'GET',
      url: '/api/a',
      statusCode: 200,
      duration: 10,
      queries: [],
      trace: null,
      httpRequestId: 'req-a',
    })
    store.persistRequest({
      method: 'POST',
      url: '/api/b',
      statusCode: 201,
      duration: 20,
      queries: [],
      trace: null,
      httpRequestId: 'req-b',
    })
    await flush(store)

    const db = store.getDb()!
    const reqA = await db('server_stats_requests').where('url', '/api/a').first()
    const reqB = await db('server_stats_requests').where('url', '/api/b').first()

    const detailA = await store.getRequestDetail(reqA.id)
    const detailB = await store.getRequestDetail(reqB.id)

    assert.lengthOf(detailA!.logs as unknown[], 1)
    assert.equal((detailA!.logs as Record<string, unknown>[])[0].message, 'Request A log')

    assert.lengthOf(detailB!.logs as unknown[], 1)
    assert.equal((detailB!.logs as Record<string, unknown>[])[0].message, 'Request B log')
  })

  test('request with trace includes correlated logs via getTraceDetail', async ({ assert }) => {
    store.recordLog({
      level: 40,
      levelName: 'warn',
      msg: 'Slow query warning',
      request_id: 'req-trace-e2e',
      time: Date.now(),
    })
    await flush(store)

    store.persistRequest({
      method: 'GET',
      url: '/api/traced-e2e',
      statusCode: 200,
      duration: 150,
      queries: [],
      trace: {
        method: 'GET',
        url: '/api/traced-e2e',
        statusCode: 200,
        totalDuration: 150,
        spanCount: 1,
        spans: [
          {
            id: 's1',
            label: 'handler',
            category: 'middleware',
            startOffset: 0,
            duration: 150,
            parentId: null,
          },
        ],
        warnings: ['Slow response'],
      },
      httpRequestId: 'req-trace-e2e',
    })
    await flush(store)

    const db = store.getDb()!
    const trace = await db('server_stats_traces').first()
    assert.isNotNull(trace)

    const detail = await store.getTraceDetail(trace.id)
    assert.isNotNull(detail)
    assert.isArray(detail!.logs)
    assert.lengthOf(detail!.logs as unknown[], 1)
    assert.equal((detail!.logs as Record<string, unknown>[])[0].message, 'Slow query warning')
  })
})

// ============================================================================
// Group 6: Queue behavior
// ============================================================================

test.group('Log collection | queue behavior', (group) => {
  let tmpDir: string
  let store: DashboardStore

  group.each.setup(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ss-log-queue-'))
    store = new DashboardStore(makeConfig('test.sqlite'))
    await store.start(null, createMockEmitter() as unknown as import('../src/debug/types.js').Emitter, tmpDir)
  })

  group.each.teardown(async () => {
    await store.stop()
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  })

  test('queue is drained after flush', async ({ assert }) => {
    store.recordLog({ level: 30, msg: 'entry 1', time: Date.now() })
    store.recordLog({ level: 30, msg: 'entry 2', time: Date.now() })
    await flush(store)

    // Flush again with no new entries -- should be a no-op
    await flush(store)

    const db = store.getDb()!
    const count = await db('server_stats_logs').count('* as cnt').first()
    assert.equal(count.cnt, 2) // still 2, not duplicated
  })

  test('high volume: 100 logs are all persisted', async ({ assert }) => {
    for (let i = 0; i < 100; i++) {
      store.recordLog({ level: 30, msg: `bulk log ${i}`, time: Date.now() })
    }
    await flush(store)

    const db = store.getDb()!
    const count = await db('server_stats_logs').count('* as cnt').first()
    assert.equal(count.cnt, 100)
  })
})
