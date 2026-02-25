import type { RouteRecord } from './types.js'

/**
 * Reads the router's route table at boot time and caches it.
 * Static data computed once — routes don't change after boot.
 */
export class RouteInspector {
  private routes: RouteRecord[] = []

  /**
   * Inspect the router and cache all routes.
   * Call this in the provider's `ready()` hook.
   */
  inspect(router: any): void {
    try {
      // AdonisJS router exposes routes via toJSON()
      const routeData = router.toJSON()

      this.routes = []

      // routeData is a map of domains -> routes
      for (const domain in routeData) {
        const domainRoutes = routeData[domain]
        if (!Array.isArray(domainRoutes)) continue

        for (const route of domainRoutes) {
          const methods: string[] = Array.isArray(route.methods)
            ? route.methods.filter((m: string) => m !== 'HEAD')
            : []

          const handler = this.resolveHandler(route.handler)
          const middlewareList = this.resolveMiddleware(route.middleware)

          for (const method of methods) {
            this.routes.push({
              method,
              pattern: route.pattern || '/',
              name: route.name || null,
              handler,
              middleware: middlewareList,
            })
          }
        }
      }
    } catch {
      // Router not available or incompatible — empty route list
    }
  }

  private resolveHandler(handler: any): string {
    if (!handler) return 'unknown'
    if (typeof handler === 'string') return handler
    if (typeof handler === 'function') return handler.name || 'closure'

    // Lazy import handler
    if (handler.reference) {
      const ref = handler.reference
      if (typeof ref === 'string') return ref
      if (Array.isArray(ref) && ref.length >= 2) {
        return `${ref[0]}#${ref[1]}`
      }
    }

    // Handle object with name
    if (handler.name) return handler.name

    return 'unknown'
  }

  private resolveMiddleware(middleware: any): string[] {
    if (!middleware) return []

    // AdonisJS v6 middleware is a Middleware instance from @poppinss/middleware.
    // Call .all() to get the Set of middleware items.
    const items: Iterable<any> =
      typeof middleware.all === 'function'
        ? middleware.all()
        : Array.isArray(middleware)
          ? middleware
          : []

    const result: string[] = []
    for (const m of items) {
      if (typeof m === 'string') {
        result.push(m)
      } else if (typeof m === 'function') {
        if (m.name) result.push(m.name)
      } else if (m?.name) {
        const args = m.args?.length ? `(${JSON.stringify(m.args).slice(1, -1)})` : ''
        result.push(m.name + args)
      }
      // Skip unnamed global middleware (router.use lazy imports) — same for every route
    }
    return result
  }

  getRoutes(): RouteRecord[] {
    return this.routes
  }

  getRouteCount(): number {
    return this.routes.length
  }
}
