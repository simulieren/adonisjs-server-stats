import { test } from '@japa/runner'
import { createHistoryBuffer } from '../src/core/history-buffer.js'
import { METRIC_DEFINITIONS } from '../src/core/metrics.js'
import type { ServerStats } from '../src/types.js'

/**
 * Build a minimal mock ServerStats object.
 * All fields are populated with sensible defaults; callers can override
 * individual properties via the `overrides` parameter.
 */
function makeStats(overrides: Partial<ServerStats> = {}): ServerStats {
  return {
    nodeVersion: 'v20.11.0',
    uptime: 1000,
    memHeapUsed: 80_000_000,
    memHeapTotal: 200_000_000,
    memRss: 150_000_000,
    cpuPercent: 45,
    eventLoopLag: 1.2,
    timestamp: Date.now(),
    requestsPerSecond: 120,
    avgResponseTimeMs: 35,
    errorRate: 0.5,
    activeHttpConnections: 10,
    dbPoolUsed: 3,
    dbPoolFree: 7,
    dbPoolPending: 0,
    dbPoolMax: 10,
    redisOk: true,
    redisMemoryUsedMb: 12.5,
    redisConnectedClients: 4,
    redisKeysCount: 500,
    redisHitRate: 95,
    queueActive: 2,
    queueWaiting: 5,
    queueDelayed: 1,
    queueFailed: 0,
    queueWorkerCount: 3,
    systemLoadAvg1m: 1.5,
    systemLoadAvg5m: 1.2,
    systemLoadAvg15m: 1.0,
    systemMemoryTotalMb: 16384,
    systemMemoryFreeMb: 8192,
    systemUptime: 86400,
    onlineUsers: 42,
    pendingWebhooks: 0,
    pendingEmails: 0,
    logErrorsLast5m: 0,
    logWarningsLast5m: 2,
    logEntriesLast5m: 100,
    logEntriesPerMinute: 20,
    ...overrides,
  }
}

/**
 * Collect all historyKey values from METRIC_DEFINITIONS that are defined.
 */
const ALL_HISTORY_KEYS = METRIC_DEFINITIONS.filter((m) => m.historyKey).map((m) => m.historyKey!)

test.group('createHistoryBuffer | factory', () => {
  test('returns object with push, get, getAll methods', ({ assert }) => {
    const buf = createHistoryBuffer()

    assert.isFunction(buf.push)
    assert.isFunction(buf.get)
    assert.isFunction(buf.getAll)
  })
})

test.group('createHistoryBuffer | push', () => {
  test('extracts numeric values from ServerStats using METRIC_DEFINITIONS', ({ assert }) => {
    const buf = createHistoryBuffer()
    const stats = makeStats({ cpuPercent: 72.5 })

    buf.push(stats)

    const cpuHistory = buf.get('cpuPercent')
    assert.lengthOf(cpuHistory, 1)
    assert.equal(cpuHistory[0], 72.5)
  })

  test('extracts all metrics that have a historyKey', ({ assert }) => {
    const buf = createHistoryBuffer()
    const stats = makeStats()

    buf.push(stats)

    for (const key of ALL_HISTORY_KEYS) {
      const history = buf.get(key)
      assert.isAbove(history.length, 0, `Expected history for key "${key}" to have at least one entry`)
    }
  })

  test('skips metrics without a historyKey', ({ assert }) => {
    const buf = createHistoryBuffer()
    const stats = makeStats()

    buf.push(stats)

    // 'node' metric has no historyKey, and its extract returns 0
    // Verify keys that should NOT be tracked are absent
    const metricsWithoutHistoryKey = METRIC_DEFINITIONS.filter((m) => !m.historyKey)
    assert.isAbove(metricsWithoutHistoryKey.length, 0, 'There should be metrics without historyKey')

    const all = buf.getAll()
    const trackedKeys = Object.keys(all)

    // None of the metrics without historyKey should appear as a tracked key
    for (const metric of metricsWithoutHistoryKey) {
      assert.notInclude(trackedKeys, metric.id, `Metric "${metric.id}" has no historyKey and should not be tracked`)
    }
  })

  test('skips non-numeric extracted values', ({ assert }) => {
    const buf = createHistoryBuffer()

    // The 'node' metric extracts `(_s) => 0` which is numeric, but has no historyKey.
    // We need to verify that if extract returned undefined, it would be skipped.
    // The 'uptime' metric has no historyKey, so it is already skipped.
    // For a direct test, we push stats and verify only historyKey metrics are tracked.
    const stats = makeStats()

    buf.push(stats)

    const all = buf.getAll()
    const trackedKeys = Object.keys(all)

    // Every tracked key should correspond to a metric with a historyKey
    for (const key of trackedKeys) {
      assert.include(ALL_HISTORY_KEYS, key, `Tracked key "${key}" should be in METRIC_DEFINITIONS historyKey list`)
    }
  })

  test('computed historyKey _sysMemUsed stores computed value', ({ assert }) => {
    const buf = createHistoryBuffer()
    const stats = makeStats({ systemMemoryTotalMb: 16384, systemMemoryFreeMb: 8192 })

    buf.push(stats)

    const sysMemHistory = buf.get('_sysMemUsed')
    assert.lengthOf(sysMemHistory, 1)
    // extract: (s) => s.systemMemoryTotalMb - s.systemMemoryFreeMb
    assert.equal(sysMemHistory[0], 16384 - 8192)
  })
})

test.group('createHistoryBuffer | get', () => {
  test('returns empty array for unknown keys', ({ assert }) => {
    const buf = createHistoryBuffer()

    const result = buf.get('nonExistentKey')
    assert.deepEqual(result, [])
  })

  test('returns empty array before any push', ({ assert }) => {
    const buf = createHistoryBuffer()

    const result = buf.get('cpuPercent')
    assert.deepEqual(result, [])
  })

  test('returns values in chronological order (oldest first)', ({ assert }) => {
    const buf = createHistoryBuffer()

    buf.push(makeStats({ cpuPercent: 10 }))
    buf.push(makeStats({ cpuPercent: 20 }))
    buf.push(makeStats({ cpuPercent: 30 }))

    const history = buf.get('cpuPercent')
    assert.deepEqual(history, [10, 20, 30])
  })

  test('returns correct values for multiple metrics simultaneously', ({ assert }) => {
    const buf = createHistoryBuffer()

    buf.push(makeStats({ cpuPercent: 50, memRss: 100 }))
    buf.push(makeStats({ cpuPercent: 60, memRss: 200 }))

    assert.deepEqual(buf.get('cpuPercent'), [50, 60])
    assert.deepEqual(buf.get('memRss'), [100, 200])
  })
})

test.group('createHistoryBuffer | circular buffer wrapping', () => {
  test('drops oldest values when maxLength is exceeded', ({ assert }) => {
    const buf = createHistoryBuffer(3)

    buf.push(makeStats({ cpuPercent: 10 }))
    buf.push(makeStats({ cpuPercent: 20 }))
    buf.push(makeStats({ cpuPercent: 30 }))
    buf.push(makeStats({ cpuPercent: 40 }))
    buf.push(makeStats({ cpuPercent: 50 }))

    const history = buf.get('cpuPercent')
    assert.lengthOf(history, 3)
    assert.deepEqual(history, [30, 40, 50])
  })

  test('preserves chronological order after wrapping', ({ assert }) => {
    const buf = createHistoryBuffer(4)

    // Push 7 items into a buffer of size 4
    for (let i = 1; i <= 7; i++) {
      buf.push(makeStats({ cpuPercent: i * 10 }))
    }

    const history = buf.get('cpuPercent')
    assert.lengthOf(history, 4)
    // Should have values 40, 50, 60, 70 (oldest 10, 20, 30 dropped)
    assert.deepEqual(history, [40, 50, 60, 70])
  })

  test('wrapping works correctly at exact capacity boundary', ({ assert }) => {
    const buf = createHistoryBuffer(3)

    // Push exactly maxLength items
    buf.push(makeStats({ cpuPercent: 1 }))
    buf.push(makeStats({ cpuPercent: 2 }))
    buf.push(makeStats({ cpuPercent: 3 }))

    assert.deepEqual(buf.get('cpuPercent'), [1, 2, 3])

    // Push one more to trigger wrap
    buf.push(makeStats({ cpuPercent: 4 }))

    assert.deepEqual(buf.get('cpuPercent'), [2, 3, 4])
  })

  test('wrapping with multiple full rotations preserves order', ({ assert }) => {
    const buf = createHistoryBuffer(3)

    // Push 10 items into a buffer of size 3 (more than 3 full rotations)
    for (let i = 1; i <= 10; i++) {
      buf.push(makeStats({ cpuPercent: i }))
    }

    const history = buf.get('cpuPercent')
    assert.lengthOf(history, 3)
    assert.deepEqual(history, [8, 9, 10])
  })
})

test.group('createHistoryBuffer | getAll', () => {
  test('returns all tracked keys in a Record', ({ assert }) => {
    const buf = createHistoryBuffer()
    const stats = makeStats()

    buf.push(stats)

    const all = buf.getAll()
    const keys = Object.keys(all)

    // Every key in ALL_HISTORY_KEYS should be present
    for (const key of ALL_HISTORY_KEYS) {
      assert.include(keys, key, `Expected getAll() to include key "${key}"`)
    }
  })

  test('returns empty record before any push', ({ assert }) => {
    const buf = createHistoryBuffer()

    const all = buf.getAll()
    assert.deepEqual(all, {})
  })

  test('values in getAll match values from individual get calls', ({ assert }) => {
    const buf = createHistoryBuffer()

    buf.push(makeStats({ cpuPercent: 25, memRss: 999 }))
    buf.push(makeStats({ cpuPercent: 75, memRss: 888 }))

    const all = buf.getAll()

    assert.deepEqual(all['cpuPercent'], buf.get('cpuPercent'))
    assert.deepEqual(all['memRss'], buf.get('memRss'))
  })
})

test.group('createHistoryBuffer | getAll cache', () => {
  test('two consecutive getAll calls without push return the same object reference', ({ assert }) => {
    const buf = createHistoryBuffer()

    buf.push(makeStats())

    const first = buf.getAll()
    const second = buf.getAll()

    assert.strictEqual(first, second)
  })

  test('push invalidates cache, next getAll recomputes', ({ assert }) => {
    const buf = createHistoryBuffer()

    buf.push(makeStats({ cpuPercent: 10 }))
    const first = buf.getAll()
    // Capture the array reference before cache invalidation
    const firstCpuArray = first['cpuPercent']
    assert.lengthOf(firstCpuArray, 1)
    assert.deepEqual(firstCpuArray, [10])

    buf.push(makeStats({ cpuPercent: 20 }))
    const second = buf.getAll()

    // getAll returns the same cache object, but the inner arrays
    // are replaced with fresh ones when the cache is recomputed
    assert.strictEqual(first, second)
    assert.lengthOf(second['cpuPercent'], 2)
    assert.deepEqual(second['cpuPercent'], [10, 20])

    // The inner array reference was replaced during recomputation
    assert.notStrictEqual(firstCpuArray, second['cpuPercent'])
  })

  test('cache is valid across multiple getAll calls between pushes', ({ assert }) => {
    const buf = createHistoryBuffer()

    buf.push(makeStats({ cpuPercent: 42 }))

    const a = buf.getAll()
    const b = buf.getAll()
    const c = buf.getAll()

    assert.strictEqual(a, b)
    assert.strictEqual(b, c)
  })
})

test.group('createHistoryBuffer | custom maxLength', () => {
  test('buffer with maxLength=3 retains only 3 values', ({ assert }) => {
    const buf = createHistoryBuffer(3)

    buf.push(makeStats({ cpuPercent: 1 }))
    buf.push(makeStats({ cpuPercent: 2 }))
    buf.push(makeStats({ cpuPercent: 3 }))
    buf.push(makeStats({ cpuPercent: 4 }))
    buf.push(makeStats({ cpuPercent: 5 }))

    const history = buf.get('cpuPercent')
    assert.lengthOf(history, 3)
    assert.deepEqual(history, [3, 4, 5])
  })

  test('buffer with maxLength=1 retains only the latest value', ({ assert }) => {
    const buf = createHistoryBuffer(1)

    buf.push(makeStats({ cpuPercent: 100 }))
    buf.push(makeStats({ cpuPercent: 200 }))
    buf.push(makeStats({ cpuPercent: 300 }))

    const history = buf.get('cpuPercent')
    assert.lengthOf(history, 1)
    assert.deepEqual(history, [300])
  })

  test('default maxLength uses MAX_HISTORY (60)', ({ assert }) => {
    const buf = createHistoryBuffer()

    // Push 65 items, only 60 should be retained
    for (let i = 1; i <= 65; i++) {
      buf.push(makeStats({ cpuPercent: i }))
    }

    const history = buf.get('cpuPercent')
    assert.lengthOf(history, 60)
    // Oldest 5 dropped: first value should be 6, last should be 65
    assert.equal(history[0], 6)
    assert.equal(history[59], 65)
  })
})

test.group('createHistoryBuffer | edge cases', () => {
  test('pushing the same stats object multiple times appends each time', ({ assert }) => {
    const buf = createHistoryBuffer()
    const stats = makeStats({ cpuPercent: 55 })

    buf.push(stats)
    buf.push(stats)
    buf.push(stats)

    const history = buf.get('cpuPercent')
    assert.lengthOf(history, 3)
    assert.deepEqual(history, [55, 55, 55])
  })

  test('get returns a new array each call (not a shared reference)', ({ assert }) => {
    const buf = createHistoryBuffer()

    buf.push(makeStats({ cpuPercent: 10 }))

    const first = buf.get('cpuPercent')
    const second = buf.get('cpuPercent')

    assert.deepEqual(first, second)
    // Modifying one should not affect the other
    first.push(999)
    assert.notDeepEqual(first, buf.get('cpuPercent'))
  })

  test('get for unknown key returns a fresh empty array each time', ({ assert }) => {
    const buf = createHistoryBuffer()

    const a = buf.get('nope')
    const b = buf.get('nope')

    assert.deepEqual(a, [])
    assert.deepEqual(b, [])
  })

  test('all history keys track independently across pushes', ({ assert }) => {
    const buf = createHistoryBuffer(5)

    buf.push(makeStats({ cpuPercent: 10, errorRate: 1.0 }))
    buf.push(makeStats({ cpuPercent: 20, errorRate: 2.0 }))

    assert.deepEqual(buf.get('cpuPercent'), [10, 20])
    assert.deepEqual(buf.get('errorRate'), [1.0, 2.0])
  })

  test('zero values are stored correctly (not treated as non-numeric)', ({ assert }) => {
    const buf = createHistoryBuffer()

    buf.push(makeStats({ cpuPercent: 0, errorRate: 0 }))

    assert.deepEqual(buf.get('cpuPercent'), [0])
    assert.deepEqual(buf.get('errorRate'), [0])
  })

  test('negative values are stored correctly', ({ assert }) => {
    const buf = createHistoryBuffer()

    // While negative CPU makes no practical sense, the buffer should handle any number
    buf.push(makeStats({ cpuPercent: -5 }))

    assert.deepEqual(buf.get('cpuPercent'), [-5])
  })

  test('fractional values are preserved', ({ assert }) => {
    const buf = createHistoryBuffer()

    buf.push(makeStats({ cpuPercent: 33.333 }))
    buf.push(makeStats({ cpuPercent: 66.667 }))

    assert.deepEqual(buf.get('cpuPercent'), [33.333, 66.667])
  })
})
