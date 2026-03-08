import { test } from '@japa/runner'
import { DebugDataController } from '../src/core/debug-data-controller.js'
import { DashboardDataController } from '../src/core/dashboard-data-controller.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch

interface FetchCounters {
  active: number
  peak: number
  completed: number
  aborted: number
}

function createMockFetchHandler(delayMs: number, c: FetchCounters) {
  return async (url: string | URL | Request, init?: RequestInit) => {
    c.active++
    c.peak = Math.max(c.peak, c.active)

    if (init?.signal?.aborted) {
      c.active--
      c.aborted++
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
      c.active--
      c.completed++
      const urlStr = typeof url === 'string' ? url : url.toString()
      return new Response(JSON.stringify({ url: urlStr, ts: Date.now() }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (err) {
      c.active--
      c.aborted++
      throw err
    }
  }
}

function createFetchTracker(delayMs: number = 50) {
  const c: FetchCounters = { active: 0, peak: 0, completed: 0, aborted: 0 }
  globalThis.fetch = createMockFetchHandler(delayMs, c) as typeof fetch

  return {
    get activeFetches() { return c.active },
    get peakActiveFetches() { return c.peak },
    get completedFetches() { return c.completed },
    get abortedFetches() { return c.aborted },
    get totalFetches() { return c.completed + c.aborted },
  }
}

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const DEBUG_TABS = ['queries', 'events', 'logs', 'routes', 'emails', 'timeline'] as const
const DASHBOARD_SECTIONS = [
  'overview', 'requests', 'queries', 'events', 'emails', 'logs', 'timeline',
] as const

function createDebugCtrl(cbs: Omit<ReturnType<typeof createCallbacks>, 'calls'>) {
  return new DebugDataController({
    baseUrl: '',
    ...cbs,
    refreshInterval: 60_000,
  })
}

function createDashboardCtrl(section = 'overview' as string) {
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
    section,
    perPage: 50,
    callbacks: {
      onData: (d: unknown) => calls.data.push(d),
      onPagination: (m: unknown) => calls.pagination.push(m),
      onLoading: (l: boolean) => calls.loading.push(l),
      onError: (e: Error | null) => calls.errors.push(e),
      onUnauthorized: () => calls.unauthorized.push(true),
    },
  })
  return { ctrl, calls }
}

// ---------------------------------------------------------------------------
// Stress | DebugDataController rapid switching
// ---------------------------------------------------------------------------

test.group('Stress | DebugDataController rapid switching (fetch)', (group) => {
  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('50 rapid tab switches -- only 1-2 fetches complete', async ({ assert }) => {
    const tracker = createFetchTracker(50)
    const { calls, ...cbs } = createCallbacks()
    const ctrl = createDebugCtrl(cbs)

    for (let i = 0; i < 50; i++) {
      ctrl.start(DEBUG_TABS[i % DEBUG_TABS.length])
    }
    await sleep(200)

    assert.isAtMost(tracker.completedFetches, 2)
    assert.isAtLeast(tracker.abortedFetches, 48)

    const lastTabPath = '/admin/api/debug/events'
    const dataWithUrls = calls.data.filter(
      (d: unknown) => d !== null && typeof d === 'object' && 'url' in d
    ) as Array<{ url: string }>
    assert.isTrue(dataWithUrls.length >= 1, 'Expected at least one onData call')
    assert.isTrue(
      dataWithUrls.every((d) => d.url === lastTabPath),
      `Expected all URLs to be ${lastTabPath}`
    )
    ctrl.stop()
  })

  test('100 rapid switchTab calls -- server sees minimal load', async ({ assert }) => {
    const tracker = createFetchTracker(50)
    const { calls: _calls, ...cbs } = createCallbacks()
    const ctrl = createDebugCtrl(cbs)

    ctrl.start('queries')
    for (let i = 0; i < 100; i++) {
      ctrl.switchTab(DEBUG_TABS[i % DEBUG_TABS.length])
    }
    await sleep(200)

    assert.isAtMost(tracker.completedFetches, 2)
    assert.isAtLeast(tracker.abortedFetches, 99)
    ctrl.stop()
  })
})

test.group('Stress | DebugDataController lifecycle (fetch)', (group) => {
  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('start/stop/start/stop rapid cycle -- no leaked timers', async ({ assert }) => {
    const tracker = createFetchTracker(50)
    const { calls, ...cbs } = createCallbacks()
    const ctrl = createDebugCtrl(cbs)

    for (let i = 0; i < 50; i++) {
      ctrl.start(DEBUG_TABS[i % DEBUG_TABS.length])
      ctrl.stop()
    }
    await sleep(500)

    assert.isAtMost(tracker.completedFetches, 2)
    const realErrors = calls.errors.filter((e) => e !== null)
    assert.lengthOf(realErrors, 0)
    ctrl.stop()
  })

  test('rapid refresh() calls do not pile up', async ({ assert }) => {
    const tracker = createFetchTracker(50)
    const { calls: _calls, ...cbs } = createCallbacks()
    const ctrl = createDebugCtrl(cbs)

    ctrl.start('queries')
    for (let i = 0; i < 30; i++) {
      ctrl.refresh()
    }
    await sleep(200)

    assert.isAtMost(tracker.completedFetches, 2)
    ctrl.stop()
  })
})

// ---------------------------------------------------------------------------
// Stress | DashboardDataController rapid switching
// ---------------------------------------------------------------------------

test.group('Stress | DashboardDataController rapid switching (fetch)', (group) => {
  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('50 rapid setSection calls -- minimal server load', async ({ assert }) => {
    const tracker = createFetchTracker(50)
    const { ctrl } = createDashboardCtrl()

    ctrl.start()
    for (let i = 0; i < 50; i++) {
      ctrl.setSection(DASHBOARD_SECTIONS[i % DASHBOARD_SECTIONS.length])
    }
    await sleep(200)

    assert.isAtMost(tracker.completedFetches, 2)
    assert.isAtLeast(tracker.abortedFetches, 48)
    ctrl.stop()
  })

  test('rapid setPage calls -- each cancels previous', async ({ assert }) => {
    const tracker = createFetchTracker(50)
    const { ctrl } = createDashboardCtrl('requests')

    ctrl.start()
    for (let i = 1; i <= 30; i++) {
      ctrl.setPage(i)
    }
    await sleep(200)

    assert.isAtMost(tracker.completedFetches, 2)
    ctrl.stop()
  })
})

test.group('Stress | DashboardDataController mixed ops (fetch)', (group) => {
  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('mixed section changes + filters -- no stale data', async ({ assert }) => {
    createFetchTracker(50)
    const { ctrl, calls } = createDashboardCtrl()

    ctrl.start()
    ctrl.setSection('overview')
    ctrl.setSection('requests')
    ctrl.setSearch('foo')
    ctrl.setPage(2)
    await sleep(200)

    const dataWithUrls = calls.data.filter(
      (d: unknown) => d !== null && typeof d === 'object' && 'url' in d
    ) as Array<{ url: string }>

    if (dataWithUrls.length > 0) {
      const lastUrl = dataWithUrls[dataWithUrls.length - 1].url
      assert.isTrue(lastUrl.includes('/requests'))
      assert.isTrue(lastUrl.includes('search=foo'))
      assert.isTrue(lastUrl.includes('page=2'))
    }

    const realErrors = calls.errors.filter((e) => e !== null)
    assert.lengthOf(realErrors, 0)
    ctrl.stop()
  })
})
