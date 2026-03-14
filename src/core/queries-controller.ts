// ---------------------------------------------------------------------------
// Headless queries controller
//
// Framework-agnostic state machine for the queries panel. Manages view
// mode, sort, expand/collapse, search, and EXPLAIN state. React wraps
// this with useState, Vue wraps with reactive() — the controller itself
// does not depend on any framework.
// ---------------------------------------------------------------------------

import type { PlanNode } from './explain-utils.js'

/**
 * Result of an EXPLAIN query.
 */
export interface ExplainResult {
  /** Parsed plan nodes (JSON EXPLAIN format). */
  plan?: PlanNode[]
  /** Raw row objects (plain EXPLAIN format). */
  rows?: Record<string, unknown>[]
  /** Error message from the server. */
  error?: string
  /** Additional message from the server. */
  message?: string
}

/**
 * Per-query EXPLAIN loading / result state.
 */
export interface ExplainEntry {
  loading: boolean
  result?: ExplainResult
  error?: string
}

/**
 * Complete state shape managed by {@link QueriesController}.
 */
export interface QueriesControllerState {
  /** Current view mode: individual queries or grouped patterns. */
  viewMode: 'list' | 'grouped'
  /** Active sort column and direction. */
  sort: { key: string; dir: 'asc' | 'desc' }
  /** Set of expanded row IDs (for SQL expand/collapse). */
  expandedIds: Set<number | string>
  /** EXPLAIN state keyed by query ID. */
  explainData: Map<number, ExplainEntry>
  /** Current search / filter string. */
  search: string
}

/**
 * A framework-agnostic headless controller that manages pure state for
 * the queries panel.
 *
 * Every mutation method returns the updated state object so that
 * framework wrappers can trigger a re-render.
 */
export class QueriesController {
  state: QueriesControllerState

  constructor(initialViewMode: 'list' | 'grouped' = 'list') {
    this.state = {
      viewMode: initialViewMode,
      sort: {
        key: initialViewMode === 'list' ? 'createdAt' : 'count',
        dir: 'desc',
      },
      expandedIds: new Set(),
      explainData: new Map(),
      search: '',
    }
  }

  // -----------------------------------------------------------------------
  //  View mode
  // -----------------------------------------------------------------------

  /**
   * Switch between list and grouped view.
   *
   * Resets sort, expanded IDs, EXPLAIN data, and search.
   */
  setViewMode(mode: 'list' | 'grouped'): QueriesControllerState {
    this.state.viewMode = mode
    this.state.sort = {
      key: mode === 'list' ? 'createdAt' : 'count',
      dir: 'desc',
    }
    this.state.expandedIds = new Set()
    this.state.explainData = new Map()
    return this.state
  }

  // -----------------------------------------------------------------------
  //  Sorting
  // -----------------------------------------------------------------------

  /**
   * Toggle sort on a column. If the column is already sorted, flips
   * direction; otherwise sorts descending on the new column.
   */
  toggleSort(key: string): QueriesControllerState {
    if (this.state.sort.key === key) {
      this.state.sort = {
        key,
        dir: this.state.sort.dir === 'asc' ? 'desc' : 'asc',
      }
    } else {
      this.state.sort = { key, dir: 'desc' }
    }
    return this.state
  }

  // -----------------------------------------------------------------------
  //  Expand / collapse
  // -----------------------------------------------------------------------

  /**
   * Toggle the expanded state of a row by its ID.
   */
  toggleExpand(id: number | string): QueriesControllerState {
    if (this.state.expandedIds.has(id)) {
      this.state.expandedIds.delete(id)
    } else {
      this.state.expandedIds.add(id)
    }
    return this.state
  }

  /**
   * Check whether a row is currently expanded.
   */
  isExpanded(id: number | string): boolean {
    return this.state.expandedIds.has(id)
  }

  // -----------------------------------------------------------------------
  //  Search
  // -----------------------------------------------------------------------

  /**
   * Update the search string.
   */
  setSearch(search: string): QueriesControllerState {
    this.state.search = search
    return this.state
  }

  // -----------------------------------------------------------------------
  //  EXPLAIN lifecycle
  // -----------------------------------------------------------------------

  /**
   * Mark a query as loading its EXPLAIN plan.
   */
  startExplain(queryId: number): void {
    this.state.explainData.set(queryId, { loading: true })
  }

  /**
   * Store a successful EXPLAIN result for a query.
   */
  completeExplain(queryId: number, result: ExplainResult): void {
    this.state.explainData.set(queryId, { loading: false, result })
  }

  /**
   * Store an EXPLAIN error for a query.
   */
  failExplain(queryId: number, error: string): void {
    this.state.explainData.set(queryId, { loading: false, error })
  }

  /**
   * Clear all EXPLAIN data.
   */
  clearExplain(): void {
    this.state.explainData = new Map()
  }

  /**
   * Get the current EXPLAIN state for a specific query.
   */
  getExplainState(queryId: number): ExplainEntry | undefined {
    return this.state.explainData.get(queryId)
  }
}
