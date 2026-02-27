// ---------------------------------------------------------------------------
// Debug data records
// ---------------------------------------------------------------------------

/**
 * A captured SQL query from the `db:query` event.
 *
 * Stored in a {@link RingBuffer} by the {@link QueryCollector} and
 * served via the debug API endpoint.
 */
export interface QueryRecord {
  /** Auto-incrementing sequence number. */
  id: number

  /** The SQL query string (may contain `?` placeholders). */
  sql: string

  /** Bound parameter values for the query placeholders. */
  bindings: unknown[]

  /** Query execution time in **milliseconds**. */
  duration: number

  /** Knex query method (e.g. `'select'`, `'insert'`, `'raw'`). */
  method: string

  /** Lucid model name if the query originated from a model, or `null`. */
  model: string | null

  /** Database connection name (e.g. `'postgres'`). */
  connection: string

  /** Whether this query ran inside a transaction. */
  inTransaction: boolean

  /** Unix timestamp in **milliseconds** when the query was captured. */
  timestamp: number
}

/**
 * A captured application event from the AdonisJS emitter.
 *
 * Stored by the {@link EventCollector} and served via the debug
 * API endpoint.
 */
export interface EventRecord {
  /** Auto-incrementing sequence number. */
  id: number

  /** Fully-qualified event name (e.g. `'user:registered'`). */
  event: string

  /** JSON-serialized event payload, or `null` if not serializable. */
  data: string | null

  /** Unix timestamp in **milliseconds** when the event was emitted. */
  timestamp: number
}

/**
 * A captured email sent via AdonisJS mail.
 *
 * Stored in a {@link RingBuffer} by the {@link EmailCollector} and
 * served via the debug API endpoint.
 */
export interface EmailRecord {
  /** Auto-incrementing sequence number. */
  id: number

  /** Sender address (e.g. `"noreply@example.com"`). */
  from: string

  /** Comma-separated recipient addresses. */
  to: string

  /** CC recipients, or `null` if none. */
  cc: string | null

  /** BCC recipients, or `null` if none. */
  bcc: string | null

  /** Email subject line. */
  subject: string

  /** Full HTML body for iframe preview, or `null`. */
  html: string | null

  /** Plain-text body, or `null`. */
  text: string | null

  /** Mailer name (e.g. `"smtp"`, `"ses"`). */
  mailer: string

  /** Current delivery status. */
  status: 'sending' | 'sent' | 'queued' | 'failed'

  /** Message ID from the mail transport response, or `null`. */
  messageId: string | null

  /** Number of file attachments. */
  attachmentCount: number

  /** Unix timestamp in **milliseconds** when the email was captured. */
  timestamp: number
}

/**
 * A registered route extracted from the AdonisJS router.
 *
 * Cached at boot by the {@link RouteInspector} and served via
 * the debug API endpoint.
 */
export interface RouteRecord {
  /** HTTP method (e.g. `'GET'`, `'POST'`). */
  method: string

  /** Route pattern (e.g. `'/users/:id'`). */
  pattern: string

  /** Named route identifier, or `null` if unnamed. */
  name: string | null

  /** Controller method reference (e.g. `'UsersController.show'`). */
  handler: string

  /**
   * Middleware stack applied to this route.
   *
   * Each entry is the middleware name or class reference as a string.
   */
  middleware: string[]
}

// ---------------------------------------------------------------------------
// Request tracing
// ---------------------------------------------------------------------------

/**
 * A single span within a request trace.
 *
 * Represents a timed operation (DB query, middleware, custom code block)
 * that occurred during an HTTP request. Spans can be nested via `parentId`.
 */
export interface TraceSpan {
  /** Unique span ID within the trace. */
  id: string

  /** Parent span ID, or `null` for root-level spans. */
  parentId: string | null

  /** Human-readable label (e.g. `"SELECT * FROM users"`, `"auth middleware"`). */
  label: string

  /** Category for color-coding and grouping in the timeline. */
  category: 'request' | 'middleware' | 'db' | 'view' | 'mail' | 'event' | 'custom'

  /** Milliseconds from request start to span start. */
  startOffset: number

  /** Span duration in milliseconds. */
  duration: number

  /** Optional metadata (query bindings, status code, etc.). */
  metadata?: Record<string, unknown>
}

/**
 * A complete trace for a single HTTP request.
 *
 * Contains all spans captured during the request lifecycle,
 * stored in a {@link RingBuffer} by the {@link TraceCollector}.
 */
export interface TraceRecord {
  /** Auto-incrementing sequence number. */
  id: number

  /** HTTP method (e.g. `'GET'`, `'POST'`). */
  method: string

  /** Request URL including query string. */
  url: string

  /** HTTP response status code. */
  statusCode: number

  /** Total request duration in milliseconds. */
  totalDuration: number

  /** Number of spans captured. */
  spanCount: number

  /** All spans captured during this request. */
  spans: TraceSpan[]

  /** Warnings captured via `console.warn` during this request. */
  warnings: string[]

  /** Unix timestamp in **milliseconds** when the request started. */
  timestamp: number
}

// ---------------------------------------------------------------------------
// Dev toolbar internal config (resolved defaults)
// ---------------------------------------------------------------------------

/**
 * Resolved dev toolbar configuration with all defaults applied.
 *
 * This is the internal representation used by {@link DebugStore}.
 * For the user-facing config type, see {@link DevToolbarOptions}.
 */
export interface DevToolbarConfig {
  /** Whether the dev toolbar is enabled. */
  enabled: boolean

  /** Maximum SQL queries to buffer. */
  maxQueries: number

  /** Maximum events to buffer. */
  maxEvents: number

  /** Maximum emails to buffer. */
  maxEmails: number

  /** Slow query highlight threshold in **milliseconds**. */
  slowQueryThresholdMs: number

  /** Whether/where to persist debug data to disk across restarts. */
  persistDebugData: boolean | string

  /** Whether per-request tracing is enabled. */
  tracing: boolean

  /** Maximum traces to keep in the ring buffer. */
  maxTraces: number

  /** Whether the full-page dashboard is enabled. */
  dashboard: boolean

  /** URL path for the full-page dashboard. */
  dashboardPath: string

  /** Data retention period in days for historical persistence. */
  retentionDays: number

  /** Path to the SQLite database file for historical persistence. */
  dbPath: string

  /** Base path for the debug toolbar API endpoints. */
  debugEndpoint: string
}

// ---------------------------------------------------------------------------
// Custom debug panes
// ---------------------------------------------------------------------------

/**
 * Color names available for the `badge` column format.
 *
 * Used in {@link DebugPaneColumn.badgeColorMap} to map cell values
 * to colored pill badges.
 */
export type BadgeColor = 'green' | 'amber' | 'red' | 'blue' | 'purple' | 'muted'

/**
 * Cell format types for debug pane columns.
 *
 * Each format controls how a cell value is rendered in the debug panel:
 *
 * | Format     | Renders as                              | Input type              |
 * |------------|-----------------------------------------|-------------------------|
 * | `text`     | Escaped plain text                      | any (toString)          |
 * | `time`     | `HH:MM:SS.mmm`                         | Unix timestamp (ms)     |
 * | `timeAgo`  | `3s ago`, `2m ago`                      | Unix timestamp (ms)     |
 * | `duration` | `X.XXms` with green/amber/red coloring  | number (milliseconds)   |
 * | `method`   | HTTP method pill badge                  | `'GET'`, `'POST'`, etc. |
 * | `json`     | Compact preview, click to expand        | object or array         |
 * | `badge`    | Colored pill via `badgeColorMap`         | string (mapped to color)|
 */
export type DebugPaneFormatType =
  | 'text'
  | 'time'
  | 'timeAgo'
  | 'duration'
  | 'method'
  | 'json'
  | 'badge'

/**
 * Column definition for a custom debug pane table.
 *
 * Each column maps a key from the JSON response to a table cell
 * with optional formatting, search capability, and click-to-filter.
 *
 * @example
 * ```ts
 * const columns: DebugPaneColumn[] = [
 *   { key: 'id', label: '#', width: '40px' },
 *   { key: 'event', label: 'Event', searchable: true },
 *   { key: 'status', label: 'Status', format: 'badge',
 *     badgeColorMap: { ok: 'green', error: 'red' } },
 *   { key: 'duration', label: 'Duration', width: '70px', format: 'duration' },
 *   { key: 'timestamp', label: 'Time', width: '80px', format: 'timeAgo' },
 * ]
 * ```
 */
export interface DebugPaneColumn {
  /** JSON field name to read from each row object. */
  key: string

  /** Column header text displayed in the table. */
  label: string

  /**
   * CSS width for the column (e.g. `'60px'`, `'10%'`).
   *
   * When omitted, the column auto-sizes to fit content.
   */
  width?: string

  /**
   * How to format the cell value.
   * @default 'text'
   * @see {@link DebugPaneFormatType}
   */
  format?: DebugPaneFormatType

  /**
   * Include this column's values in the search/filter index.
   *
   * When `true`, typing in the search bar will match against
   * this column's content.
   * @default false
   */
  searchable?: boolean

  /**
   * Allow clicking a cell value to set it as the active search filter.
   *
   * Useful for columns like "status" or "method" where users want
   * to quickly filter by a specific value.
   * @default false
   */
  filterable?: boolean

  /**
   * Value-to-color mapping for the `'badge'` format.
   *
   * Keys are the possible cell values (case-sensitive), and values
   * are {@link BadgeColor} names.
   *
   * @example
   * ```ts
   * badgeColorMap: {
   *   delivered: 'green',
   *   pending: 'amber',
   *   failed: 'red',
   * }
   * ```
   */
  badgeColorMap?: Record<string, BadgeColor>
}

/**
 * Search bar configuration for a custom debug pane.
 */
export interface DebugPaneSearch {
  /** Placeholder text shown in the search input. */
  placeholder: string
}

/**
 * A custom tab in the dev toolbar debug panel.
 *
 * Each pane fetches JSON from an HTTP endpoint and renders the data
 * as a table with configurable columns, search, and formatting.
 *
 * The JSON response must contain an array under a key matching
 * the pane `id` (or `dataKey` if specified).
 *
 * @example
 * ```ts
 * import type { DebugPane } from 'adonisjs-server-stats'
 *
 * const webhooksPane: DebugPane = {
 *   id: 'webhooks',
 *   label: 'Webhooks',
 *   endpoint: '/admin/api/debug/webhooks',
 *   columns: [
 *     { key: 'id', label: '#', width: '40px' },
 *     { key: 'event', label: 'Event', searchable: true },
 *     { key: 'status', label: 'Status', format: 'badge',
 *       badgeColorMap: { delivered: 'green', failed: 'red' } },
 *   ],
 *   search: { placeholder: 'Filter webhooks...' },
 *   clearable: true,
 * }
 * ```
 */
export interface DebugPane {
  /**
   * Unique pane identifier (kebab-case recommended).
   *
   * Also used as the default key to extract the data array from
   * the JSON response (unless `dataKey` is set).
   */
  id: string

  /** Display label shown on the tab button. */
  label: string

  /** API endpoint URL that returns the pane's data as JSON. */
  endpoint: string

  /**
   * Column definitions controlling how each field is rendered.
   * @see {@link DebugPaneColumn}
   */
  columns: DebugPaneColumn[]

  /**
   * Enable and configure the search bar.
   *
   * When set, a search input appears above the table. Columns
   * with `searchable: true` are included in the filter index.
   */
  search?: DebugPaneSearch

  /**
   * JSON response key containing the data array.
   *
   * Supports dot notation for nested keys (e.g. `'data.items'`).
   *
   * @default Same as `id`
   */
  dataKey?: string

  /**
   * Cache the response after the first fetch.
   *
   * Useful for static data like the route table that doesn't
   * change at runtime.
   *
   * @default false
   */
  fetchOnce?: boolean

  /**
   * Show a "Clear" button to reset/empty the pane data.
   *
   * Useful for accumulated data like logs or events.
   *
   * @default false
   */
  clearable?: boolean
}
