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
 * Rows the COUNT is allowed to scan. Filters include leading-wildcard LIKEs
 * that no index can serve, so an uncapped COUNT walks the entire table twice
 * per request (count + data). Past this many matches the exact total stops
 * being interesting — the UI just needs "lots of pages".
 */
const COUNT_SCAN_CAP = 10_000

/**
 * Execute a paginated query within a transaction.
 */
export async function executePaginate(
  db: Knex,
  opts: PaginateOptions
): Promise<PaginatedResult<Record<string, unknown>>> {
  const perPage = clampPerPage(opts.perPage)
  return db.transaction(async (trx) => {
    const countSub = trx(opts.table).select(trx.raw('1')).limit(COUNT_SCAN_CAP)
    if (opts.applyFilters) opts.applyFilters(countSub)
    const countRows = (await trx.count('* as count').from(countSub.as('t'))) as {
      count: unknown
    }[]
    const total = Number(countRows[0]?.count ?? 0)

    // Clamp the page into the real range: an arbitrary ?page= forces a
    // full-scan-sized OFFSET on the single sqlite connection, blocking every
    // other dashboard read for nothing.
    const lastPage = Math.ceil(total / perPage)
    const requested = Number.isFinite(Number(opts.page)) ? Math.trunc(Number(opts.page)) : 1
    const page = clamp(requested, 1, Math.max(1, lastPage))

    const offset = (page - 1) * perPage
    const dataQuery = trx(opts.table).orderBy('created_at', 'desc').limit(perPage).offset(offset)
    if (opts.applyFilters) opts.applyFilters(dataQuery)
    const data = await dataQuery

    return {
      data,
      total,
      page,
      perPage,
      lastPage,
    }
  })
}
