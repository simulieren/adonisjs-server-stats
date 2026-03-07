import { test } from '@japa/runner'
import {
  METRIC_DEFINITIONS,
  getMetricById,
  getMetricsByGroup,
  MAX_HISTORY,
  STALE_MS,
} from '../src/core/metrics.js'
import type { ServerStats } from '../src/types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock ServerStats object with all fields populated.
 * Uses sensible non-zero defaults so extract/format functions
 * can run without errors.
 */
function mockStats(overrides: Partial<ServerStats> = {}): ServerStats {
  return {
    nodeVersion: 'v20.11.0',
    uptime: 3600,
    memHeapUsed: 128 * 1024 * 1024,
    memHeapTotal: 256 * 1024 * 1024,
    memRss: 200 * 1024 * 1024,
    cpuPercent: 25.5,
    eventLoopLag: 1.2,
    timestamp: Date.now(),
    requestsPerSecond: 42.3,
    avgResponseTimeMs: 120,
    errorRate: 0.5,
    activeHttpConnections: 10,
    dbPoolUsed: 3,
    dbPoolFree: 7,
    dbPoolPending: 0,
    dbPoolMax: 10,
    redisOk: true,
    redisMemoryUsedMb: 64.5,
    redisConnectedClients: 5,
    redisKeysCount: 1200,
    redisHitRate: 95.2,
    queueActive: 2,
    queueWaiting: 5,
    queueDelayed: 1,
    queueFailed: 0,
    queueWorkerCount: 4,
    systemLoadAvg1m: 1.5,
    systemLoadAvg5m: 1.2,
    systemLoadAvg15m: 1.0,
    systemMemoryTotalMb: 16384,
    systemMemoryFreeMb: 8192,
    systemUptime: 86400,
    onlineUsers: 42,
    pendingWebhooks: 3,
    pendingEmails: 1,
    logErrorsLast5m: 2,
    logWarningsLast5m: 5,
    logEntriesLast5m: 100,
    logEntriesPerMinute: 20,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// METRIC_DEFINITIONS — required fields
// ---------------------------------------------------------------------------

test.group('METRIC_DEFINITIONS — required fields', () => {
  test('every metric has an id (non-empty string)', ({ assert }) => {
    for (const m of METRIC_DEFINITIONS) {
      assert.isString(m.id)
      assert.isTrue(m.id.length > 0, `metric id must not be empty`)
    }
  })

  test('every metric has a label (non-empty string)', ({ assert }) => {
    for (const m of METRIC_DEFINITIONS) {
      assert.isString(m.label)
      assert.isTrue(m.label.length > 0, `metric "${m.id}" must have a label`)
    }
  })

  test('every metric has a title (non-empty string)', ({ assert }) => {
    for (const m of METRIC_DEFINITIONS) {
      assert.isString(m.title)
      assert.isTrue((m.title as string).length > 0, `metric "${m.id}" must have a title`)
    }
  })

  test('every metric has a unit (string, may be empty)', ({ assert }) => {
    for (const m of METRIC_DEFINITIONS) {
      assert.isString(m.unit, `metric "${m.id}" must have a unit string`)
    }
  })

  test('every metric has a group (non-empty string)', ({ assert }) => {
    for (const m of METRIC_DEFINITIONS) {
      assert.isString(m.group)
      assert.isTrue((m.group as string).length > 0, `metric "${m.id}" must have a group`)
    }
  })

  test('every metric has an extract function', ({ assert }) => {
    for (const m of METRIC_DEFINITIONS) {
      assert.isFunction(m.extract, `metric "${m.id}" must have an extract function`)
    }
  })

  test('every metric has a format function', ({ assert }) => {
    for (const m of METRIC_DEFINITIONS) {
      assert.isFunction(m.format, `metric "${m.id}" must have a format function`)
    }
  })

  test('every metric has a color function', ({ assert }) => {
    for (const m of METRIC_DEFINITIONS) {
      assert.isFunction(m.color, `metric "${m.id}" must have a color function`)
    }
  })
})

// ---------------------------------------------------------------------------
// Unique IDs
// ---------------------------------------------------------------------------

test.group('METRIC_DEFINITIONS — unique IDs', () => {
  test('all metric IDs are unique', ({ assert }) => {
    const ids = METRIC_DEFINITIONS.map((m) => m.id)
    const uniqueIds = new Set(ids)
    assert.equal(ids.length, uniqueIds.size, `Duplicate IDs found: ${ids.filter((id, i) => ids.indexOf(id) !== i).join(', ')}`)
  })
})

// ---------------------------------------------------------------------------
// Unique historyKeys
// ---------------------------------------------------------------------------

test.group('METRIC_DEFINITIONS — unique historyKeys', () => {
  test('all historyKeys are unique among metrics that have one', ({ assert }) => {
    const keys = METRIC_DEFINITIONS.filter((m) => m.historyKey !== undefined).map((m) => m.historyKey!)
    const uniqueKeys = new Set(keys)
    assert.equal(
      keys.length,
      uniqueKeys.size,
      `Duplicate historyKeys found: ${keys.filter((k, i) => keys.indexOf(k) !== i).join(', ')}`
    )
  })
})

// ---------------------------------------------------------------------------
// getMetricById
// ---------------------------------------------------------------------------

test.group('getMetricById', () => {
  test('returns the metric for a known ID', ({ assert }) => {
    const cpu = getMetricById('cpu')
    assert.isDefined(cpu)
    assert.equal(cpu!.id, 'cpu')
    assert.equal(cpu!.label, 'CPU')
  })

  test('returns undefined for an unknown ID', ({ assert }) => {
    const result = getMetricById('nonexistent_metric_xyz')
    assert.isUndefined(result)
  })

  test('returns the correct metric for "memory"', ({ assert }) => {
    const mem = getMetricById('memory')
    assert.isDefined(mem)
    assert.equal(mem!.id, 'memory')
    assert.equal(mem!.label, 'HEAP')
  })

  test('returns the correct metric for "redis"', ({ assert }) => {
    const redis = getMetricById('redis')
    assert.isDefined(redis)
    assert.equal(redis!.id, 'redis')
    assert.equal(redis!.label, 'REDIS')
  })
})

// ---------------------------------------------------------------------------
// getMetricsByGroup
// ---------------------------------------------------------------------------

test.group('getMetricsByGroup', () => {
  test('returns a Map', ({ assert }) => {
    const groups = getMetricsByGroup()
    assert.instanceOf(groups, Map)
  })

  test('all metrics are accounted for across groups', ({ assert }) => {
    const groups = getMetricsByGroup()
    let totalCount = 0
    for (const metrics of groups.values()) {
      totalCount += metrics.length
    }
    assert.equal(totalCount, METRIC_DEFINITIONS.length)
  })

  test('contains expected group names', ({ assert }) => {
    const groups = getMetricsByGroup()
    const groupNames = [...groups.keys()]
    assert.include(groupNames, 'process')
    assert.include(groupNames, 'memory')
    assert.include(groupNames, 'http')
    assert.include(groupNames, 'db')
    assert.include(groupNames, 'redis')
    assert.include(groupNames, 'queue')
    assert.include(groupNames, 'app')
    assert.include(groupNames, 'log')
  })

  test('process group contains cpu and uptime', ({ assert }) => {
    const groups = getMetricsByGroup()
    const processMetrics = groups.get('process')!
    const ids = processMetrics.map((m) => m.id)
    assert.include(ids, 'cpu')
    assert.include(ids, 'uptime')
    assert.include(ids, 'node')
    assert.include(ids, 'eventLoop')
  })

  test('memory group contains memory and rss', ({ assert }) => {
    const groups = getMetricsByGroup()
    const memoryMetrics = groups.get('memory')!
    const ids = memoryMetrics.map((m) => m.id)
    assert.include(ids, 'memory')
    assert.include(ids, 'rss')
    assert.include(ids, 'systemMemory')
  })

  test('each metric in a group has the correct group field', ({ assert }) => {
    const groups = getMetricsByGroup()
    for (const [groupName, metrics] of groups) {
      for (const m of metrics) {
        const expectedGroup = m.group || 'core'
        assert.equal(expectedGroup, groupName, `metric "${m.id}" has group "${m.group}" but is in group "${groupName}"`)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// extract functions
// ---------------------------------------------------------------------------

test.group('METRIC_DEFINITIONS — extract functions return numbers', () => {
  test('every extract function returns a number given valid stats', ({ assert }) => {
    const stats = mockStats()
    for (const m of METRIC_DEFINITIONS) {
      const result = m.extract(stats)
      assert.isNumber(result, `metric "${m.id}" extract() should return a number, got ${typeof result}`)
    }
  })

  test('cpu extract returns cpuPercent from stats', ({ assert }) => {
    const stats = mockStats({ cpuPercent: 75.3 })
    const cpu = getMetricById('cpu')!
    assert.equal(cpu.extract(stats), 75.3)
  })

  test('memory extract returns memHeapUsed from stats', ({ assert }) => {
    const stats = mockStats({ memHeapUsed: 500_000_000 })
    const mem = getMetricById('memory')!
    assert.equal(mem.extract(stats), 500_000_000)
  })

  test('systemMemory extract returns used memory (total - free)', ({ assert }) => {
    const stats = mockStats({ systemMemoryTotalMb: 16384, systemMemoryFreeMb: 4096 })
    const sysMem = getMetricById('systemMemory')!
    assert.equal(sysMem.extract(stats), 12288)
  })

  test('redis extract returns 1 when redisOk is true', ({ assert }) => {
    const stats = mockStats({ redisOk: true })
    const redis = getMetricById('redis')!
    assert.equal(redis.extract(stats), 1)
  })

  test('redis extract returns 0 when redisOk is false', ({ assert }) => {
    const stats = mockStats({ redisOk: false })
    const redis = getMetricById('redis')!
    assert.equal(redis.extract(stats), 0)
  })

  test('node extract returns 0 (static metric)', ({ assert }) => {
    const stats = mockStats()
    const node = getMetricById('node')!
    assert.equal(node.extract(stats), 0)
  })
})

// ---------------------------------------------------------------------------
// format functions
// ---------------------------------------------------------------------------

test.group('METRIC_DEFINITIONS — format functions return strings', () => {
  test('every format function returns a string given valid stats', ({ assert }) => {
    const stats = mockStats()
    for (const m of METRIC_DEFINITIONS) {
      const result = m.format(stats)
      assert.isString(result, `metric "${m.id}" format() should return a string, got ${typeof result}`)
    }
  })

  test('cpu format includes percentage sign', ({ assert }) => {
    const stats = mockStats({ cpuPercent: 42.7 })
    const cpu = getMetricById('cpu')!
    const formatted = cpu.format(stats)
    assert.include(formatted, '%')
    assert.include(formatted, '42.7')
  })

  test('node format returns nodeVersion', ({ assert }) => {
    const stats = mockStats({ nodeVersion: 'v20.11.0' })
    const node = getMetricById('node')!
    assert.equal(node.format(stats), 'v20.11.0')
  })

  test('redis format returns checkmark when ok', ({ assert }) => {
    const stats = mockStats({ redisOk: true })
    const redis = getMetricById('redis')!
    assert.equal(redis.format(stats), '\u2713')
  })

  test('redis format returns cross when not ok', ({ assert }) => {
    const stats = mockStats({ redisOk: false })
    const redis = getMetricById('redis')!
    assert.equal(redis.format(stats), '\u2717')
  })

  test('dbPool format shows used/free/max', ({ assert }) => {
    const stats = mockStats({ dbPoolUsed: 3, dbPoolFree: 7, dbPoolMax: 10 })
    const db = getMetricById('dbPool')!
    assert.equal(db.format(stats), '3/7/10')
  })

  test('queue format shows active/waiting/delayed', ({ assert }) => {
    const stats = mockStats({ queueActive: 2, queueWaiting: 5, queueDelayed: 1 })
    const q = getMetricById('queue')!
    assert.equal(q.format(stats), '2/5/1')
  })

  test('errorRate format includes percentage', ({ assert }) => {
    const stats = mockStats({ errorRate: 2.3 })
    const err = getMetricById('errorRate')!
    assert.equal(err.format(stats), '2.3%')
  })

  test('avgResponse format includes ms suffix', ({ assert }) => {
    const stats = mockStats({ avgResponseTimeMs: 150 })
    const avg = getMetricById('avgResponse')!
    assert.equal(avg.format(stats), '150ms')
  })

  test('eventLoop format includes ms suffix', ({ assert }) => {
    const stats = mockStats({ eventLoopLag: 5.3 })
    const el = getMetricById('eventLoop')!
    assert.equal(el.format(stats), '5.3ms')
  })
})

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

test.group('Constants', () => {
  test('MAX_HISTORY equals 60', ({ assert }) => {
    assert.equal(MAX_HISTORY, 60)
  })

  test('STALE_MS equals 10000', ({ assert }) => {
    assert.equal(STALE_MS, 10_000)
  })
})
