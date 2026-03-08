/**
 * Saved filter CRUD operations for the DashboardStore.
 *
 * Extracted from DashboardStore to reduce file length.
 */

import { CoalesceCache } from './coalesce_cache.js'

import type { Knex } from 'knex'

export function fetchSavedFilters(
  db: Knex,
  cache: CoalesceCache,
  section?: string
): Promise<Record<string, unknown>[]> {
  return cache.coalesce('savedFilters:' + (section || ''), async () => {
    const q = db('server_stats_saved_filters').orderBy('created_at', 'desc')
    if (section) q.where('section', section)
    return q
  })
}

export async function insertSavedFilter(
  db: Knex,
  name: string,
  section: string,
  filterConfig: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const [id] = await db('server_stats_saved_filters').insert({
    name,
    section,
    filter_config: JSON.stringify(filterConfig),
  })
  return { id, name, section, filterConfig }
}

export async function removeSavedFilter(db: Knex, id: number): Promise<boolean> {
  return (await db('server_stats_saved_filters').where('id', id).delete()) > 0
}
