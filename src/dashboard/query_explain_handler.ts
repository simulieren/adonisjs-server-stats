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

export type DbDialect = 'pg' | 'sqlite' | 'mysql' | 'mssql' | 'unknown'

export interface AppDbClient {
  raw: (sql: string, bindings: unknown[]) => Promise<unknown>
  dialect: DbDialect
}

/** Detect the database dialect from a knex client instance. */
function detectDialect(client: Record<string, unknown>): DbDialect {
  // Try client.client.config.client (knex standard)
  const inner = client?.client as Record<string, unknown> | undefined
  const cfg = (inner?.config as Record<string, unknown>) ?? {}
  const clientName = String(cfg.client ?? inner?.driverName ?? '')
  if (/pg|postgres/i.test(clientName)) return 'pg'
  if (/sqlite|better-sqlite|libsql/i.test(clientName)) return 'sqlite'
  if (/mysql/i.test(clientName)) return 'mysql'
  if (/mssql|tedious/i.test(clientName)) return 'mssql'
  return 'unknown'
}

/** Get the Lucid write client for running EXPLAIN. */
export async function getAppDbClient(
  app: ApplicationService,
  connectionName?: string
): Promise<AppDbClient | null> {
  try {
    const lucid: unknown = await app.container.make('lucid.db')
    const conn = connectionName
      ? (lucid as { connection: (name: string) => { getWriteClient: () => unknown } }).connection(
          connectionName
        )
      : (lucid as { connection: () => { getWriteClient: () => unknown } }).connection()
    const client = conn.getWriteClient() as Record<string, unknown>
    const dialect = detectDialect(client)
    return {
      raw: (client.raw as (sql: string, bindings: unknown[]) => Promise<unknown>).bind(client),
      dialect,
    }
  } catch {
    return null
  }
}

/** Build the EXPLAIN SQL for the detected dialect. */
export function buildExplainSql(sql: string, dialect: DbDialect): string {
  switch (dialect) {
    case 'pg':
      return `EXPLAIN (FORMAT JSON) ${sql}`
    case 'mysql':
      return `EXPLAIN FORMAT=JSON ${sql}`
    case 'sqlite':
      return `EXPLAIN QUERY PLAN ${sql}`
    case 'mssql':
      // MSSQL requires SET SHOWPLAN_XML ON as a session-level setting;
      // not feasible in a single raw query — return null to signal unsupported
      return ''
    default:
      return `EXPLAIN ${sql}`
  }
}

/** Extract the plan from raw EXPLAIN result based on dialect. */
export function extractPlan(explainResult: unknown, dialect: DbDialect = 'pg'): unknown[] {
  // SQLite: knex returns the rows array directly
  if (dialect === 'sqlite') {
    const rows = Array.isArray(explainResult) ? explainResult : []
    // SQLite EXPLAIN QUERY PLAN returns { id, parent, notused, detail }
    // Return as-is for table rendering
    return rows
  }

  // PostgreSQL / MySQL: knex returns { rows: [...] }
  const result = explainResult as Record<string, unknown>
  const rawRows =
    (result?.rows as Record<string, unknown>[]) ??
    (Array.isArray(result) ? result : [])

  // PostgreSQL JSON format: rows[0]['QUERY PLAN'] is the plan array
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

    const appDb = await getAppDbClient(app, (query.connection as string) || undefined)
    if (!appDb) {
      return response.serviceUnavailable({ error: 'App database connection not available' })
    }

    const bindings = parseBindings(query.bindings)
    const explainSql = buildExplainSql(query.sql_text as string, appDb.dialect)
    if (!explainSql) {
      return response.badRequest({ error: `EXPLAIN is not supported for ${appDb.dialect} databases` })
    }
    const explainResult = await appDb.raw(explainSql, bindings)
    const plan = extractPlan(explainResult, appDb.dialect)

    return response.json({ queryId: Number(params.id), sql: query.sql_text, plan })
  } catch (error) {
    return response.internalServerError({
      error: 'EXPLAIN failed',
      message: (error as Error)?.message ?? 'Unknown error',
    })
  }
}
