import { test } from '@japa/runner'
import { defineConfig } from '../src/define_config.js'
import { registerAllRoutes } from '../src/routes/register_routes.js'
import { collectRegisteredPaths } from '../src/provider/boot_helpers.js'

import type { RegisterRoutesOptions } from '../src/routes/register_routes.js'
import type { AdonisRouter } from '../src/routes/router_types.js'

/** A group as observed by the fake router. */
interface RecordedGroup {
  prefix?: string
  domain?: string
  middleware?: unknown[]
  routes: string[]
}

/**
 * Minimal router double that records what each `router.group()` was configured
 * with. Routes created inside a group callback are attributed to that group,
 * mirroring how AdonisJS collects them.
 */
function makeFakeRouter() {
  const groups: RecordedGroup[] = []
  const ungroupedRoutes: string[] = []
  let current: RecordedGroup | null = null

  const route = {
    as: () => route,
    where: () => route,
    use: () => route,
  }

  const group = {
    prefix(path: string) {
      groups[groups.length - 1].prefix = path
      return group
    },
    domain(host: string) {
      groups[groups.length - 1].domain = host
      return group
    },
    use(mw: unknown[]) {
      groups[groups.length - 1].middleware = mw
      return group
    },
  }

  const record = (pattern: string) => {
    if (current) current.routes.push(pattern)
    else ungroupedRoutes.push(pattern)
    return route
  }

  const router = {
    get: (pattern: string) => record(pattern),
    post: (pattern: string) => record(pattern),
    delete: (pattern: string) => record(pattern),
    group(callback: () => void) {
      const entry: RecordedGroup = { routes: [] }
      groups.push(entry)
      const previous = current
      current = entry
      callback()
      current = previous
      return group
    },
  }

  return { router: router as unknown as AdonisRouter, groups, ungroupedRoutes }
}

/**
 * Base options for `registerAllRoutes`.
 *
 * `shouldShow` is required: without an access guard the registrar fails closed
 * and registers nothing, which would make every assertion below pass vacuously.
 */
function baseOptions(router: AdonisRouter): RegisterRoutesOptions {
  return {
    router,
    getApiController: () => null,
    getStatsController: () => null,
    getDebugController: () => null,
    getDashboardController: () => null,
    shouldShow: () => true,
    statsEndpoint: '/admin/api/server-stats',
    debugEndpoint: '/admin/api/debug',
    dashboardPath: '/__stats',
  }
}

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

  test('defineConfig warns about a domain that can never match', ({ assert }) => {
    const warnings: string[] = []
    const originalWarn = console.warn
    console.warn = (...args: unknown[]) => warnings.push(args.join(' '))
    try {
      defineConfig({ domain: 'https://admin.example.com/stats:3333' })
    } finally {
      console.warn = originalWarn
    }

    const warning = warnings.join('\n')
    assert.include(warning, 'remove the protocol')
    assert.include(warning, 'remove the path')
    assert.include(warning, 'remove the port')
  })

  test('defineConfig does not warn about a valid domain', ({ assert }) => {
    const warnings: string[] = []
    const originalWarn = console.warn
    console.warn = (...args: unknown[]) => warnings.push(args.join(' '))
    try {
      defineConfig({ domain: ':tenant.example.com' })
    } finally {
      console.warn = originalWarn
    }

    assert.notInclude(warnings.join('\n'), 'looks wrong')
  })
})

test.group('domain routing - route registration', () => {
  test('every route group is restricted to the configured domain', ({ assert }) => {
    const { router, groups, ungroupedRoutes } = makeFakeRouter()

    registerAllRoutes({ ...baseOptions(router), domain: 'admin.example.com' })

    // Exactly three groups: stats, debug, dashboard. Asserting the exact count
    // means a registrar that silently stops registering can't pass this test.
    assert.lengthOf(groups, 3)
    assert.isEmpty(ungroupedRoutes, 'no route may escape a domain-restricted group')
    for (const group of groups) {
      assert.equal(group.domain, 'admin.example.com')
    }
  })

  test('the stats route is grouped only so a domain can be attached', ({ assert }) => {
    const { router, groups } = makeFakeRouter()

    registerAllRoutes({ ...baseOptions(router), domain: 'admin.example.com' })

    const statsGroup = groups.find((g) => g.routes.includes('/admin/api/server-stats'))
    assert.exists(statsGroup, 'stats endpoint should live in its own group')
    assert.isUndefined(statsGroup!.prefix, 'stats group carries the full path, not a prefix')
    assert.equal(statsGroup!.domain, 'admin.example.com')
  })

  test('no domain is set and the stats route stays ungrouped when domain is absent', ({
    assert,
  }) => {
    const { router, groups, ungroupedRoutes } = makeFakeRouter()

    registerAllRoutes(baseOptions(router))

    // Debug and dashboard were already grouped before `domain` existed; the
    // stats route must NOT gain a group, so the route tree is unchanged.
    assert.lengthOf(groups, 2)
    assert.deepEqual(ungroupedRoutes, ['/admin/api/server-stats'])
    for (const group of groups) {
      assert.isUndefined(group.domain)
    }
  })

  test('dynamic subdomains reach the router verbatim', ({ assert }) => {
    const { router, groups } = makeFakeRouter()

    registerAllRoutes({ ...baseOptions(router), domain: ':tenant.example.com' })

    for (const group of groups) {
      assert.equal(group.domain, ':tenant.example.com')
    }
  })
})

test.group('domain routing - startup log', () => {
  test('logged paths are prefixed with the domain', ({ assert }) => {
    const paths = collectRegisteredPaths(
      '/admin/api/server-stats',
      '/admin/api/debug',
      '/__stats',
      'admin.example.com'
    )

    assert.deepEqual(paths, [
      'admin.example.com/admin/api/server-stats',
      'admin.example.com/admin/api/debug/*',
      'admin.example.com/__stats/*',
    ])
  })

  test('logged paths are unchanged without a domain', ({ assert }) => {
    const paths = collectRegisteredPaths('/admin/api/server-stats', '/admin/api/debug', '/__stats')

    assert.deepEqual(paths, ['/admin/api/server-stats', '/admin/api/debug/*', '/__stats/*'])
  })
})
