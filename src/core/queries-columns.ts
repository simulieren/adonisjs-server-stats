// ---------------------------------------------------------------------------
// Query column definitions
//
// Shared column configurations for the queries feature. Both the dashboard
// and debug pane use these definitions to keep column order, labels, and
// widths in sync across React and Vue.
// ---------------------------------------------------------------------------

/**
 * Describes a single column in a queries table.
 */
export interface QueriesColumnDef {
  /** Field key used to look up the value from a row. */
  key: string
  /** Header label displayed in the `<th>`. */
  label: string
  /** Optional fixed width (CSS value). */
  width?: string
  /** Whether the column supports click-to-sort. */
  sortable?: boolean
  /**
   * Semantic type hint that the rendering layer can use to pick the
   * appropriate cell formatter / component.
   */
  type?: 'sql' | 'duration' | 'method' | 'model' | 'time' | 'index' | 'connection' | 'explain'
}

/**
 * Return the 6 columns used in the debug-pane queries tab.
 *
 * Columns: #, SQL, Duration, Method, Model, Time.
 */
export function getDebugPaneColumns(): QueriesColumnDef[] {
  return [
    { key: 'id', label: '#', width: '50px', type: 'index' },
    { key: 'sql', label: 'SQL', type: 'sql' },
    { key: 'duration', label: 'Duration', width: '80px', type: 'duration' },
    { key: 'method', label: 'Method', width: '70px', type: 'method' },
    { key: 'model', label: 'Model', width: '100px', type: 'model' },
    { key: 'timestamp', label: 'Time', width: '80px', type: 'time' },
  ]
}

/**
 * Return the columns used in the dashboard list view.
 *
 * Columns: #, SQL, Duration, Method, Model, Connection, Time, and
 * optionally an Explain button column.
 *
 * @param opts.showExplain - Whether to include the Explain button column
 *                           (default `true`).
 */
export function getDashboardListColumns(
  opts?: { showExplain?: boolean }
): QueriesColumnDef[] {
  const showExplain = opts?.showExplain ?? true
  const cols: QueriesColumnDef[] = [
    { key: 'id', label: '#', width: '40px', type: 'index' },
    { key: 'sql', label: 'SQL', type: 'sql' },
    { key: 'duration', label: 'Duration', width: '70px', sortable: true, type: 'duration' },
    { key: 'method', label: 'Method', width: '60px', type: 'method' },
    { key: 'model', label: 'Model', width: '90px', type: 'model' },
    { key: 'connection', label: 'Connection', width: '80px', type: 'connection' },
    { key: 'createdAt', label: 'Time', width: '90px', sortable: true, type: 'time' },
  ]
  if (showExplain) {
    cols.push({ key: 'id', label: '', width: '70px', type: 'explain' })
  }
  return cols
}

/**
 * Return the columns used in the dashboard grouped view.
 *
 * Columns: SQL (Pattern), Count, Avg, Min, Max, Total, % Time.
 */
export function getDashboardGroupedColumns(): QueriesColumnDef[] {
  return [
    { key: 'sqlNormalized', label: 'Pattern', type: 'sql' },
    { key: 'count', label: 'Count', width: '60px', sortable: true },
    { key: 'avgDuration', label: 'Avg', width: '70px', sortable: true, type: 'duration' },
    { key: 'minDuration', label: 'Min', width: '70px', type: 'duration' },
    { key: 'maxDuration', label: 'Max', width: '70px', type: 'duration' },
    { key: 'totalDuration', label: 'Total', width: '70px', sortable: true, type: 'duration' },
    { key: 'percentOfTotal', label: '% Time', width: '60px' },
  ]
}
