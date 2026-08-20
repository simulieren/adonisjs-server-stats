import { clamp } from '../utils/math_helpers.js'

import type { InspectorManager } from './inspector_manager.js'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Access policy for cache operations, resolved by the controller from
 * `advanced.cacheKeyPrefix` (or the SERVER_STATS_CACHE_KEY_PREFIX env var).
 *
 * The prefix restricts which Redis keys the dashboard may list, read, or
 * delete so a dashboard viewer can't target arbitrary keys (sessions,
 * rate-limit counters). Empty/unset stays unrestricted in dev for
 * back-compat, but fails closed in production: single-key reads and deletes
 * on a shared production Redis need a deliberate scope, not a default.
 */
export interface CacheAccessPolicy {
  prefix: string
  inProduction: boolean
}

/** Check whether a cache key is permitted under the policy. */
function isKeyAllowed(key: string, policy: CacheAccessPolicy): boolean {
  if (policy.prefix !== '') return key.startsWith(policy.prefix)
  return !policy.inProduction
}

/**
 * Handle GET /cache-stats — list cache keys and overall stats.
 */
export async function handleCacheStats(
  inspectors: InspectorManager,
  { request, response }: HttpContext,
  policy: CacheAccessPolicy
) {
  const inspector = await inspectors.getCacheInspector()
  if (!inspector) return response.json({ available: false, stats: null, keys: [] })

  const qs = request.qs()
  // A configured prefix scopes the listing glob the same way it scopes
  // single-key access, so keys outside the allow-list are never enumerated.
  const search = qs.search || qs.pattern ? `*${qs.search || qs.pattern}*` : '*'
  const pattern = policy.prefix !== '' ? `${policy.prefix}${search}` : search

  try {
    const [stats, keyList] = await Promise.all([
      inspector.getStats(),
      inspector.listKeys(pattern, qs.cursor || '0', clamp(Number(qs.count) || 100, 1, 500)),
    ])
    return response.json({ available: true, stats, keys: keyList.keys, cursor: keyList.cursor })
  } catch {
    return response.json({ available: false, stats: null, keys: [] })
  }
}

/**
 * Handle GET /cache-stats/:key — get a single cache key's value and metadata.
 */
export async function handleCacheKey(
  inspectors: InspectorManager,
  { params, response }: HttpContext,
  policy: CacheAccessPolicy
) {
  const inspector = await inspectors.getCacheInspector()
  if (!inspector) return response.notFound({ error: 'Cache not available' })

  const key = decodeURIComponent(params.key)
  if (!isKeyAllowed(key, policy)) return response.forbidden({ error: 'Cache key not permitted' })

  try {
    const detail = await inspector.getKey(key)
    return detail ? response.json(detail) : response.notFound({ error: 'Key not found' })
  } catch {
    return response.notFound({ error: 'Key not found' })
  }
}

/**
 * Handle DELETE /cache-stats/:key — delete a single cache key.
 */
export async function handleCacheKeyDelete(
  inspectors: InspectorManager,
  { params, response }: HttpContext,
  policy: CacheAccessPolicy
) {
  const inspector = await inspectors.getCacheInspector()
  if (!inspector) return response.notFound({ error: 'Cache not available' })

  const key = decodeURIComponent(params.key)
  if (!isKeyAllowed(key, policy)) return response.forbidden({ error: 'Cache key not permitted' })

  try {
    return (await inspector.deleteKey(key))
      ? response.json({ deleted: true })
      : response.notFound({ error: 'Key not found' })
  } catch {
    return response.internalServerError({ error: 'Failed to delete cache key' })
  }
}
