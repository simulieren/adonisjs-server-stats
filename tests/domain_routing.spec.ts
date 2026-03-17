import { test } from '@japa/runner'
import { defineConfig } from '../src/define_config.js'

test.group('domain routing config', (group) => {
  let originalLog: typeof console.log
  group.setup(() => {
    originalLog = console.log
    console.log = () => {}
  })
  group.teardown(() => {
    console.log = originalLog
  })

  test('defineConfig passes domain through to resolved config', ({ assert }) => {
    const config = defineConfig({ domain: 'admin.example.com' })
    assert.equal(config.domain, 'admin.example.com')
  })

  test('defineConfig leaves domain undefined when not set', ({ assert }) => {
    const config = defineConfig({})
    assert.isUndefined(config.domain)
  })

  test('defineConfig supports dynamic subdomain syntax', ({ assert }) => {
    const config = defineConfig({ domain: ':tenant.example.com' })
    assert.equal(config.domain, ':tenant.example.com')
  })
})

test.group('domain routing - route registration', () => {
  test('registerAllRoutes passes domain to sub-registrars', async ({ assert }) => {
    const { registerAllRoutes } = await import('../src/routes/register_routes.js')

    const registeredGroups: Array<{ prefix?: string; domain?: string; middleware?: unknown[] }> = []

    const fakeRoute = {
      as: () => fakeRoute,
      where: () => fakeRoute,
      use: () => {},
    }

    const fakeGroup = {
      prefix(path: string) {
        registeredGroups[registeredGroups.length - 1].prefix = path
        return fakeGroup
      },
      domain(host: string) {
        registeredGroups[registeredGroups.length - 1].domain = host
        return fakeGroup
      },
      use(mw: unknown[]) {
        registeredGroups[registeredGroups.length - 1].middleware = mw
      },
    }

    const fakeRouter = {
      get() {
        return fakeRoute
      },
      post() {
        return fakeRoute
      },
      delete() {
        return fakeRoute
      },
      group(callback: () => void) {
        registeredGroups.push({})
        callback()
        return fakeGroup
      },
    }

    registerAllRoutes({
      router: fakeRouter as any,
      getApiController: () => null,
      getStatsController: () => null,
      getDebugController: () => null,
      getDashboardController: () => null,
      statsEndpoint: '/admin/api/server-stats',
      debugEndpoint: '/admin/api/debug',
      dashboardPath: '/__stats',
      domain: 'admin.example.com',
    })

    // All groups should have domain set
    assert.isTrue(registeredGroups.length >= 3, 'should have at least 3 groups (stats, debug, dashboard)')
    for (const group of registeredGroups) {
      assert.equal(group.domain, 'admin.example.com', `group with prefix "${group.prefix}" should have domain`)
    }
  })

  test('registerAllRoutes does not set domain when not provided', async ({ assert }) => {
    const { registerAllRoutes } = await import('../src/routes/register_routes.js')

    const registeredGroups: Array<{ prefix?: string; domain?: string }> = []

    const fakeRoute = {
      as: () => fakeRoute,
      where: () => fakeRoute,
      use: () => {},
    }

    const fakeGroup = {
      prefix(path: string) {
        registeredGroups[registeredGroups.length - 1].prefix = path
        return fakeGroup
      },
      domain(host: string) {
        registeredGroups[registeredGroups.length - 1].domain = host
        return fakeGroup
      },
      use() {},
    }

    const fakeRouter = {
      get() {
        return fakeRoute
      },
      post() {
        return fakeRoute
      },
      delete() {
        return fakeRoute
      },
      group(callback: () => void) {
        registeredGroups.push({})
        callback()
        return fakeGroup
      },
    }

    registerAllRoutes({
      router: fakeRouter as any,
      getApiController: () => null,
      getStatsController: () => null,
      getDebugController: () => null,
      getDashboardController: () => null,
      debugEndpoint: '/admin/api/debug',
      dashboardPath: '/__stats',
    })

    // No group should have a domain set
    for (const group of registeredGroups) {
      assert.isUndefined(group.domain, `group with prefix "${group.prefix}" should not have domain`)
    }
  })
})
