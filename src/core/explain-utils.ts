// ---------------------------------------------------------------------------
// EXPLAIN plan utilities
//
// Extracted from the React/Vue QueriesSection components so that every
// frontend uses identical business logic for EXPLAIN plan processing.
// ---------------------------------------------------------------------------

/**
 * A node in a PostgreSQL EXPLAIN (JSON) plan tree.
 */
export interface PlanNode {
  'Node Type'?: string
  'Relation Name'?: string
  Alias?: string
  'Index Name'?: string
  'Startup Cost'?: number | null
  'Total Cost'?: number | null
  'Plan Rows'?: number | null
  'Plan Width'?: number | null
  Filter?: string
  'Index Cond'?: string
  'Hash Cond'?: string
  'Join Type'?: string
  'Sort Key'?: string | string[]
  Plans?: PlanNode[]
  [key: string]: unknown
}

/**
 * A flattened plan node for iteration-based rendering (no recursion needed
 * in the template layer).
 */
export interface FlatPlanNode {
  /** Nesting depth (0 = root). */
  depth: number
  /** Node type label (e.g. `"Seq Scan"`, `"Hash Join"`). */
  nodeType: string
  /** Relation (table) name, if any. */
  relationName: string
  /** Alias for the relation, if different from `relationName`. */
  alias: string
  /** Index name used, if any. */
  indexName: string
  /** Human-readable metric strings (cost, rows, width, filters, etc.). */
  metrics: string[]
  /** Whether this is the root node (depth === 0). */
  isRoot: boolean
}

/**
 * Extract human-readable metric strings from a plan node.
 *
 * Produces entries like `"cost=0.00..1.23"`, `"rows=100"`, `"width=50"`,
 * `"filter: ..."`, etc.
 */
export function formatPlanNodeMetrics(node: PlanNode): string[] {
  const metrics: string[] = []
  if (node['Startup Cost'] !== null && node['Startup Cost'] !== undefined)
    metrics.push(`cost=${node['Startup Cost']}..${node['Total Cost']}`)
  if (node['Plan Rows'] !== null && node['Plan Rows'] !== undefined)
    metrics.push(`rows=${node['Plan Rows']}`)
  if (node['Plan Width'] !== null && node['Plan Width'] !== undefined)
    metrics.push(`width=${node['Plan Width']}`)
  if (node['Filter']) metrics.push(`filter: ${node['Filter']}`)
  if (node['Index Cond']) metrics.push(`cond: ${node['Index Cond']}`)
  if (node['Hash Cond']) metrics.push(`hash: ${node['Hash Cond']}`)
  if (node['Join Type']) metrics.push(`join: ${node['Join Type']}`)
  if (node['Sort Key']) {
    const sortKey = Array.isArray(node['Sort Key']) ? node['Sort Key'].join(', ') : node['Sort Key']
    metrics.push(`sort: ${sortKey}`)
  }
  return metrics
}

/**
 * Recursively flatten a plan tree into an array of {@link FlatPlanNode}
 * objects that any framework can render with simple iteration.
 *
 * @param node  - The root (or current) plan node.
 * @param depth - Current nesting depth (default `0`).
 */
export function flattenPlanTree(node: PlanNode, depth: number = 0): FlatPlanNode[] {
  if (!node) return []

  const flat: FlatPlanNode = {
    depth,
    nodeType: node['Node Type'] || 'Unknown',
    relationName: node['Relation Name'] || '',
    alias:
      node['Alias'] && node['Alias'] !== node['Relation Name'] ? node['Alias'] : '',
    indexName: node['Index Name'] || '',
    metrics: formatPlanNodeMetrics(node),
    isRoot: depth === 0,
  }

  const result: FlatPlanNode[] = [flat]
  const children = node['Plans'] || []
  for (const child of children) {
    result.push(...flattenPlanTree(child, depth + 1))
  }
  return result
}

/**
 * Check whether an EXPLAIN result has a nested `Plan` structure (JSON
 * format) as opposed to plain tabular rows.
 *
 * @param data - The first element of the EXPLAIN result array.
 */
export function hasNestedPlan(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  return 'Plan' in (data as Record<string, unknown>)
}

/**
 * Extract column headers from plain (non-JSON) EXPLAIN rows.
 *
 * Returns the keys of the first row object, which serve as column headers
 * for a simple table display.
 *
 * @param rows - Array of row objects from the EXPLAIN result.
 */
export function getExplainColumns(rows: Record<string, unknown>[]): string[] {
  if (!rows || rows.length === 0) return []
  const first = rows[0]
  if (!first || typeof first !== 'object') return []
  return Object.keys(first)
}

/**
 * Format a cell value for display in an EXPLAIN result table.
 *
 * Returns `'-'` for `null` / `undefined` values.
 */
export function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return '-'
  return String(value)
}
