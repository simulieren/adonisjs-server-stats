import { log } from '../utils/logger.js'

import type {
  RouteRecord,
  Router,
  RouteNode,
  RouteHandler,
  MiddlewareStore,
  MiddlewareItem,
} from './types.js'

/** Resolve middleware items from a MiddlewareStore or array. */
function resolveMiddlewareItems(
  middleware: MiddlewareStore | MiddlewareItem[] | undefined
): Iterable<string | ((...args: unknown[]) => unknown) | MiddlewareItem> {
  if (!middleware) return []
  if (Array.isArray(middleware)) return middleware
  if (typeof middleware.all === 'function') return middleware.all()
  return []
}

/** Resolve a single middleware item to its display name. */
function resolveMiddlewareName(
  m: string | ((...args: unknown[]) => unknown) | MiddlewareItem
): string | null {
  if (typeof m === 'string') return m
  if (typeof m === 'function') return m.name || null
  if (m?.name) {
    const args = m.args?.length ? `(${JSON.stringify(m.args).slice(1, -1)})` : ''
    return m.name + args
  }
  return null
}

/**
 * Reads the router's route table at boot time and caches it.
 */
export class RouteInspector {
  private routes: RouteRecord[] = []

  inspect(router: Router): void {
    try {
      const routeData = router.toJSON()
      this.routes = []

      for (const domain in routeData) {
        const domainRoutes = routeData[domain]
        if (!Array.isArray(domainRoutes)) continue
        this.#processDomainRoutes(domainRoutes)
      }
    } catch (err) {
      log.warn(
        `route inspector: could not read routes — ${(err as Error)?.message || 'unknown error'}`
      )
    }
  }

  #processDomainRoutes(domainRoutes: RouteNode[]): void {
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

  private resolveHandler(
    handler: string | ((...args: unknown[]) => unknown) | RouteHandler | undefined
  ): string {
    if (!handler) return 'unknown'
    if (typeof handler === 'string') return handler
    if (typeof handler === 'function') return handler.name || 'closure'
    return this.#resolveObjectHandler(handler)
  }

  #resolveObjectHandler(handler: RouteHandler): string {
    if (handler.reference) {
      const ref = handler.reference
      if (typeof ref === 'string') return ref
      if (Array.isArray(ref) && ref.length >= 2) return `${ref[0]}#${ref[1]}`
    }
    return handler.name || 'unknown'
  }

  private resolveMiddleware(middleware: MiddlewareStore | MiddlewareItem[] | undefined): string[] {
    const items = resolveMiddlewareItems(middleware)
    const result: string[] = []
    for (const m of items) {
      const name = resolveMiddlewareName(m)
      if (name) result.push(name)
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
