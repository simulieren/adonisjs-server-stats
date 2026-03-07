import { test } from '@japa/runner'
import { RequestMetrics } from '../src/engine/request_metrics.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Small async helper -- wait for `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Tests -- getMetrics returns correct results for various time ranges
// ---------------------------------------------------------------------------

test.group('RequestMetrics | getMetrics correctness', () => {
  test('returns zero metrics when no requests recorded', ({ assert }) => {
    const rm = new RequestMetrics({ maxRecords: 100, windowMs: 60_000 })
    const metrics = rm.getMetrics()

    assert.equal(metrics.requestsPerSecond, 0)
    assert.equal(metrics.averageResponseTimeMs, 0)
    assert.equal(metrics.errorRate, 0)
    assert.equal(metrics.activeConnections, 0)
  })

  test('correctly computes requestsPerSecond for a small window', ({ assert }) => {
    // 10-second window, record 10 requests
    const rm = new RequestMetrics({ maxRecords: 1000, windowMs: 10_000 })

    for (let i = 0; i < 10; i++) {
      rm.recordRequest(50, 200)
    }

    const metrics = rm.getMetrics()

    // 10 requests in 10-second window = 1 req/s
    assert.equal(metrics.requestsPerSecond, 1)
  })

  test('correctly computes averageResponseTimeMs', ({ assert }) => {
    const rm = new RequestMetrics({ maxRecords: 1000, windowMs: 60_000 })

    rm.recordRequest(10, 200)
    rm.recordRequest(20, 200)
    rm.recordRequest(30, 200)

    const metrics = rm.getMetrics()

    // Average of 10, 20, 30 = 20
    assert.equal(metrics.averageResponseTimeMs, 20)
  })

  test('correctly computes errorRate for 5xx status codes', ({ assert }) => {
    const rm = new RequestMetrics({ maxRecords: 1000, windowMs: 60_000 })

    // 8 successful, 2 errors
    for (let i = 0; i < 8; i++) {
      rm.recordRequest(10, 200)
    }
    rm.recordRequest(10, 500)
    rm.recordRequest(10, 503)

    const metrics = rm.getMetrics()

    // 2 errors out of 10 = 20%
    assert.equal(metrics.errorRate, 20)
  })

  test('4xx status codes are not counted as errors', ({ assert }) => {
    const rm = new RequestMetrics({ maxRecords: 1000, windowMs: 60_000 })

    rm.recordRequest(10, 200)
    rm.recordRequest(10, 404)
    rm.recordRequest(10, 403)
    rm.recordRequest(10, 422)

    const metrics = rm.getMetrics()

    // None are >= 500, so error rate should be 0
    assert.equal(metrics.errorRate, 0)
  })

  test('activeConnections tracks increment/decrement correctly', ({ assert }) => {
    const rm = new RequestMetrics({ maxRecords: 100, windowMs: 60_000 })

    rm.incrementActiveConnections()
    rm.incrementActiveConnections()
    rm.incrementActiveConnections()

    let metrics = rm.getMetrics()
    assert.equal(metrics.activeConnections, 3)

    rm.decrementActiveConnections()
    metrics = rm.getMetrics()
    assert.equal(metrics.activeConnections, 2)
  })

  test('activeConnections does not go below zero', ({ assert }) => {
    const rm = new RequestMetrics({ maxRecords: 100, windowMs: 60_000 })

    rm.decrementActiveConnections()
    rm.decrementActiveConnections()

    const metrics = rm.getMetrics()
    assert.equal(metrics.activeConnections, 0)
  })
})

// ---------------------------------------------------------------------------
// Tests -- performance: getMetrics with 10,000 records
// ---------------------------------------------------------------------------

test.group('RequestMetrics | performance', () => {
  test('getMetrics with 10,000 records completes in under 10ms', ({ assert }) => {
    const rm = new RequestMetrics({ maxRecords: 10_000, windowMs: 60_000 })

    // Fill with 10,000 records
    for (let i = 0; i < 10_000; i++) {
      rm.recordRequest(Math.random() * 100, i % 10 === 0 ? 500 : 200)
    }

    // Warm up (JIT)
    rm.getMetrics()

    // Measure
    const iterations = 100
    const start = performance.now()
    for (let i = 0; i < iterations; i++) {
      rm.getMetrics()
    }
    const elapsed = performance.now() - start
    const perCall = elapsed / iterations

    assert.isBelow(
      perCall,
      10,
      `Expected getMetrics() to complete in under 10ms but took ${perCall.toFixed(2)}ms`
    )
  })

  test('recordRequest with 100,000 entries does not grow memory beyond maxRecords', ({
    assert,
  }) => {
    const maxRecords = 500
    const rm = new RequestMetrics({ maxRecords, windowMs: 60_000 })

    for (let i = 0; i < 100_000; i++) {
      rm.recordRequest(10, 200)
    }

    // The metrics should still work correctly -- the ring buffer should
    // have wrapped. We verify by checking that the metric computation
    // does not throw or return unreasonable values.
    const metrics = rm.getMetrics()
    assert.isTrue(metrics.requestsPerSecond >= 0)
    assert.isTrue(metrics.averageResponseTimeMs >= 0)
    assert.isTrue(metrics.errorRate >= 0)
  })
})

// ---------------------------------------------------------------------------
// Tests -- ring buffer wraps at maxRecords
// ---------------------------------------------------------------------------

test.group('RequestMetrics | ring buffer wrapping', () => {
  test('records wrap around correctly at maxRecords boundary', ({ assert }) => {
    const rm = new RequestMetrics({ maxRecords: 5, windowMs: 60_000 })

    // Record 8 requests -- the first 3 should be overwritten
    rm.recordRequest(10, 200)
    rm.recordRequest(20, 200)
    rm.recordRequest(30, 200)
    rm.recordRequest(40, 500) // error
    rm.recordRequest(50, 200)
    // Buffer is now full with [10,20,30,40,50]
    // Next writes overwrite from index 0
    rm.recordRequest(60, 200) // overwrites 10ms/200
    rm.recordRequest(70, 500) // overwrites 20ms/200
    rm.recordRequest(80, 200) // overwrites 30ms/200

    const metrics = rm.getMetrics()

    // Active records: [60, 70, 80, 40, 50] (assuming all within window)
    // Average: (60+70+80+40+50)/5 = 300/5 = 60
    assert.equal(metrics.averageResponseTimeMs, 60)

    // Errors: statusCode 500 at positions for 40ms and 70ms = 2 errors out of 5
    assert.equal(metrics.errorRate, 40)
  })

  test('after wrapping, getMetrics still returns correct count', ({ assert }) => {
    const rm = new RequestMetrics({ maxRecords: 10, windowMs: 60_000 })

    // Record 25 requests -- buffer wraps 2.5 times
    for (let i = 0; i < 25; i++) {
      rm.recordRequest(10, 200)
    }

    const metrics = rm.getMetrics()

    // Only 10 records exist in the buffer (maxRecords=10)
    // 10 requests in 60-second window = 10/60 req/s
    const expectedRps = 10 / 60
    assert.closeTo(metrics.requestsPerSecond, expectedRps, 0.001)
  })
})

// ---------------------------------------------------------------------------
// Tests -- records outside time window are excluded
// ---------------------------------------------------------------------------

test.group('RequestMetrics | time window exclusion', () => {
  test('records outside the time window are excluded from metrics', async ({ assert }) => {
    // Use a very short window (100ms) so records expire quickly
    const rm = new RequestMetrics({ maxRecords: 1000, windowMs: 100 })

    // Record some requests
    rm.recordRequest(10, 200)
    rm.recordRequest(20, 200)
    rm.recordRequest(30, 500)

    // Immediately, all 3 should be within the window
    let metrics = rm.getMetrics()
    const windowSeconds = 0.1 // 100ms = 0.1s
    assert.closeTo(metrics.requestsPerSecond, 3 / windowSeconds, 0.1)

    // Wait for the window to expire
    await sleep(150)

    // Now all records should be outside the window
    metrics = rm.getMetrics()
    assert.equal(metrics.requestsPerSecond, 0, 'All records should be expired')
    assert.equal(metrics.averageResponseTimeMs, 0, 'No valid records for average')
    assert.equal(metrics.errorRate, 0, 'No valid records for error rate')
  })

  test('mixed old and new records -- only new records counted', async ({ assert }) => {
    const rm = new RequestMetrics({ maxRecords: 1000, windowMs: 100 })

    // Record old requests
    rm.recordRequest(100, 500)
    rm.recordRequest(200, 500)

    // Wait for them to expire
    await sleep(150)

    // Record new requests
    rm.recordRequest(10, 200)
    rm.recordRequest(20, 200)

    const metrics = rm.getMetrics()

    // Only the 2 new requests should count
    const windowSeconds = 0.1
    assert.closeTo(metrics.requestsPerSecond, 2 / windowSeconds, 0.1)

    // Average should be (10+20)/2 = 15 (not including the old 100ms and 200ms)
    assert.equal(metrics.averageResponseTimeMs, 15)

    // Error rate should be 0 (the 500s have expired)
    assert.equal(metrics.errorRate, 0)
  })
})
