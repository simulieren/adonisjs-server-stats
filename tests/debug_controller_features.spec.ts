import { test } from '@japa/runner'
import DebugController from '../src/controller/debug_controller.js'

import type { ResolvedServerStatsConfig } from '../src/types.js'
import type { MetricCollector } from '../src/collectors/collector.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal ResolvedServerStatsConfig with sensible defaults.
 */
function buildServerConfig(
  overrides: Partial<ResolvedServerStatsConfig> = {}
): ResolvedServerStatsConfig {
  return {
    intervalMs: 3000,
    transport: 'transmit',
    channelName: 'admin/server-stats',
    endpoint: '/admin/api/server-stats',
    collectors: 'auto',
    skipInTest: true,
    verbose: false,
    ...overrides,
  }
}

/**
 * Create a fake collector with the given name (used for explicit collector arrays).
 */
function fakeCollector(name: string): MetricCollector {
  return {
    name,
    collect: async () => ({}),
  } as MetricCollector
}

/**
 * Minimal DebugStore mock — only getBufferStats() is called by DebugController.
 */
function createMockDebugStore() {
  return {
    getBufferStats() {
      return {
        queries: { current: 0, max: 100 },
        events: { current: 0, max: 100 },
        emails: { current: 0, max: 100 },
        traces: { current: 0, max: 0 },
      }
    },
  } as unknown as Record<string, unknown>
}

/**
 * Fake HttpContext that captures response.json() calls.
 */
function createMockHttpContext() {
  let captured: unknown = null
  return {
    ctx: {
      response: {
        json(data: unknown) {
          captured = data
          return data
        },
      },
    } as unknown as Record<string, unknown>,
    getCaptured: () => captured as unknown,
  }
}

// ---------------------------------------------------------------------------
// Feature flags from DebugController.config()
// ---------------------------------------------------------------------------

const COLLECTOR_FEATURE_KEYS = [
  'process',
  'system',
  'http',
  'db',
  'redis',
  'queues',
  'cache',
  'app',
  'log',
] as const

test.group('DebugController.config() | collectors: "auto" (default)', () => {
  test('all collector-dependent features are true', async ({ assert }) => {
    const store = createMockDebugStore()
    const serverConfig = buildServerConfig({ collectors: 'auto' })
    const controller = new DebugController(store, serverConfig)

    const { ctx, getCaptured } = createMockHttpContext()
    await controller.config(ctx)

    const { features } = getCaptured()

    for (const key of COLLECTOR_FEATURE_KEYS) {
      assert.isTrue(features[key], `features.${key} should be true when collectors is 'auto'`)
    }
  })

  test('statsBar is always true', async ({ assert }) => {
    const store = createMockDebugStore()
    const serverConfig = buildServerConfig({ collectors: 'auto' })
    const controller = new DebugController(store, serverConfig)

    const { ctx, getCaptured } = createMockHttpContext()
    await controller.config(ctx)

    const { features } = getCaptured()
    assert.isTrue(features.statsBar)
  })

  test('debugPanel and emails reflect devToolbar.enabled', async ({ assert }) => {
    const store = createMockDebugStore()
    const serverConfig = buildServerConfig({
      collectors: 'auto',
      devToolbar: {
        enabled: true,
        tracing: false,
        dashboard: false,
      },
    })
    const controller = new DebugController(store, serverConfig)

    const { ctx, getCaptured } = createMockHttpContext()
    await controller.config(ctx)

    const { features } = getCaptured()
    assert.isTrue(features.debugPanel)
    assert.isTrue(features.emails)
  })

  test('dashboard and tracing reflect devToolbar settings', async ({ assert }) => {
    const store = createMockDebugStore()
    const serverConfig = buildServerConfig({
      collectors: 'auto',
      devToolbar: {
        enabled: true,
        tracing: true,
        dashboard: true,
      },
    })
    const controller = new DebugController(store, serverConfig)

    const { ctx, getCaptured } = createMockHttpContext()
    await controller.config(ctx)

    const { features } = getCaptured()
    assert.isTrue(features.dashboard)
    assert.isTrue(features.tracing)
  })
})

test.group('DebugController.config() | collectors: [specific list]', () => {
  test('only listed collectors have true flags', async ({ assert }) => {
    const store = createMockDebugStore()
    const serverConfig = buildServerConfig({
      collectors: [fakeCollector('process'), fakeCollector('http'), fakeCollector('redis')],
    })
    const controller = new DebugController(store, serverConfig)

    const { ctx, getCaptured } = createMockHttpContext()
    await controller.config(ctx)

    const { features } = getCaptured()

    // Enabled collectors
    assert.isTrue(features.process, 'process should be true')
    assert.isTrue(features.http, 'http should be true')
    assert.isTrue(features.redis, 'redis should be true')
    // cache also maps to "redis" collector name
    assert.isTrue(features.cache, 'cache should be true (maps to redis collector)')

    // Collectors NOT in the list
    assert.isFalse(features.system, 'system should be false')
    assert.isFalse(features.db, 'db should be false (db_pool not in list)')
    assert.isFalse(features.queues, 'queues should be false')
    assert.isFalse(features.app, 'app should be false')
    assert.isFalse(features.log, 'log should be false')
  })

  test('db flag maps to db_pool collector name', async ({ assert }) => {
    const store = createMockDebugStore()
    const serverConfig = buildServerConfig({
      collectors: [fakeCollector('db_pool')],
    })
    const controller = new DebugController(store, serverConfig)

    const { ctx, getCaptured } = createMockHttpContext()
    await controller.config(ctx)

    const { features } = getCaptured()
    assert.isTrue(features.db, 'db should be true when db_pool collector is present')
  })

  test('queues flag maps to queue collector name', async ({ assert }) => {
    const store = createMockDebugStore()
    const serverConfig = buildServerConfig({
      collectors: [fakeCollector('queue')],
    })
    const controller = new DebugController(store, serverConfig)

    const { ctx, getCaptured } = createMockHttpContext()
    await controller.config(ctx)

    const { features } = getCaptured()
    assert.isTrue(features.queues, 'queues should be true when queue collector is present')
  })

  test('single collector enables only its corresponding feature', async ({ assert }) => {
    const store = createMockDebugStore()
    const serverConfig = buildServerConfig({
      collectors: [fakeCollector('system')],
    })
    const controller = new DebugController(store, serverConfig)

    const { ctx, getCaptured } = createMockHttpContext()
    await controller.config(ctx)

    const { features } = getCaptured()
    assert.isTrue(features.system, 'system should be true')
    assert.isFalse(features.process, 'process should be false')
    assert.isFalse(features.http, 'http should be false')
    assert.isFalse(features.db, 'db should be false')
    assert.isFalse(features.redis, 'redis should be false')
    assert.isFalse(features.queues, 'queues should be false')
    assert.isFalse(features.cache, 'cache should be false')
    assert.isFalse(features.app, 'app should be false')
    assert.isFalse(features.log, 'log should be false')
  })

  test('all collectors listed enables all features', async ({ assert }) => {
    const store = createMockDebugStore()
    const serverConfig = buildServerConfig({
      collectors: [
        fakeCollector('process'),
        fakeCollector('system'),
        fakeCollector('http'),
        fakeCollector('db_pool'),
        fakeCollector('redis'),
        fakeCollector('queue'),
        fakeCollector('app'),
        fakeCollector('log'),
      ],
    })
    const controller = new DebugController(store, serverConfig)

    const { ctx, getCaptured } = createMockHttpContext()
    await controller.config(ctx)

    const { features } = getCaptured()

    for (const key of COLLECTOR_FEATURE_KEYS) {
      assert.isTrue(features[key], `features.${key} should be true when all collectors are listed`)
    }
  })
})

test.group('DebugController.config() | collectors: [] (empty array)', () => {
  test('all collector-dependent features are false', async ({ assert }) => {
    const store = createMockDebugStore()
    const serverConfig = buildServerConfig({
      collectors: [],
    })
    const controller = new DebugController(store, serverConfig)

    const { ctx, getCaptured } = createMockHttpContext()
    await controller.config(ctx)

    const { features } = getCaptured()

    for (const key of COLLECTOR_FEATURE_KEYS) {
      assert.isFalse(
        features[key],
        `features.${key} should be false when collectors is an empty array`
      )
    }
  })

  test('statsBar is still true even with empty collectors', async ({ assert }) => {
    const store = createMockDebugStore()
    const serverConfig = buildServerConfig({
      collectors: [],
    })
    const controller = new DebugController(store, serverConfig)

    const { ctx, getCaptured } = createMockHttpContext()
    await controller.config(ctx)

    const { features } = getCaptured()
    assert.isTrue(features.statsBar)
  })

  test('debugPanel and emails still depend on devToolbar.enabled', async ({ assert }) => {
    const store = createMockDebugStore()
    const serverConfig = buildServerConfig({
      collectors: [],
      devToolbar: {
        enabled: true,
        tracing: false,
        dashboard: false,
      },
    })
    const controller = new DebugController(store, serverConfig)

    const { ctx, getCaptured } = createMockHttpContext()
    await controller.config(ctx)

    const { features } = getCaptured()
    assert.isTrue(features.debugPanel, 'debugPanel should be true when devToolbar.enabled is true')
    assert.isTrue(features.emails, 'emails should be true when devToolbar.enabled is true')
  })
})

test.group('DebugController.config() | no serverConfig', () => {
  test('all collector-dependent features are false when serverConfig is undefined', async ({
    assert,
  }) => {
    const store = createMockDebugStore()
    const controller = new DebugController(store, undefined)

    const { ctx, getCaptured } = createMockHttpContext()
    await controller.config(ctx)

    const { features } = getCaptured()

    for (const key of COLLECTOR_FEATURE_KEYS) {
      assert.isFalse(
        features[key],
        `features.${key} should be false when serverConfig is undefined`
      )
    }

    assert.isFalse(features.debugPanel)
    assert.isFalse(features.dashboard)
    assert.isFalse(features.tracing)
    assert.isFalse(features.emails)
    assert.isTrue(features.statsBar, 'statsBar should always be true')
  })
})
