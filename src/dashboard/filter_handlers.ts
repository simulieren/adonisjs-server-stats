import { safeParseJson } from '../utils/json_helpers.js'

import type { DashboardStore } from './dashboard_store.js'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Handle GET /saved-filters — list all saved filters.
 */
export async function handleSavedFilters(dashboardStore: DashboardStore) {
  const filters = await dashboardStore.getSavedFilters()
  return {
    filters: filters.map((f: Record<string, unknown>) => ({
      id: f.id,
      name: f.name,
      section: f.section,
      filterConfig: safeParseJson(f.filter_config),
      createdAt: f.created_at,
    })),
  }
}

/**
 * Handle POST /saved-filters — create a new saved filter.
 * Returns the response payload or null if creation fails.
 */
export async function handleCreateSavedFilter(
  dashboardStore: DashboardStore,
  { request, response }: HttpContext
) {
  if (!dashboardStore.isReady()) {
    return response.serviceUnavailable({ error: 'Database not available' })
  }

  try {
    const { name, section, filterConfig } = request.body()
    if (!name || !section || !filterConfig) {
      return response.badRequest({
        error: 'Missing required fields: name, section, filterConfig',
      })
    }
    // Size bounds: these land in SQLite verbatim, and the list endpoint
    // returns every row — one oversized filter would bloat every response.
    if (typeof name !== 'string' || name.length > 100) {
      return response.badRequest({ error: 'name must be a string of at most 100 chars' })
    }
    if (typeof section !== 'string' || section.length > 50) {
      return response.badRequest({ error: 'section must be a string of at most 50 chars' })
    }
    const configJson =
      typeof filterConfig === 'string' ? filterConfig : JSON.stringify(filterConfig)
    if (configJson.length > 4096) {
      return response.badRequest({ error: 'filterConfig too large (max 4096 chars)' })
    }

    const result = await dashboardStore.createSavedFilter(
      name,
      section,
      typeof filterConfig === 'string' ? safeParseJson(filterConfig) : filterConfig
    )

    return result
      ? response.json(result)
      : response.serviceUnavailable({ error: 'Database not available' })
  } catch {
    return response.internalServerError({ error: 'Failed to create filter' })
  }
}

/**
 * Handle DELETE /saved-filters/:id — delete a saved filter.
 */
export async function handleDeleteSavedFilter(
  dashboardStore: DashboardStore,
  { params, response }: HttpContext
) {
  if (!dashboardStore.isReady()) {
    return response.serviceUnavailable({ error: 'Database not available' })
  }

  try {
    return (await dashboardStore.deleteSavedFilter(Number(params.id)))
      ? response.json({ success: true })
      : response.notFound({ error: 'Filter not found' })
  } catch {
    return response.internalServerError({ error: 'Failed to delete filter' })
  }
}
