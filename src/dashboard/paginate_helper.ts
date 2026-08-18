/**
 * Generic paginated query helper.
 *
 * Wraps COUNT + SELECT in a single transaction so the pool connection
 * is acquired only once instead of two separate acquire/release cycles.
 */

import { clamp } from '../utils/math_helpers.js'

import type { PaginatedResult, PaginateOptions } from './dashboard_types.js'
import type { Knex } from 'knex'

/**
 * Clamp a raw perPage value to a safe range (1..200) to prevent DoS via
 * unbounded result sets on the single sqlite connection.
 */
export function clampPerPage(value: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 25
  return clamp(Math.trunc(n), 1, 200)
}

/**
 * Execute a paginated query within a transaction.
 */
export async function executePaginate(
  db: Knex,
  opts: PaginateOptions
): Promise<PaginatedResult<Record<string, unknown>>> {
  const perPage = clampPerPage(opts.perPage)
  return db.transaction(async (trx) => {
    const countQuery = trx(opts.table)
    if (opts.applyFilters) opts.applyFilters(countQuery)
    const [{ count: totalRaw }] = await countQuery.count('* as count')
    const total = Number(totalRaw)

    const offset = (opts.page - 1) * perPage
    const dataQuery = trx(opts.table)
      .orderBy('created_at', 'desc')
      .limit(perPage)
      .offset(offset)
    if (opts.applyFilters) opts.applyFilters(dataQuery)
    const data = await dataQuery

    return {
      data,
      total,
      page: opts.page,
      perPage,
      lastPage: Math.ceil(total / perPage),
    }
  })
}
