/**
 * Generic paginated query helper.
 *
 * Wraps COUNT + SELECT in a single transaction so the pool connection
 * is acquired only once instead of two separate acquire/release cycles.
 */

import type { PaginatedResult, PaginateOptions } from './dashboard_types.js'
import type { Knex } from 'knex'

/**
 * Execute a paginated query within a transaction.
 */
export async function executePaginate(
  db: Knex,
  opts: PaginateOptions
): Promise<PaginatedResult<Record<string, unknown>>> {
  return db.transaction(async (trx) => {
    const countQuery = trx(opts.table)
    if (opts.applyFilters) opts.applyFilters(countQuery)
    const [{ count: totalRaw }] = await countQuery.count('* as count')
    const total = Number(totalRaw)

    const offset = (opts.page - 1) * opts.perPage
    const dataQuery = trx(opts.table)
      .orderBy('created_at', 'desc')
      .limit(opts.perPage)
      .offset(offset)
    if (opts.applyFilters) opts.applyFilters(dataQuery)
    const data = await dataQuery

    return {
      data,
      total,
      page: opts.page,
      perPage: opts.perPage,
      lastPage: Math.ceil(total / opts.perPage),
    }
  })
}
