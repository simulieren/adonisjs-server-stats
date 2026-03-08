/**
 * Shared types for the dashboard store and its extracted modules.
 */

import type { Knex } from 'knex'

// ---------------------------------------------------------------------------
// Minimal interface for an AdonisJS-style event emitter
// ---------------------------------------------------------------------------

export interface EventEmitter {
  on(event: string, handler: (...args: unknown[]) => void): void
  off(event: string, handler: (...args: unknown[]) => void): void
}

// ---------------------------------------------------------------------------
// Request / filter types
// ---------------------------------------------------------------------------

export interface RequestInput {
  method: string
  url: string
  statusCode: number
  duration: number
  spanCount?: number
  warningCount?: number
}

export interface PersistRequestInput extends RequestInput {
  queries: import('../debug/types.js').QueryRecord[]
  trace: import('../debug/types.js').TraceRecord | null
  httpRequestId?: string | null
}

export interface RequestFilters {
  method?: string
  url?: string
  status?: number
  statusMin?: number
  statusMax?: number
  durationMin?: number
  durationMax?: number
  search?: string
}

export interface QueryFilters {
  method?: string
  model?: string
  connection?: string
  durationMin?: number
  durationMax?: number
  requestId?: number
  search?: string
}

export interface EventFilters {
  eventName?: string
  search?: string
}

export interface EmailFilters {
  search?: string
  from?: string
  to?: string
  subject?: string
  mailer?: string
  status?: string
}

export interface LogFilters {
  level?: string
  requestId?: string
  search?: string
  structured?: { field: string; operator: 'equals' | 'contains' | 'startsWith'; value: string }[]
}

export interface TraceFilters {
  method?: string
  url?: string
  statusMin?: number
  statusMax?: number
  search?: string
}

export interface PaginatedResult<T> {
  data: T[]
  total: number
  page: number
  perPage: number
  lastPage: number
}

// ---------------------------------------------------------------------------
// Paginate options (replaces 5 positional params)
// ---------------------------------------------------------------------------

export interface PaginateOptions {
  table: string
  page: number
  perPage: number
  applyFilters?: (query: Knex.QueryBuilder) => void
  filterKey?: string
}
