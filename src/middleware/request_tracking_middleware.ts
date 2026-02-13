import { performance } from "node:perf_hooks";

import { getRequestMetrics } from "../collectors/http_collector.js";

import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";

/**
 * Module-level `shouldShow` callback, set by the provider at boot.
 */
let shouldShowFn: ((ctx: any) => boolean) | null = null;

export function setShouldShow(fn: ((ctx: any) => boolean) | null) {
  shouldShowFn = fn;
}

export default class RequestTrackingMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const metrics = getRequestMetrics();
    const start = performance.now();
    metrics.incrementActiveConnections();

    // Share a lazy shouldShow evaluator with Edge for @serverStats() tag.
    // Must be lazy (a function, not a boolean) because this server middleware
    // runs BEFORE router middleware like initialize_auth_middleware and
    // silentAuth — so ctx.auth isn't populated yet. The function is called
    // at Edge render time (inside the controller), when auth is available.
    if (shouldShowFn && typeof (ctx as any).view?.share === "function") {
      (ctx as any).view.share({
        __ssShowFn: () => {
          try {
            return shouldShowFn!(ctx);
          } catch {
            return false;
          }
        },
      });
    }

    try {
      await next();
    } finally {
      const duration = performance.now() - start;
      metrics.decrementActiveConnections();
      metrics.recordRequest(duration, ctx.response.getStatus());
    }
  }
}
