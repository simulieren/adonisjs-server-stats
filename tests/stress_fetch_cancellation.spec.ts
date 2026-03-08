import { test } from '@japa/runner'
import { DebugDataController } from '../src/core/debug-data-controller.js'
import { DashboardDataController } from '../src/core/dashboard-data-controller.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch

/**
 * Create a mock for `globalThis.fetch` that tracks active, completed,
 * and aborted fetches.  Simulates network latency with `delayMs` and
 * honours `AbortSignal` during the wait.
 */
function createFetchTracker(delayMs: number = 50) {
  let activeFetches = 0
  let peakActiveFetches = 0
  let completedFetches = 0
  let abortedFetches = 0

  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
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
      const urlStr = typeof url === 'string' ? url : url.toString()
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
 * Small async helper -- wait for `ms` milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Debug tabs to cycle through during stress tests
const DEBUG_TABS = ['queries', 'events', 'logs', 'routes', 'emails', 'timeline'] as const

// Dashboard sections to cycle through during stress tests
const DASHBOARD_SECTIONS = [
  'overview',
  'requests',
  'queries',
  'events',
  'emails',
  'logs',
  'timeline',
] as const

// ---------------------------------------------------------------------------
// Stress | DebugDataController rapid switching
// ---------------------------------------------------------------------------

test.group('Stress | DebugDataController rapid switching', (group) => {
  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('50 rapid tab switches -- only 1-2 fetches complete', async ({ assert }) => {
    const tracker = createFetchTracker(50)
    const { calls: _calls, ...cbs } = createCallbacks()

    const ctrl = new DebugDataController({
      baseUrl: '',
      ...cbs,
      refreshInterval: 60_000,
    })

    // Fire 50 start() calls in rapid succession alternating tabs
    for (let i = 0; i < 50; i++) {
      ctrl.start(DEBUG_TABS[i % DEBUG_TABS.length])
    }

    // Wait for everything to settle
    await sleep(200)

    assert.isAtMost(
      tracker.completedFetches,
      2,
      `Expected at most 2 completed fetches but got ${tracker.completedFetches}`
    )
    assert.isAtLeast(
      tracker.abortedFetches,
      48,
      `Expected at least 48 aborted fetches but got ${tracker.abortedFetches}`
    )

    // onData should only have been called with the LAST tab's data
    // The last tab is DEBUG_TABS[49 % 6] = DEBUG_TABS[1] = 'events'
    const lastTabPath = '/admin/api/debug/events'
    const dataWithUrls = calls.data.filter(
      (d: unknown) => d !== null && typeof d === 'object' && 'url' in d
    ) as Array<{ url: string }>
    assert.isTrue(
      dataWithUrls.length >= 1,
      'Expected at least one onData call with a URL'
    )
    assert.isTrue(
      dataWithUrls.every((d) => d.url === lastTabPath),
      `Expected all onData calls to have URL ${lastTabPath} but got: ${dataWithUrls.map((d) => d.url).join(', ')}`
    )

    ctrl.stop()
  })

  test('100 rapid switchTab calls -- server sees minimal load', async ({ assert }) => {
    const tracker = createFetchTracker(50)
    const { calls: _calls, ...cbs } = createCallbacks()

    const ctrl = new DebugDataController({
      baseUrl: '',
      ...cbs,
      refreshInterval: 60_000,
    })

    // Start on an initial tab
    ctrl.start('queries')

    // Call switchTab() 100 times in a tight loop alternating between tabs
    for (let i = 0; i < 100; i++) {
      ctrl.switchTab(DEBUG_TABS[i % DEBUG_TABS.length])
    }

    // Wait for settlement
    await sleep(200)

    // All synchronous switchTab calls queue up globalThis.fetch entries
    // before any abort handlers fire (microtask queue). The key invariant
    // is that only the very last fetch actually completes -- the rest are
    // aborted once the event loop processes abort signals.
    assert.isAtMost(
      tracker.completedFetches,
      2,
      `Expected at most 2 completed fetches but got ${tracker.completedFetches}`
    )
    assert.isAtLeast(
      tracker.abortedFetches,
      99,
      `Expected at least 99 aborted fetches but got ${tracker.abortedFetches}`
    )

    ctrl.stop()
  })

  test('start/stop/start/stop rapid cycle -- no leaked timers', async ({ assert }) => {
    const tracker = createFetchTracker(50)
    const { calls: _calls, ...cbs } = createCallbacks()

    const ctrl = new DebugDataController({
      baseUrl: '',
      ...cbs,
      refreshInterval: 60_000,
    })

    // Call start/stop 50 times in a loop
    for (let i = 0; i < 50; i++) {
      ctrl.start(DEBUG_TABS[i % DEBUG_TABS.length])
      ctrl.stop()
    }

    // Wait to make sure no timers fire
    await sleep(500)

    // Most fetches were aborted because stop() aborts the in-flight fetch
    assert.isAtMost(
      tracker.completedFetches,
      2,
      `Expected at most 2 completed fetches but got ${tracker.completedFetches}`
    )

    // No real errors should be reported (AbortErrors are silently swallowed)
    const realErrors = calls.errors.filter((e) => e !== null)
    assert.lengthOf(
      realErrors,
      0,
      `Expected no errors but got: ${realErrors.map((e) => e?.message).join(', ')}`
    )

    ctrl.stop()
  })

  test('rapid refresh() calls do not pile up', async ({ assert }) => {
    const tracker = createFetchTracker(50)
    const { calls: _calls, ...cbs } = createCallbacks()

    const ctrl = new DebugDataController({
      baseUrl: '',
      ...cbs,
      refreshInterval: 60_000,
    })

    // Start controller on a tab
    ctrl.start('queries')

    // Call refresh() 30 times synchronously
    for (let i = 0; i < 30; i++) {
      ctrl.refresh()
    }

    // Wait for settlement
    await sleep(200)

    // Each refresh cancels the previous, so at most 2 should complete
    assert.isAtMost(
      tracker.completedFetches,
      2,
      `Expected at most 2 completed fetches but got ${tracker.completedFetches}`
    )

    ctrl.stop()
  })
})

// ---------------------------------------------------------------------------
// Stress | DashboardDataController rapid switching
// ---------------------------------------------------------------------------

test.group('Stress | DashboardDataController rapid switching', (group) => {
  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('50 rapid setSection calls -- minimal server load', async ({ assert }) => {
    const tracker = createFetchTracker(50)

    const calls = {
      data: [] as unknown[],
      loading: [] as boolean[],
      errors: [] as (Error | null)[],
      unauthorized: [] as unknown[],
      pagination: [] as unknown[],
    }

    const ctrl = new DashboardDataController({
      baseUrl: '',
      endpoint: '/__stats/api',
      section: 'overview',
      perPage: 50,
      callbacks: {
        onData: (d: unknown) => calls.data.push(d),
        onPagination: (m: unknown) => calls.pagination.push(m),
        onLoading: (l: boolean) => calls.loading.push(l),
        onError: (e: Error | null) => calls.errors.push(e),
        onUnauthorized: () => calls.unauthorized.push(true),
      },
    })

    ctrl.start()

    // Call setSection() 50 times with different sections
    for (let i = 0; i < 50; i++) {
      ctrl.setSection(DASHBOARD_SECTIONS[i % DASHBOARD_SECTIONS.length])
    }

    // Wait for settlement
    await sleep(200)

    // All synchronous setSection calls queue up globalThis.fetch entries
    // before any abort handlers fire (microtask queue). The key invariant
    // is that only the very last fetch actually completes -- the rest are
    // aborted once the event loop processes abort signals.
    assert.isAtMost(
      tracker.completedFetches,
      2,
      `Expected at most 2 completed fetches but got ${tracker.completedFetches}`
    )
    assert.isAtLeast(
      tracker.abortedFetches,
      48,
      `Expected at least 48 aborted fetches but got ${tracker.abortedFetches}`
    )

    ctrl.stop()
  })

  test('rapid setPage/setSearch/setSort -- each cancels previous', async ({ assert }) => {
    const tracker = createFetchTracker(50)

    const calls = {
      data: [] as unknown[],
      loading: [] as boolean[],
      errors: [] as (Error | null)[],
      unauthorized: [] as unknown[],
      pagination: [] as unknown[],
    }

    const ctrl = new DashboardDataController({
      baseUrl: '',
      endpoint: '/__stats/api',
      section: 'requests',
      perPage: 50,
      callbacks: {
        onData: (d: unknown) => calls.data.push(d),
        onPagination: (m: unknown) => calls.pagination.push(m),
        onLoading: (l: boolean) => calls.loading.push(l),
        onError: (e: Error | null) => calls.errors.push(e),
        onUnauthorized: () => calls.unauthorized.push(true),
      },
    })

    ctrl.start()

    // Call setPage(1), setPage(2), ..., setPage(30) rapidly
    for (let i = 1; i <= 30; i++) {
      ctrl.setPage(i)
    }

    // Wait for settlement
    await sleep(200)

    assert.isAtMost(
      tracker.completedFetches,
      2,
      `Expected at most 2 completed fetches but got ${tracker.completedFetches}`
    )

    ctrl.stop()
  })

  test('mixed section changes + filters -- no stale data', async ({ assert }) => {
    const _tracker = createFetchTracker(50)

    const calls = {
      data: [] as unknown[],
      loading: [] as boolean[],
      errors: [] as (Error | null)[],
      unauthorized: [] as unknown[],
      pagination: [] as unknown[],
    }

    const ctrl = new DashboardDataController({
      baseUrl: '',
      endpoint: '/__stats/api',
      section: 'overview',
      perPage: 50,
      callbacks: {
        onData: (d: unknown) => calls.data.push(d),
        onPagination: (m: unknown) => calls.pagination.push(m),
        onLoading: (l: boolean) => calls.loading.push(l),
        onError: (e: Error | null) => calls.errors.push(e),
        onUnauthorized: () => calls.unauthorized.push(true),
      },
    })

    ctrl.start()

    // Rapid mixed operations
    ctrl.setSection('overview')
    ctrl.setSection('requests')
    ctrl.setSearch('foo')
    ctrl.setPage(2)

    // Wait for settlement
    await sleep(200)

    // onData may have null entries from setSection resets -- filter those out
    const dataWithUrls = calls.data.filter(
      (d: unknown) => d !== null && typeof d === 'object' && 'url' in d
    ) as Array<{ url: string }>

    // The final state should be: section=requests, page=2, search=foo
    // The URL should be /__stats/api/requests?page=2&perPage=50&search=foo
    if (dataWithUrls.length > 0) {
      const lastUrl = dataWithUrls[dataWithUrls.length - 1].url
      assert.isTrue(
        lastUrl.includes('/requests'),
        `Expected final URL to include /requests but got: ${lastUrl}`
      )
      assert.isTrue(
        lastUrl.includes('search=foo'),
        `Expected final URL to include search=foo but got: ${lastUrl}`
      )
      assert.isTrue(
        lastUrl.includes('page=2'),
        `Expected final URL to include page=2 but got: ${lastUrl}`
      )
    }

    // Verify no real errors
    const realErrors = calls.errors.filter((e) => e !== null)
    assert.lengthOf(
      realErrors,
      0,
      `Expected no errors but got: ${realErrors.map((e) => e?.message).join(', ')}`
    )

    ctrl.stop()
  })
})
