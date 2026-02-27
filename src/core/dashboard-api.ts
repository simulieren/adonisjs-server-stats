// ---------------------------------------------------------------------------
// Framework-agnostic dashboard API methods
// ---------------------------------------------------------------------------
//
// Vue's `useDashboardData` composable defines several domain-specific API
// methods (fetchChart, explainQuery, retryJob, etc.) that React lacks.
// This module extracts those methods into a shared class so both frameworks
// can use them identically.
// ---------------------------------------------------------------------------

import { getDashboardSectionPath } from './routes.js'

import type { ApiClient } from './api-client.js'

/**
 * High-level API client for dashboard-specific operations.
 *
 * Wraps the low-level {@link ApiClient} with domain methods for
 * chart data, grouped queries, job management, cache operations,
 * and email previews.
 */
export class DashboardApi {
  constructor(
    private client: ApiClient,
    private basePath: string
  ) {}

  /**
   * Fetch data for a dashboard section, optionally with a query string.
   *
   * @param section     - Section identifier (e.g. `'overview'`, `'queries'`).
   * @param queryString - Optional query string (without leading `?`).
   */
  async fetchSection(section: string, queryString?: string) {
    const path = getDashboardSectionPath(section)
    const url = queryString ? `${this.basePath}${path}?${queryString}` : `${this.basePath}${path}`
    return this.client.fetch<any>(url)
  }

  /**
   * Fetch chart time-series data for the overview section.
   *
   * @param range - Time range identifier (e.g. `'1h'`, `'24h'`).
   */
  async fetchChart(range: string) {
    return this.client.fetch<Record<string, unknown>>(`${this.basePath}/overview/chart?range=${range}`)
  }

  /**
   * Fetch grouped/aggregated query patterns.
   */
  async fetchGroupedQueries() {
    return this.client.fetch<Record<string, unknown>[]>(`${this.basePath}/queries/grouped`)
  }

  /**
   * Run EXPLAIN on a specific query by ID.
   *
   * @param id - Query record ID.
   */
  async explainQuery(id: number) {
    return this.client.fetch<any>(`${this.basePath}/queries/${id}/explain`)
  }

  /**
   * Retry a failed job by ID.
   *
   * @param id - Job record ID.
   */
  async retryJob(id: string) {
    return this.client.fetch<{ message: string }>(`${this.basePath}/jobs/${id}/retry`, { method: 'POST' })
  }

  /**
   * Delete a cache entry by key.
   *
   * @param key - Cache key (will be URI-encoded).
   */
  async deleteCacheKey(key: string) {
    return this.client.fetch<{ deleted: boolean }>(`${this.basePath}/cache/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    })
  }

  /**
   * Fetch the HTML preview for an email record.
   *
   * @param id - Email record ID.
   */
  async fetchEmailPreview(id: number) {
    return this.client.fetch<string>(`${this.basePath}/emails/${id}/preview`)
  }
}
