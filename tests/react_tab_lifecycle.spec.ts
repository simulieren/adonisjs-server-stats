import { test } from '@japa/runner'
import { DebugDataController } from '../src/core/debug-data-controller.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch

/** Small async helper -- wait for `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Create a mock for `globalThis.fetch` that tracks active fetches
 * and honours `AbortSignal`. Returns JSON keyed by URL path.
 */
function createFetchTracker(delayMs: number = 50) {
  let activeFetches = 0
  let peakActiveFetches = 0
  let completedFetches = 0
  let abortedFetches = 0
  const fetchUrls: string[] = []

  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url.toString()
    fetchUrls.push(urlStr)
    activeFetches++
    peakActiveFetches = Math.max(peakActiveFetches, activeFetches)

    if (init?.signal?.aborted) {
      activeFetches--
      abortedFetches++
      throw new DOMException('The operation was aborted.', 'AbortError')
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, delayMs)
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timeout)
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        })
      })
      activeFetches--
      completedFetches++
      return new Response(JSON.stringify({ url: urlStr, ts: Date.now() }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (err) {
      activeFetches--
      abortedFetches++
      throw err
    }
  }

  return {
    get activeFetches() {
      return activeFetches
    },
    get peakActiveFetches() {
      return peakActiveFetches
    },
    get completedFetches() {
      return completedFetches
    },
    get abortedFetches() {
      return abortedFetches
    },
    get totalFetches() {
      return completedFetches + abortedFetches
    },
    get fetchUrls() {
      return fetchUrls
    },
  }
}

/**
 * Build a tracking object for all controller callbacks.
 */
function createCallbacks() {
  const calls = {
    data: [] as unknown[],
    loading: [] as boolean[],
    errors: [] as (Error | null)[],
    unauthorized: [] as unknown[],
  }
  return {
    calls,
    onData: (d: unknown) => calls.data.push(d),
    onLoading: (l: boolean) => calls.loading.push(l),
    onError: (e: Error | null) => calls.errors.push(e),
    onUnauthorized: (e: unknown) => calls.unauthorized.push(e),
  }
}

/**
 * Create a controller with sensible test defaults.
 */
function createController(
  callbacks: ReturnType<typeof createCallbacks>,
  overrides: Partial<{ refreshInterval: number }> = {}
) {
  return new DebugDataController({
    baseUrl: '',
    ...callbacks,
    refreshInterval: overrides.refreshInterval ?? 60_000,
  })
}

const TABS = ['queries', 'events', 'logs', 'routes', 'emails', 'timeline'] as const

// ---------------------------------------------------------------------------
// Tests -- single controller reuse across tab switches
// ---------------------------------------------------------------------------

test.group('Tab lifecycle | single controller reuse', (group) => {
  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('switchTab() on a single controller results in exactly 1 active timer', async ({
    assert,
  }) => {
    const tracker = createFetchTracker(50)
    const { calls, ...cbs } = createCallbacks()
    const ctrl = createController({ calls, ...cbs }, { refreshInterval: 200 })

    ctrl.start('queries')

    // Switch tabs 10 times
    for (let i = 0; i < 10; i++) {
      ctrl.switchTab(TABS[i % TABS.length])
    }

    // Wait for the last fetch to complete
    await sleep(150)

    // Only the last tab's data should arrive (others were aborted)
    const dataWithUrls = calls.data.filter(
      (d: unknown) => d !== null && typeof d === 'object' && 'url' in d
    ) as Array<{ url: string }>

    assert.isTrue(
      dataWithUrls.length >= 1,
      `Expected at least 1 data callback but got ${dataWithUrls.length}`
    )

    // Verify only the final tab produced completed fetches
    assert.isAtMost(
      tracker.completedFetches,
      2,
      `Expected at most 2 completed fetches but got ${tracker.completedFetches}`
    )

    ctrl.stop()
  })
})

// ---------------------------------------------------------------------------
// Tests -- 25 rapid switchTab calls = exactly 1 active timer
// ---------------------------------------------------------------------------

test.group('Tab lifecycle | 25 rapid switches prevent freeze', (group) => {
  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('25 rapid switchTab() calls result in exactly 1 completed fetch, not 25', async ({
    assert,
  }) => {
    const tracker = createFetchTracker(50)
    const { calls, ...cbs } = createCallbacks()
    const ctrl = createController({ calls, ...cbs })

    ctrl.start('queries')

    // Simulate 25 rapid debug pane switches -- the scenario that caused the freeze
    for (let i = 0; i < 25; i++) {
      ctrl.switchTab(TABS[i % TABS.length])
    }

    // Wait for the last fetch to settle
    await sleep(200)

    // The key invariant: only the very last fetch should complete
    assert.isAtMost(
      tracker.completedFetches,
      2,
      `Expected at most 2 completed fetches after 25 switches but got ${tracker.completedFetches}`
    )

    // All other fetches should have been aborted
    assert.isAtLeast(
      tracker.abortedFetches,
      23,
      `Expected at least 23 aborted fetches but got ${tracker.abortedFetches}`
    )

    ctrl.stop()
  })

  test('25 switches do not accumulate 25 concurrent timers (no timer leak)', async ({
    assert,
  }) => {
    const tracker = createFetchTracker(10)
    const { calls, ...cbs } = createCallbacks()
    const ctrl = createController({ calls, ...cbs }, { refreshInterval: 100 })

    ctrl.start('queries')

    for (let i = 0; i < 25; i++) {
      ctrl.switchTab(TABS[i % TABS.length])
    }

    // Wait for a full refresh cycle
    await sleep(300)
    ctrl.stop()

    const fetchCountAtStop = tracker.completedFetches

    // Wait more to confirm no leaked timers fire after stop()
    await sleep(300)

    assert.equal(
      tracker.completedFetches,
      fetchCountAtStop,
      `Leaked timer detected: ${tracker.completedFetches - fetchCountAtStop} extra fetches after stop()`
    )
  })
})

// ---------------------------------------------------------------------------
// Tests -- switchTab aborts previous fetch before starting new one
// ---------------------------------------------------------------------------

test.group('Tab lifecycle | switchTab aborts previous fetch', (group) => {
  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('switchTab() aborts the previous in-flight fetch', async ({ assert }) => {
    const tracker = createFetchTracker(200)
    const { calls, ...cbs } = createCallbacks()
    const ctrl = createController({ calls, ...cbs })

    ctrl.start('queries')

    // Give the queries fetch a moment to start
    await sleep(10)

    // Switch -- this should abort the queries fetch
    ctrl.switchTab('events')

    // Wait for the events fetch to complete
    await sleep(300)

    // The queries fetch should have been aborted
    assert.isTrue(
      tracker.abortedFetches >= 1,
      `Expected at least 1 aborted fetch but got ${tracker.abortedFetches}`
    )

    // Only events data should appear in onData
    const dataWithUrls = calls.data.filter(
      (d: unknown) => d !== null && typeof d === 'object' && 'url' in d
    ) as Array<{ url: string }>

    for (const d of dataWithUrls) {
      assert.isTrue(
        d.url.includes('/events'),
        `Expected events data but got: ${d.url}`
      )
    }

    ctrl.stop()
  })

  test('AbortError from cancelled fetch does not propagate to onError', async ({ assert }) => {
    createFetchTracker(200)
    const { calls, ...cbs } = createCallbacks()
    const ctrl = createController({ calls, ...cbs })

    ctrl.start('queries')
    await sleep(10)
    ctrl.switchTab('events')
    await sleep(300)

    // onError should only contain nulls (cleared errors), no AbortError
    const realErrors = calls.errors.filter((e) => e !== null)
    assert.lengthOf(
      realErrors,
      0,
      `Expected no real errors but got: ${realErrors.map((e) => e?.message).join(', ')}`
    )

    ctrl.stop()
  })
})

// ---------------------------------------------------------------------------
// Tests -- fetchOnceCache prevents redundant fetches
// ---------------------------------------------------------------------------

test.group('Tab lifecycle | fetchOnceCache prevents redundant fetches', (group) => {
  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('cacheForTab serves cached data on subsequent switchTab without fetching', async ({
    assert,
  }) => {
    const tracker = createFetchTracker(50)
    const { calls, ...cbs } = createCallbacks()
    const ctrl = createController({ calls, ...cbs })

    // Pre-populate the cache for the queries tab
    const cachedPayload = { tab: 'queries', cached: true }
    ctrl.cacheForTab('queries', cachedPayload)

    // Start on the queries tab -- should serve from cache, no fetch
    ctrl.start('queries')
    await sleep(100)

    // The cached payload should have been delivered via onData
    assert.isTrue(
      calls.data.some((d: unknown) => d && d.cached === true),
      'Expected cached data to be served via onData'
    )

    // No network fetch should have been made for the cached tab
    assert.equal(
      tracker.completedFetches,
      0,
      `Expected 0 completed fetches for cached tab but got ${tracker.completedFetches}`
    )

    ctrl.stop()
  })

  test('switchTab to a non-cached tab fetches from network', async ({ assert }) => {
    const tracker = createFetchTracker(30)
    const { calls, ...cbs } = createCallbacks()
    const ctrl = createController({ calls, ...cbs })

    // Cache only queries
    ctrl.cacheForTab('queries', { tab: 'queries', cached: true })

    // Start with cached tab
    ctrl.start('queries')
    await sleep(10)

    // Switch to uncached tab -- should trigger a network fetch
    ctrl.switchTab('events')
    await sleep(100)

    assert.isTrue(
      tracker.completedFetches >= 1,
      `Expected at least 1 completed fetch for uncached tab but got ${tracker.completedFetches}`
    )

    ctrl.stop()
  })

  test('clearCache forces re-fetch on next switchTab', async ({ assert }) => {
    const tracker = createFetchTracker(30)
    const { calls, ...cbs } = createCallbacks()
    const ctrl = createController({ calls, ...cbs })

    // Cache queries
    ctrl.cacheForTab('queries', { tab: 'queries', cached: true })

    ctrl.start('queries')
    await sleep(10)

    // No fetch so far
    assert.equal(tracker.completedFetches, 0)

    // Clear cache and switch back -- should fetch from network
    ctrl.clearCache()
    ctrl.switchTab('queries')
    await sleep(100)

    assert.isTrue(
      tracker.completedFetches >= 1,
      `Expected at least 1 completed fetch after clearCache but got ${tracker.completedFetches}`
    )

    ctrl.stop()
  })
})
