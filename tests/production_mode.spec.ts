import { test } from '@japa/runner'
import { defineConfig } from '../src/define_config.js'
import { registerAllRoutes } from '../src/routes/register_routes.js'
import { resolveToolbarConfig } from '../src/provider/dashboard_setup.js'
import { DebugStore } from '../src/debug/debug_store.js'

import type { RegisterRoutesOptions } from '../src/routes/register_routes.js'
import type { AdonisRouter } from '../src/routes/router_types.js'

/**
 * Router double that records the groups created during registration. Modeled on
 * the one in `domain_routing.spec.ts`.
 */
function makeFakeRouter() {
  const groups: Array<{ prefix?: string }> = []
  const routes: string[] = []

  const route = { as: () => route, where: () => route, use: () => route }
  const group = {
    prefix(path: string) {
      groups[groups.length - 1].prefix = path
      return group
    },
    domain: () => group,
    use: () => group,
  }

  const router = {
    get: (p: string) => (routes.push(p), route),
    post: (p: string) => (routes.push(p), route),
    delete: (p: string) => (routes.push(p), route),
    group(callback: () => void) {
      groups.push({})
      callback()
      return group
    },
  }

  return { router: router as unknown as AdonisRouter, groups, routes }
}

function baseOptions(router: AdonisRouter): RegisterRoutesOptions {
  return {
    router,
    getApiController: () => null,
    getStatsController: () => null,
    getDebugController: () => null,
    getDashboardController: () => null,
    statsEndpoint: '/admin/api/server-stats',
    debugEndpoint: '/admin/api/debug',
    dashboardPath: '/__stats',
  }
}

/** Emitter double that records which events were subscribed to. */
function makeFakeEmitter() {
  const listened: string[] = []
  return {
    listened,
    emitter: {
      on(event: string) {
        listened.push(event)
      },
      emit: async () => {},
    },
  }
}

function silenceWarnings(): { restore: () => void; messages: string[] } {
  const messages: string[] = []
  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => messages.push(args.join(' '))
  return {
    messages,
    restore: () => {
      console.warn = originalWarn
    },
  }
}

test.group('production config resolution', () => {
  test('production is absent unless configured', ({ assert }) => {
    assert.isUndefined(defineConfig({}).production)
  })

  test('production passes through to the resolved config', ({ assert }) => {
    const config = defineConfig({
      authorize: () => true,
      dashboard: true,
      production: { enabled: true, capture: { queries: true }, retentionDays: 5 },
    })

    assert.deepEqual(config.production, {
      enabled: true,
      capture: { queries: true },
      retentionDays: 5,
    })
  })

  test('warns when production is enabled without an authorize guard', ({ assert }) => {
    const warn = silenceWarnings()
    try {
      defineConfig({ dashboard: true, production: { enabled: true } })
    } finally {
      warn.restore()
    }

    const message = warn.messages.join('\n')
    assert.include(message, 'no `authorize` guard is configured')
    assert.include(message, '`unsafeAllowNoAuth` is deliberately ignored')
  })

  test('warns when production is enabled with nothing to expose', ({ assert }) => {
    const warn = silenceWarnings()
    try {
      defineConfig({ authorize: () => true, production: { enabled: true } })
    } finally {
      warn.restore()
    }

    assert.include(warn.messages.join('\n'), 'nothing to expose')
  })

  test('a complete production config warns about nothing', ({ assert }) => {
    const warn = silenceWarnings()
    try {
      defineConfig({ authorize: () => true, dashboard: true, production: { enabled: true } })
    } finally {
      warn.restore()
    }

    assert.notInclude(warn.messages.join('\n'), 'production')
  })
})

test.group('production route registration', (group) => {
  let warn: ReturnType<typeof silenceWarnings>
  group.each.setup(() => {
    warn = silenceWarnings()
    return () => warn.restore()
  })

  test('unsafeAllowNoAuth is ignored in production', ({ assert }) => {
    const { router, groups, routes } = makeFakeRouter()

    const registered = registerAllRoutes({
      ...baseOptions(router),
      inProduction: true,
      unsafeAllowNoAuth: true,
    })

    assert.isFalse(registered)
    assert.lengthOf(groups, 0)
    assert.lengthOf(routes, 0)
    assert.include(warn.messages.join('\n'), '`unsafeAllowNoAuth` is ignored in production')
  })

  test('unsafeAllowNoAuth still works outside production', ({ assert }) => {
    const { router, groups } = makeFakeRouter()

    const registered = registerAllRoutes({
      ...baseOptions(router),
      inProduction: false,
      unsafeAllowNoAuth: true,
    })

    assert.isTrue(registered)
    assert.lengthOf(groups, 2)
  })

  test('a guard is enough to register in production', ({ assert }) => {
    const { router, groups } = makeFakeRouter()

    const registered = registerAllRoutes({
      ...baseOptions(router),
      inProduction: true,
      shouldShow: () => true,
    })

    assert.isTrue(registered)
    assert.lengthOf(groups, 2)
  })

  test('an async guard is accepted at registration time', ({ assert }) => {
    const { router } = makeFakeRouter()

    const registered = registerAllRoutes({
      ...baseOptions(router),
      inProduction: true,
      shouldShow: async () => true,
    })

    assert.isTrue(registered)
  })

  test('no guard and no escape hatch registers nothing outside production either', ({ assert }) => {
    const { router, groups } = makeFakeRouter()

    assert.isFalse(registerAllRoutes(baseOptions(router)))
    assert.lengthOf(groups, 0)
  })
})

test.group('capture resolution', () => {
  test('everything captures outside production', ({ assert }) => {
    const tc = resolveToolbarConfig({ enabled: true }, { inProduction: false })

    assert.deepEqual(tc.capture, {
      queries: true,
      events: true,
      emails: true,
      traces: true,
      logs: true,
    })
  })

  test('nothing captures in production by default', ({ assert }) => {
    const tc = resolveToolbarConfig({ enabled: true }, { inProduction: true })

    assert.deepEqual(tc.capture, {
      queries: false,
      events: false,
      emails: false,
      traces: false,
      logs: false,
    })
  })

  test('production capture is opt-in per subsystem', ({ assert }) => {
    const tc = resolveToolbarConfig(
      { enabled: true },
      { inProduction: true, production: { capture: { queries: true, logs: true } } }
    )

    assert.isTrue(tc.capture.queries)
    assert.isTrue(tc.capture.logs)
    assert.isFalse(tc.capture.emails)
    assert.isFalse(tc.capture.events)
    assert.isFalse(tc.capture.traces)
  })

  test('tracing: false beats capture.traces', ({ assert }) => {
    const tc = resolveToolbarConfig(
      { enabled: true, tracing: false },
      { inProduction: true, production: { capture: { traces: true } } }
    )

    assert.isFalse(tc.capture.traces)
  })

  test('omitting the production context resolves as non-production', ({ assert }) => {
    assert.isTrue(resolveToolbarConfig({ enabled: true }).capture.queries)
  })
})

test.group('production retention', () => {
  test('production shortens retention to 3 days', ({ assert }) => {
    assert.equal(resolveToolbarConfig({ enabled: true }, { inProduction: true }).retentionDays, 3)
  })

  test('non-production keeps the 7 day default', ({ assert }) => {
    assert.equal(resolveToolbarConfig({ enabled: true }, { inProduction: false }).retentionDays, 7)
  })

  test('production.retentionDays wins', ({ assert }) => {
    const tc = resolveToolbarConfig(
      { enabled: true },
      { inProduction: true, production: { retentionDays: 14 } }
    )

    assert.equal(tc.retentionDays, 14)
  })

  test('an explicit dashboard retention beats the production default', ({ assert }) => {
    const tc = resolveToolbarConfig({ enabled: true, retentionDays: 30 }, { inProduction: true })

    assert.equal(tc.retentionDays, 30)
  })
})

test.group('capture gating in DebugStore', () => {
  test('disabled collectors never subscribe', async ({ assert }) => {
    const tc = resolveToolbarConfig({ enabled: true }, { inProduction: true })
    const store = new DebugStore(tc)
    const { emitter, listened } = makeFakeEmitter()

    await store.start(emitter, null)

    assert.isEmpty(listened, 'no collector should subscribe with capture off')
  })

  test('enabled collectors do subscribe', async ({ assert }) => {
    const tc = resolveToolbarConfig(
      { enabled: true },
      { inProduction: true, production: { capture: { queries: true } } }
    )
    const store = new DebugStore(tc)
    const { emitter, listened } = makeFakeEmitter()

    await store.start(emitter, null)

    assert.isNotEmpty(listened)
    assert.isTrue(listened.some((e) => e.includes('db:query')))
  })

  test('route inspection still runs with capture off', async ({ assert }) => {
    const tc = resolveToolbarConfig({ enabled: true }, { inProduction: true })
    const store = new DebugStore(tc)
    const { emitter } = makeFakeEmitter()
    let inspected = false
    const router = {
      toJSON: () => {
        inspected = true
        return {}
      },
    }

    await store.start(emitter, router)

    assert.isTrue(inspected, 'the route table is static and should always be read')
  })

  test('the trace collector exists but is not installed when traces are off', ({ assert }) => {
    // Regression: gating only the emitter subscription left the collector
    // installed in the middleware, which still wrapped every request in
    // AsyncLocalStorage and persisted an empty trace row per request.
    const tc = resolveToolbarConfig({ enabled: true }, { inProduction: true })
    const store = new DebugStore(tc)

    assert.isFalse(store.capture.traces)
    assert.isNotNull(store.traces, 'tracing: true still constructs the collector')
  })

  test('a config without capture keeps capturing everything', ({ assert }) => {
    // `DebugStore` is a public export, so a config object built before `capture`
    // existed must behave exactly as it did before.
    const tc = resolveToolbarConfig({ enabled: true })
    const legacy = { ...tc } as Record<string, unknown>
    delete legacy.capture

    const store = new DebugStore(legacy as unknown as typeof tc)

    assert.deepEqual(store.capture, {
      queries: true,
      events: true,
      emails: true,
      traces: true,
      logs: true,
    })
  })
})
