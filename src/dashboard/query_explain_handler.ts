import type { DashboardStore } from './dashboard_store.js'
import type { HttpContext } from '@adonisjs/core/http'
import type { ApplicationService } from '@adonisjs/core/types'

/**
 * Fetch and validate the query record for EXPLAIN.
 * Returns null and sends an error response if invalid.
 */
async function fetchQueryRecord(
  dashboardStore: DashboardStore,
  id: number
): Promise<Record<string, unknown> | null> {
  const db = dashboardStore.getDb()
  if (!db) return null
  return db('server_stats_queries').where('id', id).first() ?? null
}

/** Check if the SQL is a SELECT statement (required for EXPLAIN). */
function isSelectQuery(sqlText: string): boolean {
  return sqlText.trim().toUpperCase().startsWith('SELECT')
}

/** Parse bindings from a stored query. */
function parseBindings(raw: unknown): unknown[] {
  if (!raw) return []
  try {
    return JSON.parse(raw as string)
  } catch {
    return []
  }
}

/** Get the Lucid write client for running EXPLAIN. */
async function getAppDbClient(
  app: ApplicationService
): Promise<{ raw: (sql: string, bindings: unknown[]) => Promise<Record<string, unknown>> } | null> {
  try {
    const lucid: unknown = await app.container.make('lucid.db')
    return (lucid as { connection: () => { getWriteClient: () => unknown } })
      .connection()
      .getWriteClient() as { raw: (sql: string, bindings: unknown[]) => Promise<Record<string, unknown>> }
  } catch {
    return null
  }
}

/** Extract the plan from raw EXPLAIN result. */
function extractPlan(explainResult: Record<string, unknown>): unknown[] {
  const rawRows =
    (explainResult?.rows as Record<string, unknown>[]) ??
    (Array.isArray(explainResult) ? explainResult : [])
  if (rawRows.length > 0 && rawRows[0]['QUERY PLAN']) {
    return rawRows[0]['QUERY PLAN'] as unknown[]
  }
  return rawRows
}

/**
 * Handle the EXPLAIN endpoint for a stored query.
 *
 * Extracted from DashboardController.queryExplain to reduce
 * complexity and function length.
 */
export async function handleQueryExplain(
  dashboardStore: DashboardStore,
  app: ApplicationService,
  ctx: HttpContext
): Promise<unknown> {
  const { params, response } = ctx

  if (!dashboardStore.isReady()) {
    return response.notFound({ error: 'Not found' })
  }

  try {
    const query = await fetchQueryRecord(dashboardStore, Number(params.id))
    if (!query) return response.notFound({ error: 'Query not found' })

    if (!isSelectQuery(query.sql_text as string)) {
      return response.badRequest({ error: 'EXPLAIN is only supported for SELECT queries' })
    }

    const appDb = await getAppDbClient(app)
    if (!appDb) {
      return response.serviceUnavailable({ error: 'App database connection not available' })
    }

    const bindings = parseBindings(query.bindings)
    const explainResult = await appDb.raw(`EXPLAIN (FORMAT JSON) ${query.sql_text}`, bindings)
    const plan = extractPlan(explainResult)

    return response.json({ queryId: Number(params.id), sql: query.sql_text, plan })
  } catch (error) {
    return response.internalServerError({
      error: 'EXPLAIN failed',
      message: (error as Error)?.message ?? 'Unknown error',
    })
  }
}
