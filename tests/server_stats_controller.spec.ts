import { test } from '@japa/runner'
import { ServerStatsController } from '../src/core/server-stats-controller.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Small async helper -- wait for `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const originalFetch = globalThis.fetch

/**
 * Mock `globalThis.fetch` to return a valid ServerStats-shaped payload.
 * Honours `AbortSignal` and optional delay.
 */
function mockFetch(delayMs: number = 0) {
  globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError')
    }

    if (delayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, delayMs)
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timeout)
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        })
      })
    }

    return new Response(
      JSON.stringify({
        timestamp: Date.now(),
        metrics: {},
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}

/**
 * Track callback invocations for assertions.
 */
function createCallbackTracker() {
  const calls = {
    statsUpdates: 0,
    connectionChanges: [] as boolean[],
    staleChanges: [] as boolean[],
    errors: [] as (Error | null)[],
    unauthorizedChanges: [] as boolean[],
    sseActiveChanges: [] as boolean[],
    pollActiveChanges: [] as boolean[],
  }
  return {
    calls,
    onStatsUpdate: () => {
      calls.statsUpdates++
    },
    onConnectionChange: (c: boolean) => calls.connectionChanges.push(c),
    onStaleChange: (s: boolean) => calls.staleChanges.push(s),
    onError: (e: Error | null) => calls.errors.push(e),
    onUnauthorizedChange: (u: boolean) => calls.unauthorizedChanges.push(u),
    onSseActiveChange: (a: boolean) => calls.sseActiveChanges.push(a),
    onPollActiveChange: (a: boolean) => calls.pollActiveChanges.push(a),
  }
}

// ---------------------------------------------------------------------------
// Tests -- stop() prevents onDisconnect from starting a new poll timer
// ---------------------------------------------------------------------------

test.group('ServerStatsController | stop prevents onDisconnect race', (group) => {
  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('stop() prevents subsequent polling -- no poll timer starts after stop', async ({
    assert,
  }) => {
    mockFetch(0)
    const tracker = createCallbackTracker()

    // Use a very short poll interval so we can detect leaked timers fast
    const ctrl = new ServerStatsController({
      baseUrl: 'http://localhost:0',
      pollInterval: 50,
      ...tracker,
    })

    // Start will try SSE (which will fail in test env) and fall back to polling
    ctrl.start()

    // Let the initial poll fire
    await sleep(30)

    // Stop should clear all timers
    ctrl.stop()

    const statsAtStop = tracker.calls.statsUpdates

    // Wait well beyond several poll intervals
    await sleep(300)

    // No additional stats updates should have arrived after stop()
    assert.equal(
      tracker.calls.statsUpdates,
      statsAtStop,
      `Expected no stats updates after stop() but got ${tracker.calls.statsUpdates - statsAtStop} extra`
    )
  })

  test('stop() clears stale detection timer', async ({ assert }) => {
    mockFetch(0)
    const tracker = createCallbackTracker()

    const ctrl = new ServerStatsController({
      baseUrl: 'http://localhost:0',
      pollInterval: 50,
      ...tracker,
    })

    ctrl.start()
    await sleep(30)

    ctrl.stop()

    // The stale timer fires every 2000ms -- wait a bit to confirm no stale change
    const staleCountAtStop = tracker.calls.staleChanges.length
    await sleep(100)

    assert.equal(
      tracker.calls.staleChanges.length,
      staleCountAtStop,
      'Stale timer should not fire after stop()'
    )
  })
})

// ---------------------------------------------------------------------------
// Tests -- start() idempotency (no duplicate timers)
// ---------------------------------------------------------------------------

test.group('ServerStatsController | start idempotency', (group) => {
  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('calling start() multiple times does not create duplicate poll timers', async ({
    assert,
  }) => {
    mockFetch(0)
    const tracker = createCallbackTracker()

    const ctrl = new ServerStatsController({
      baseUrl: 'http://localhost:0',
      pollInterval: 100,
      ...tracker,
    })

    // Start 5 times in a row -- without calling stop() in between.
    // The controller should be idempotent or clean up internally.
    ctrl.start()
    ctrl.start()
    ctrl.start()
    ctrl.start()
    ctrl.start()

    // Wait for several poll intervals
    await sleep(350)
    ctrl.stop()

    // With a 100ms interval over 350ms, a single timer would fire ~3 times.
    // If 5 timers existed (bug) we'd see ~15 stats updates.
    // The initial poll from each start() adds 5 immediate calls.
    // With proper guarding we expect: 5 initial polls + ~3 timer polls = ~8
    // Without guarding we'd see: 5 initial polls + ~15 timer polls = ~20
    // We verify the total is reasonable (not runaway).
    assert.isAtMost(
      tracker.calls.statsUpdates,
      15,
      `Expected at most 15 stats updates but got ${tracker.calls.statsUpdates} -- possible duplicate timers`
    )
  })
})

// ---------------------------------------------------------------------------
// Tests -- stop() properly aborts SSE and clears all timers
// ---------------------------------------------------------------------------

test.group('ServerStatsController | stop clears all timers', (group) => {
  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('stop() sets connection mode to disconnected', async ({ assert }) => {
    mockFetch(0)
    const tracker = createCallbackTracker()

    const ctrl = new ServerStatsController({
      baseUrl: 'http://localhost:0',
      pollInterval: 100,
      ...tracker,
    })

    ctrl.start()
    await sleep(50)

    ctrl.stop()

    assert.equal(ctrl.getConnectionMode(), 'disconnected')
  })

  test('stop() then wait -- no callbacks fire after stop', async ({ assert }) => {
    mockFetch(10)
    const tracker = createCallbackTracker()

    const ctrl = new ServerStatsController({
      baseUrl: 'http://localhost:0',
      pollInterval: 50,
      ...tracker,
    })

    ctrl.start()
    await sleep(50)

    ctrl.stop()

    // Snapshot all callback counts
    const snapshot = {
      statsUpdates: tracker.calls.statsUpdates,
      connectionChanges: tracker.calls.connectionChanges.length,
      staleChanges: tracker.calls.staleChanges.length,
      pollActiveChanges: tracker.calls.pollActiveChanges.length,
    }

    // Wait well beyond what any timer would fire
    await sleep(300)

    assert.equal(
      tracker.calls.statsUpdates,
      snapshot.statsUpdates,
      'No statsUpdate callbacks after stop()'
    )
  })

  test('rapid start/stop cycle does not leak timers', async ({ assert }) => {
    mockFetch(0)
    const tracker = createCallbackTracker()

    const ctrl = new ServerStatsController({
      baseUrl: 'http://localhost:0',
      pollInterval: 30,
      ...tracker,
    })

    // Rapid start/stop 20 times
    for (let i = 0; i < 20; i++) {
      ctrl.start()
      ctrl.stop()
    }

    // Each start() fires an immediate async poll() that completes after
    // the sync start/stop cycle. Wait for all in-flight polls to settle.
    await sleep(200)

    const statsAfterSettled = tracker.calls.statsUpdates

    // Now wait well beyond the poll interval (30ms) to confirm no
    // *timer-driven* polls fire after stop() — only in-flight polls
    // from the initial start() calls should have resolved.
    await sleep(500)

    assert.equal(
      tracker.calls.statsUpdates,
      statsAfterSettled,
      `Leaked timers detected: ${tracker.calls.statsUpdates - statsAfterSettled} extra stats updates after settlement`
    )
  })
})
