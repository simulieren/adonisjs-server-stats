// ---------------------------------------------------------------------------
// Pagination, filter, and sort utilities
// ---------------------------------------------------------------------------

import type { PaginationState, FilterState, SortState } from './types.js'

/**
 * Shape of a raw paginated API response before parsing.
 */
export interface RawPaginatedResponse {
  data?: unknown[]
  items?: unknown[]
  total?: number
  page?: number
  perPage?: number
  limit?: number
  totalPages?: number
}

/**
 * Default number of items per page.
 */
export const DEFAULT_PER_PAGE = 50

/**
 * Build a URL query string from pagination, filter, and sort state.
 *
 * @param pagination - Current pagination state.
 * @param filters    - Optional filter state (search + key-value filters).
 * @param sort       - Optional sort state.
 * @returns A query string (without leading `?`), e.g. `"page=2&limit=50&search=foo"`.
 */
export function buildQueryString(
  pagination: Pick<PaginationState, 'page' | 'perPage'>,
  filters?: FilterState,
  sort?: SortState
): string {
  const params = new URLSearchParams()

  params.set('page', String(pagination.page))
  params.set('limit', String(pagination.perPage))

  if (filters) {
    if (filters.search) {
      params.set('search', filters.search)
    }
    for (const [key, value] of Object.entries(filters.filters)) {
      if (value) {
        params.set(key, value)
      }
    }
  }

  if (sort) {
    params.set('sort', sort.field)
    params.set('direction', sort.direction)
  }

  return params.toString()
}

/**
 * Parse a paginated API response into typed data and pagination state.
 *
 * Expects the response to have the shape:
 * ```json
 * {
 *   "data": [...],
 *   "total": 100,
 *   "page": 1,
 *   "perPage": 50,
 *   "totalPages": 2
 * }
 * ```
 *
 * Also supports the alternate shape used by some endpoints:
 * ```json
 * {
 *   "items": [...],
 *   "total": 100,
 *   "page": 1
 * }
 * ```
 *
 * @param response - Raw API response object.
 * @param perPage  - Items per page (used to compute `totalPages` if missing).
 * @returns An object with `data` array and `pagination` state.
 */
export function parsePaginatedResponse<T>(
  response: RawPaginatedResponse,
  perPage: number = DEFAULT_PER_PAGE
): { data: T[]; pagination: PaginationState } {
  const data: T[] = (response.data ?? response.items ?? []) as T[]
  const total: number = response.total ?? 0
  const page: number = response.page ?? 1
  const resolvedPerPage: number = response.perPage ?? response.limit ?? perPage
  const totalPages: number = response.totalPages ?? (Math.ceil(total / resolvedPerPage) || 1)

  return {
    data,
    pagination: {
      page,
      perPage: resolvedPerPage,
      total,
      totalPages,
    },
  }
}

/**
 * Create an initial pagination state.
 *
 * @param perPage - Items per page. Defaults to {@link DEFAULT_PER_PAGE}.
 */
export function createPaginationState(perPage: number = DEFAULT_PER_PAGE): PaginationState {
  return {
    page: 1,
    perPage,
    total: 0,
    totalPages: 1,
  }
}

/**
 * Create an initial filter state.
 */
export function createFilterState(): FilterState {
  return {
    search: '',
    filters: {},
  }
}

/**
 * Create an initial sort state.
 *
 * @param field     - Default sort field.
 * @param direction - Default sort direction.
 */
export function createSortState(field: string = 'id', direction: 'asc' | 'desc' = 'desc'): SortState {
  return { field, direction }
}

/**
 * Build a URL query parameter string from dashboard hook options.
 *
 * Accepts the flat options shape used by React/Vue hooks and converts
 * it to a query string compatible with the dashboard API.
 *
 * @param options - Dashboard hook options (page, perPage, search, sort, etc.).
 * @returns A query string (without leading `?`).
 */
export function buildQueryParams(options: {
  page?: number
  perPage?: number
  search?: string
  sort?: string
  sortDir?: 'asc' | 'desc'
  filters?: Record<string, string>
  timeRange?: string
}): string {
  const params = new URLSearchParams()

  if (options.page != null) params.set('page', String(options.page))
  if (options.perPage != null) params.set('limit', String(options.perPage))
  if (options.search) params.set('search', options.search)
  if (options.sort) params.set('sort', options.sort)
  if (options.sortDir) params.set('direction', options.sortDir)
  if (options.timeRange) params.set('range', options.timeRange)

  if (options.filters) {
    for (const [key, value] of Object.entries(options.filters)) {
      if (value) params.set(key, value)
    }
  }

  return params.toString()
}

/**
 * Computed pagination info for UI rendering.
 *
 * Provides `from`, `to`, `lastPage`, `hasPrev`, `hasNext` derived
 * from the raw pagination state.
 *
 * @param state - Raw pagination state with page, perPage, total.
 * @returns Computed pagination values.
 */
export function computePagination(state: { page: number; perPage: number; total: number }): {
  page: number
  perPage: number
  total: number
  lastPage: number
  from: number
  to: number
  hasPrev: boolean
  hasNext: boolean
} {
  const lastPage = Math.max(1, Math.ceil(state.total / state.perPage))
  const page = Math.min(state.page, lastPage)
  const from = state.total === 0 ? 0 : (page - 1) * state.perPage + 1
  const to = Math.min(page * state.perPage, state.total)

  return {
    page,
    perPage: state.perPage,
    total: state.total,
    lastPage,
    from,
    to,
    hasPrev: page > 1,
    hasNext: page < lastPage,
  }
}

/**
 * Generate an array of page numbers (and ellipsis markers) for pagination UI.
 *
 * Always shows the first page, last page, and a window of pages around
 * the current page. Gaps are represented by `'...'`.
 *
 * @param currentPage - The current page number (1-based).
 * @param lastPage    - The total number of pages.
 * @param window      - Number of pages to show on each side of current. Defaults to 2.
 * @returns An array of page numbers and `'...'` markers.
 */
export function getPageNumbers(
  currentPage: number,
  lastPage: number,
  window: number = 2
): (number | '...')[] {
  if (lastPage <= 1) return [1]

  const pages: (number | '...')[] = []
  const rangeStart = Math.max(2, currentPage - window)
  const rangeEnd = Math.min(lastPage - 1, currentPage + window)

  // Always include page 1
  pages.push(1)

  // Ellipsis after page 1 if range doesn't start at 2
  if (rangeStart > 2) {
    pages.push('...')
  }

  // Pages in the window around current
  for (let i = rangeStart; i <= rangeEnd; i++) {
    pages.push(i)
  }

  // Ellipsis before last page if range doesn't reach it
  if (rangeEnd < lastPage - 1) {
    pages.push('...')
  }

  // Always include last page (if different from 1)
  if (lastPage > 1) {
    pages.push(lastPage)
  }

  return pages
}
