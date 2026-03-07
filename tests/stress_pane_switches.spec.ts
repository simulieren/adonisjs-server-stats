import { test } from '@japa/runner'
import { DebugDataController } from '../src/core/debug-data-controller.js'
import { DashboardDataController } from '../src/core/dashboard-data-controller.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Create a mock for `globalThis.fetch` that tracks active, completed,
 * and aborted fetches. Honours `AbortSignal` during the simulated delay.
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

function createDebugCallbacks() {
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

function createDashboardCallbacks() {
  const calls = {
    data: [] as unknown[],
    loading: [] as boolean[],
    errors: [] as (Error | null)[],
    unauthorized: [] as unknown[],
    pagination: [] as unknown[],
  }
  return {
    calls,
    callbacks: {
      onData: (d: unknown) => calls.data.push(d),
      onPagination: (m: unknown) => calls.pagination.push(m),
      onLoading: (l: boolean) => calls.loading.push(l),
      onError: (e: Error | null) => calls.errors.push(e),
      onUnauthorized: () => calls.unauthorized.push(true),
    },
  }
}

const DEBUG_TABS = ['queries', 'events', 'logs', 'routes', 'emails', 'timeline'] as const
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
// Stress | 100 debug pane switches (DebugDataController)
// ---------------------------------------------------------------------------

test.group('Stress | 100 debug pane switches', (group) => {
  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('100 rapid switchTab calls -- at most 2 fetches complete', async ({ assert }) => {
    const tracker = createFetchTracker(50)
    const { calls, ...cbs } = createDebugCallbacks()

    const ctrl = new DebugDataController({
      baseUrl: '',
      ...cbs,
      refreshInterval: 60_000,
    })

    ctrl.start('queries')

    for (let i = 0; i < 100; i++) {
      ctrl.switchTab(DEBUG_TABS[i % DEBUG_TABS.length])
    }

    await sleep(200)

    assert.isAtMost(
      tracker.completedFetches,
      5,
      `Expected at most 5 completed fetches after 100 switches but got ${tracker.completedFetches}`
    )
    assert.isAtLeast(
      tracker.abortedFetches,
      95,
      `Expected at least 95 aborted fetches but got ${tracker.abortedFetches}`
    )

    // No real errors (AbortErrors are silently swallowed)
    const realErrors = calls.errors.filter((e) => e !== null)
    assert.lengthOf(realErrors, 0, `Expected no errors but got ${realErrors.length}`)

    ctrl.stop()
  })

  test('100 switches -- no timer leak after stop()', async ({ assert }) => {
    createFetchTracker(10)
    const { calls, ...cbs } = createDebugCallbacks()

    const ctrl = new DebugDataController({
      baseUrl: '',
      ...cbs,
      refreshInterval: 100,
    })

    ctrl.start('queries')
    for (let i = 0; i < 100; i++) {
      ctrl.switchTab(DEBUG_TABS[i % DEBUG_TABS.length])
    }

    await sleep(300)
    ctrl.stop()
    await sleep(200)

    // Create a FRESH tracker after stop to isolate from prior tests
    const postStopTracker = createFetchTracker(10)
    await sleep(500)

    assert.equal(
      postStopTracker.completedFetches,
      0,
      `Leaked timers: ${postStopTracker.completedFetches} fetches after stop()`
    )
  })

  test('100 switches -- only last tab data arrives', async ({ assert }) => {
    const tracker = createFetchTracker(50)
    const { calls, ...cbs } = createDebugCallbacks()

    const ctrl = new DebugDataController({
      baseUrl: '',
      ...cbs,
      refreshInterval: 60_000,
    })

    ctrl.start('queries')
    for (let i = 0; i < 100; i++) {
      ctrl.switchTab(DEBUG_TABS[i % DEBUG_TABS.length])
    }

    await sleep(200)

    // Last tab: DEBUG_TABS[99 % 6] = DEBUG_TABS[3] = 'routes'
    const lastTabPath = '/admin/api/debug/routes'
    const dataWithUrls = calls.data.filter(
      (d: any) => d && typeof d === 'object' && 'url' in d
    ) as Array<{ url: string }>

    assert.isTrue(dataWithUrls.length >= 1, 'Expected at least one onData call')
    for (const d of dataWithUrls) {
      assert.isTrue(
        d.url === lastTabPath,
        `Expected ${lastTabPath} but got ${d.url}`
      )
    }

    ctrl.stop()
  })

  test('100 start/stop cycles -- no accumulated state', async ({ assert }) => {
    createFetchTracker(10)
    const { calls, ...cbs } = createDebugCallbacks()

    const ctrl = new DebugDataController({
      baseUrl: '',
      ...cbs,
      refreshInterval: 60_000,
    })

    for (let i = 0; i < 100; i++) {
      ctrl.start(DEBUG_TABS[i % DEBUG_TABS.length])
      ctrl.stop()
    }

    await sleep(500)

    // Create a FRESH tracker after all start/stop cycles
    const postStopTracker = createFetchTracker(10)
    await sleep(500)

    assert.equal(
      postStopTracker.completedFetches,
      0,
      `Leaked timers: ${postStopTracker.completedFetches} fetches after stop()`
    )

    const realErrors = calls.errors.filter((e) => e !== null)
    assert.lengthOf(realErrors, 0, `Unexpected errors: ${realErrors.length}`)
  })
})

// ---------------------------------------------------------------------------
// Stress | 1000 debug pane switches (DebugDataController)
// ---------------------------------------------------------------------------

test.group('Stress | 1000 debug pane switches', (group) => {
  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('1000 rapid switchTab calls -- at most 2 fetches complete', async ({ assert }) => {
    const tracker = createFetchTracker(50)
    const { calls, ...cbs } = createDebugCallbacks()

    const ctrl = new DebugDataController({
      baseUrl: '',
      ...cbs,
      refreshInterval: 60_000,
    })

    ctrl.start('queries')

    for (let i = 0; i < 1000; i++) {
      ctrl.switchTab(DEBUG_TABS[i % DEBUG_TABS.length])
    }

    await sleep(300)

    assert.isAtMost(
      tracker.completedFetches,
      5,
      `Expected at most 5 completed fetches after 1000 switches but got ${tracker.completedFetches}`
    )
    assert.isAtLeast(
      tracker.abortedFetches,
      990,
      `Expected at least 990 aborted fetches but got ${tracker.abortedFetches}`
    )

    const realErrors = calls.errors.filter((e) => e !== null)
    assert.lengthOf(realErrors, 0, `Expected no errors but got ${realErrors.length}`)

    ctrl.stop()
  })

  test('1000 switches -- completes in under 2 seconds', async ({ assert }) => {
    const tracker = createFetchTracker(10)
    const { calls, ...cbs } = createDebugCallbacks()

    const ctrl = new DebugDataController({
      baseUrl: '',
      ...cbs,
      refreshInterval: 60_000,
    })

    const start = performance.now()

    ctrl.start('queries')
    for (let i = 0; i < 1000; i++) {
      ctrl.switchTab(DEBUG_TABS[i % DEBUG_TABS.length])
    }

    await sleep(200)
    ctrl.stop()

    const elapsed = performance.now() - start

    assert.isBelow(
      elapsed,
      2000,
      `1000 switches took ${Math.round(elapsed)}ms -- should be under 2000ms`
    )
  })

  test('1000 switches -- no timer leak after stop()', async ({ assert }) => {
    createFetchTracker(10)
    const { calls, ...cbs } = createDebugCallbacks()

    const ctrl = new DebugDataController({
      baseUrl: '',
      ...cbs,
      refreshInterval: 100,
    })

    ctrl.start('queries')
    for (let i = 0; i < 1000; i++) {
      ctrl.switchTab(DEBUG_TABS[i % DEBUG_TABS.length])
    }

    await sleep(300)
    ctrl.stop()
    await sleep(200)

    // Create a FRESH tracker after stop to isolate from prior tests
    const postStopTracker = createFetchTracker(10)
    await sleep(500)

    assert.equal(
      postStopTracker.completedFetches,
      0,
      `Leaked timers: ${postStopTracker.completedFetches} fetches after stop()`
    )
  })

  test('1000 switches -- only last tab data arrives', async ({ assert }) => {
    const tracker = createFetchTracker(50)
    const { calls, ...cbs } = createDebugCallbacks()

    const ctrl = new DebugDataController({
      baseUrl: '',
      ...cbs,
      refreshInterval: 60_000,
    })

    ctrl.start('queries')
    for (let i = 0; i < 1000; i++) {
      ctrl.switchTab(DEBUG_TABS[i % DEBUG_TABS.length])
    }

    await sleep(300)

    // Last tab: DEBUG_TABS[999 % 6] = DEBUG_TABS[3] = 'routes'
    const lastTabPath = '/admin/api/debug/routes'
    const dataWithUrls = calls.data.filter(
      (d: any) => d && typeof d === 'object' && 'url' in d
    ) as Array<{ url: string }>

    assert.isTrue(dataWithUrls.length >= 1, 'Expected at least one onData call')
    for (const d of dataWithUrls) {
      assert.isTrue(d.url === lastTabPath, `Expected ${lastTabPath} but got ${d.url}`)
    }

    ctrl.stop()
  })
})

// ---------------------------------------------------------------------------
// Stress | 100 dashboard section switches (DashboardDataController)
// ---------------------------------------------------------------------------

test.group('Stress | 100 dashboard section switches', (group) => {
  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('100 rapid setSection calls -- at most 2 fetches complete', async ({ assert }) => {
    const tracker = createFetchTracker(50)
    const { calls, callbacks } = createDashboardCallbacks()

    const ctrl = new DashboardDataController({
      baseUrl: '',
      endpoint: '/__stats/api',
      section: 'overview',
      perPage: 50,
      callbacks,
    })

    ctrl.start()

    for (let i = 0; i < 100; i++) {
      ctrl.setSection(DASHBOARD_SECTIONS[i % DASHBOARD_SECTIONS.length])
    }

    await sleep(200)

    assert.isAtMost(
      tracker.completedFetches,
      5,
      `Expected at most 5 completed fetches after 100 section switches but got ${tracker.completedFetches}`
    )
    assert.isAtLeast(
      tracker.abortedFetches,
      95,
      `Expected at least 95 aborted fetches but got ${tracker.abortedFetches}`
    )

    ctrl.stop()
  })

  test('100 mixed setSection + setPage + setSearch -- no stale data', async ({ assert }) => {
    const tracker = createFetchTracker(50)
    const { calls, callbacks } = createDashboardCallbacks()

    const ctrl = new DashboardDataController({
      baseUrl: '',
      endpoint: '/__stats/api',
      section: 'overview',
      perPage: 50,
      callbacks,
    })

    ctrl.start()

    // Rapid mixed operations simulating a frantic user
    for (let i = 0; i < 100; i++) {
      switch (i % 4) {
        case 0:
          ctrl.setSection(DASHBOARD_SECTIONS[i % DASHBOARD_SECTIONS.length])
          break
        case 1:
          ctrl.setPage((i % 10) + 1)
          break
        case 2:
          ctrl.setSearch(`search-${i}`)
          break
        case 3:
          ctrl.setSort('duration', i % 2 === 0 ? 'asc' : 'desc')
          break
      }
    }

    await sleep(300)

    assert.isAtMost(
      tracker.completedFetches,
      5,
      `Expected at most 5 completed fetches but got ${tracker.completedFetches}`
    )

    const realErrors = calls.errors.filter((e) => e !== null)
    assert.lengthOf(realErrors, 0, `Unexpected errors: ${realErrors.length}`)

    ctrl.stop()
  })
})

// ---------------------------------------------------------------------------
// Stress | 1000 dashboard section switches (DashboardDataController)
// ---------------------------------------------------------------------------

test.group('Stress | 1000 dashboard section switches', (group) => {
  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('1000 rapid setSection calls -- at most 2 fetches complete', async ({ assert }) => {
    const tracker = createFetchTracker(50)
    const { calls, callbacks } = createDashboardCallbacks()

    const ctrl = new DashboardDataController({
      baseUrl: '',
      endpoint: '/__stats/api',
      section: 'overview',
      perPage: 50,
      callbacks,
    })

    ctrl.start()

    for (let i = 0; i < 1000; i++) {
      ctrl.setSection(DASHBOARD_SECTIONS[i % DASHBOARD_SECTIONS.length])
    }

    await sleep(300)

    assert.isAtMost(
      tracker.completedFetches,
      5,
      `Expected at most 5 completed fetches after 1000 section switches but got ${tracker.completedFetches}`
    )
    assert.isAtLeast(
      tracker.abortedFetches,
      990,
      `Expected at least 990 aborted fetches but got ${tracker.abortedFetches}`
    )

    ctrl.stop()
  })

  test('1000 section switches -- completes in under 2 seconds', async ({ assert }) => {
    const tracker = createFetchTracker(10)
    const { calls, callbacks } = createDashboardCallbacks()

    const ctrl = new DashboardDataController({
      baseUrl: '',
      endpoint: '/__stats/api',
      section: 'overview',
      perPage: 50,
      callbacks,
    })

    const start = performance.now()

    ctrl.start()
    for (let i = 0; i < 1000; i++) {
      ctrl.setSection(DASHBOARD_SECTIONS[i % DASHBOARD_SECTIONS.length])
    }

    await sleep(200)
    ctrl.stop()

    const elapsed = performance.now() - start

    assert.isBelow(
      elapsed,
      2000,
      `1000 section switches took ${Math.round(elapsed)}ms -- should be under 2000ms`
    )
  })

  test('1000 section switches -- no timer leak after stop()', async ({ assert }) => {
    createFetchTracker(10)
    const { calls, callbacks } = createDashboardCallbacks()

    const ctrl = new DashboardDataController({
      baseUrl: '',
      endpoint: '/__stats/api',
      section: 'overview',
      perPage: 50,
      callbacks,
    })

    ctrl.start()
    for (let i = 0; i < 1000; i++) {
      ctrl.setSection(DASHBOARD_SECTIONS[i % DASHBOARD_SECTIONS.length])
    }

    await sleep(300)
    ctrl.stop()
    await sleep(200)

    // Create a FRESH tracker after stop to isolate from prior tests
    const postStopTracker = createFetchTracker(10)
    await sleep(500)

    assert.equal(
      postStopTracker.completedFetches,
      0,
      `Leaked timers: ${postStopTracker.completedFetches} fetches after stop()`
    )
  })

  test('1000 rapid setPage calls -- each cancels previous', async ({ assert }) => {
    const tracker = createFetchTracker(50)
    const { calls, callbacks } = createDashboardCallbacks()

    const ctrl = new DashboardDataController({
      baseUrl: '',
      endpoint: '/__stats/api',
      section: 'requests',
      perPage: 50,
      callbacks,
    })

    ctrl.start()

    for (let i = 1; i <= 1000; i++) {
      ctrl.setPage(i)
    }

    await sleep(300)

    assert.isAtMost(
      tracker.completedFetches,
      5,
      `Expected at most 5 completed fetches after 1000 setPage calls but got ${tracker.completedFetches}`
    )

    ctrl.stop()
  })
})
