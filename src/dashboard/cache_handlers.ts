import { clamp } from '../utils/math_helpers.js'

import type { InspectorManager } from './inspector_manager.js'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Handle GET /cache-stats — list cache keys and overall stats.
 */
export async function handleCacheStats(
  inspectors: InspectorManager,
  { request, response }: HttpContext
) {
  const inspector = await inspectors.getCacheInspector()
  if (!inspector) return response.json({ available: false, stats: null, keys: [] })

  const qs = request.qs()
  const pattern = qs.search || qs.pattern ? `*${qs.search || qs.pattern}*` : '*'

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
  { params, response }: HttpContext
) {
  const inspector = await inspectors.getCacheInspector()
  if (!inspector) return response.notFound({ error: 'Cache not available' })

  try {
    const detail = await inspector.getKey(decodeURIComponent(params.key))
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
  { params, response }: HttpContext
) {
  const inspector = await inspectors.getCacheInspector()
  if (!inspector) return response.notFound({ error: 'Cache not available' })

  try {
    return (await inspector.deleteKey(decodeURIComponent(params.key)))
      ? response.json({ deleted: true })
      : response.notFound({ error: 'Key not found' })
  } catch {
    return response.internalServerError({ error: 'Failed to delete cache key' })
  }
}
