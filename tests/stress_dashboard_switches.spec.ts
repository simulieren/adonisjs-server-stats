import { test } from '@japa/runner'
import { DashboardDataController } from '../src/core/dashboard-data-controller.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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

const DASHBOARD_SECTIONS = [
  'overview', 'requests', 'queries', 'events', 'emails', 'logs', 'timeline',
] as const

function createDashboardCtrl(
  callbacks: ReturnType<typeof createDashboardCallbacks>['callbacks'],
  section = 'overview' as string
) {
  return new DashboardDataController({
    baseUrl: '',
    endpoint: '/__stats/api',
    section,
    perPage: 50,
    callbacks,
  })
}

// ---------------------------------------------------------------------------
// Stress | 100 dashboard section switches
// ---------------------------------------------------------------------------

test.group('Stress | 100 dashboard section switches', (group) => {
  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('100 rapid setSection calls -- at most 5 fetches', async ({ assert }) => {
    const tracker = createFetchTracker(50)
    const { calls: _calls, callbacks } = createDashboardCallbacks()
    const ctrl = createDashboardCtrl(callbacks)

    ctrl.start()
    for (let i = 0; i < 100; i++) {
      ctrl.setSection(DASHBOARD_SECTIONS[i % DASHBOARD_SECTIONS.length])
    }
    await sleep(200)

    assert.isAtMost(tracker.completedFetches, 5)
    assert.isAtLeast(tracker.abortedFetches, 95)
    ctrl.stop()
  })
})

test.group('Stress | 100 dashboard mixed operations', (group) => {
  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('100 mixed setSection + setPage + setSearch', async ({ assert }) => {
    const tracker = createFetchTracker(50)
    const { calls, callbacks } = createDashboardCallbacks()
    const ctrl = createDashboardCtrl(callbacks)
    ctrl.start()

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

    assert.isAtMost(tracker.completedFetches, 5)
    const realErrors = calls.errors.filter((e) => e !== null)
    assert.lengthOf(realErrors, 0)
    ctrl.stop()
  })
})

// ---------------------------------------------------------------------------
// Stress | 1000 dashboard section switches
// ---------------------------------------------------------------------------

test.group('Stress | 1000 dashboard section switches', (group) => {
  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('1000 rapid setSection calls -- at most 5 fetches', async ({ assert }) => {
    const tracker = createFetchTracker(50)
    const { calls: _calls, callbacks } = createDashboardCallbacks()
    const ctrl = createDashboardCtrl(callbacks)

    ctrl.start()
    for (let i = 0; i < 1000; i++) {
      ctrl.setSection(DASHBOARD_SECTIONS[i % DASHBOARD_SECTIONS.length])
    }
    await sleep(300)

    assert.isAtMost(tracker.completedFetches, 5)
    assert.isAtLeast(tracker.abortedFetches, 990)
    ctrl.stop()
  })

  test('1000 section switches -- under 2 seconds', async ({ assert }) => {
    const _tracker = createFetchTracker(10)
    const { calls: _calls, callbacks } = createDashboardCallbacks()
    const ctrl = createDashboardCtrl(callbacks)

    const start = performance.now()
    ctrl.start()
    for (let i = 0; i < 1000; i++) {
      ctrl.setSection(DASHBOARD_SECTIONS[i % DASHBOARD_SECTIONS.length])
    }
    await sleep(200)
    ctrl.stop()

    assert.isBelow(performance.now() - start, 2000)
  })
})

test.group('Stress | 1000 dashboard (leaks & pagination)', (group) => {
  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('1000 section switches -- no timer leak', async ({ assert }) => {
    createFetchTracker(10)
    const { calls: _calls, callbacks } = createDashboardCallbacks()
    const ctrl = createDashboardCtrl(callbacks)

    ctrl.start()
    for (let i = 0; i < 1000; i++) {
      ctrl.setSection(DASHBOARD_SECTIONS[i % DASHBOARD_SECTIONS.length])
    }

    await sleep(300)
    ctrl.stop()
    await sleep(200)

    const postStopTracker = createFetchTracker(10)
    await sleep(500)
    assert.equal(postStopTracker.completedFetches, 0)
  })

  test('1000 rapid setPage calls -- each cancels previous', async ({ assert }) => {
    const tracker = createFetchTracker(50)
    const { calls: _calls, callbacks } = createDashboardCallbacks()
    const ctrl = createDashboardCtrl(callbacks, 'requests')

    ctrl.start()
    for (let i = 1; i <= 1000; i++) {
      ctrl.setPage(i)
    }
    await sleep(300)

    assert.isAtMost(tracker.completedFetches, 5)
    ctrl.stop()
  })
})
