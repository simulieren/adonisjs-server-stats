import { test } from '@japa/runner'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DashboardStore } from '../src/dashboard/dashboard_store.js'

import type { DevToolbarConfig } from '../src/debug/types.js'

// ---------------------------------------------------------------------------
// Helpers (same pattern as request_log_correlation.spec.ts)
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
  const timer = (store as any).flushTimer
  if (timer) {
    clearTimeout(timer)
    ;(store as any).flushTimer = null
  }
  await (store as any).flushWriteQueue()
  ;(store as any).cache.clearCache()
}

// ============================================================================
// Flush deadlock recovery
// ============================================================================

test.group('flush deadlock recovery', (group) => {
  let tmpDir: string
  let store: DashboardStore
  let emitter: ReturnType<typeof createMockEmitter>

  group.each.setup(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ss-flush-deadlock-test-'))
    store = new DashboardStore(makeConfig('test.sqlite'))
    emitter = createMockEmitter()
    await store.start(null, emitter as any, tmpDir)
  })

  group.each.teardown(async () => {
    await store.stop()
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  })

  test('flushing flag resets after data prep error', async ({ assert }) => {
    // Record a log entry with a BigInt value which will cause JSON.stringify
    // to throw "TypeError: Do not know how to serialize a BigInt" during
    // data preparation (the `data: JSON.stringify(entry)` line).
    store.recordLog({ level: 30, msg: 'bad', value: BigInt(123) })

    // Flush — this should encounter the error but recover
    await flush(store)

    // The flushing flag should have been reset by the finally block
    assert.isFalse((store as any).flushMgr.flushing)

    // Now record a normal log entry
    store.recordLog({ level: 30, msg: 'good entry after error' })

    // Flush again — this should succeed because flushing recovered
    await flush(store)

    // Query the database — the good log should be present
    const db = store.getDb()!
    const rows = await db('server_stats_logs').select('*')
    const messages = rows.map((r: Record<string, unknown>) => r.message)
    assert.include(messages, 'good entry after error')
  })

  test('normal logs are written after recovery from data prep error', async ({ assert }) => {
    // Record a bad entry that will cause JSON.stringify to throw
    store.recordLog({ level: 30, msg: 'will fail', value: BigInt(999) })

    // Flush — should error but recover
    await flush(store)

    // Record 3 good entries
    store.recordLog({ level: 30, msg: 'recovery log 1' })
    store.recordLog({ level: 30, msg: 'recovery log 2' })
    store.recordLog({ level: 30, msg: 'recovery log 3' })

    // Flush — should succeed
    await flush(store)

    // Verify all 3 good logs are in the database
    const db = store.getDb()!
    const result = await db('server_stats_logs').count('* as cnt').first()
    const count = Number(result?.cnt ?? 0)
    assert.equal(count, 3)
  })

  test('flushing flag is false after a successful flush', async ({ assert }) => {
    store.recordLog({ level: 30, msg: 'normal log' })
    await flush(store)

    assert.isFalse((store as any).flushMgr.flushing)

    const db = store.getDb()!
    const result = await db('server_stats_logs').count('* as cnt').first()
    assert.equal(Number(result?.cnt ?? 0), 1)
  })

  test('multiple bad entries do not permanently lock flushing', async ({ assert }) => {
    // Queue several bad entries
    store.recordLog({ level: 30, msg: 'bad1', a: BigInt(1) })
    store.recordLog({ level: 30, msg: 'bad2', b: BigInt(2) })

    await flush(store)
    assert.isFalse((store as any).flushMgr.flushing)

    // Queue more bad entries
    store.recordLog({ level: 30, msg: 'bad3', c: BigInt(3) })
    await flush(store)
    assert.isFalse((store as any).flushMgr.flushing)

    // Now queue a good entry — should still work
    store.recordLog({ level: 30, msg: 'finally good' })
    await flush(store)

    const db = store.getDb()!
    const rows = await db('server_stats_logs').select('message')
    const messages = rows.map((r: Record<string, unknown>) => r.message)
    assert.include(messages, 'finally good')
  })
})
