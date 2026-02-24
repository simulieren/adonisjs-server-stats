# Spec: Full-Page Dashboard for adonisjs-server-stats

## Overview

A dedicated full-page dashboard accessible at a configurable URL path, providing a comprehensive view of all debug information (queries, events, routes, logs, emails, timeline/tracing) plus new sections (cache inspector, jobs/queue monitor, config viewer). Serves its own standalone Edge layout with system-preference-aware theming (light/dark), collapsible sidebar navigation, real-time streaming via Transmit, historical persistence via SQLite (Lucid dedicated connection), and deep-link integration with the existing debug panel.

---

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Page rendering | Edge template, own minimal layout | Self-contained dark/light layout, no host app dependency |
| Data relationship | Enhanced full page | Additional capabilities (EXPLAIN, grouping, history, streaming) beyond the panel |
| Real-time updates | Transmit (SSE) with polling fallback | Leverage existing AdonisJS infrastructure, graceful degradation |
| URL path | Fully configurable (default `/__stats`) | Avoid conflicts, user control |
| Auth/access control | Reuse `shouldShow` callback | Consistent gating with existing panel |
| Historical storage | SQLite via Lucid dedicated connection | Zero-config file-based DB, auto-excludes own queries from collection |
| Migration strategy | Auto-migrate on boot | Zero friction, tables created if missing |
| Query analysis | EXPLAIN (without ANALYZE) + query grouping | Safe execution (no actual query run), useful pattern analysis |
| N+1 detection | Skipped | No reliable detection method without false positives |
| Navigation | SPA-like tabs with collapsible sidebar | Fast tab switching, scalable to many sections |
| Theme | System preference (prefers-color-scheme) | Light + dark themes, respects user OS setting |
| Data retention | Time-based, 7 days (configurable) | Predictable disk usage, auto-prune old records |
| Landing page | Overview dashboard (performance focused) | Avg/P95 response time, slowest endpoints, request volume chart |
| Live updates | Always live when dashboard is open | All sections auto-update via Transmit subscription |
| Charts | Pure SVG/CSS | Zero dependencies, minimal bundle, self-contained |
| Chart ranges | Selectable (1h / 6h / 24h / 7d) | Flexible time analysis with appropriate granularity |
| Panel deep links | Open in new tab | Preserve app context, reference both simultaneously |
| Self-exclusion | Always exclude own queries/requests | Dashboard routes and SQLite queries filtered from collectors |
| Log search | Structured JSON + saved filter presets | Parse JSON fields, filter by key, save named presets |
| New sections | Cache + Jobs/Queue + Config viewer | Comprehensive debugging without external tools |
| Queue integration | Optional (detect @rlanz/bull-queue) | Only show queue section if Bull Queue is installed |
| Config viewer | Sanitized auto-detect | Show config with auto-redacted secrets |
| Custom panes | Extend to dashboard | User-registered panes appear in sidebar too |
| Table prefix | `server_stats_` | Explicit, low conflict risk |
| Scope | Full implementation | All features in one release |
| DB connection | Dedicated Lucid connection (SQLite) | Isolate debug data, exclude from collection |
| Environments | Always available if enabled in config | Trust shouldShow for access control |

---

## Configuration

### New `DevToolbarOptions` fields

```typescript
interface DevToolbarOptions {
  // ... existing fields ...

  /**
   * Enable the full-page dashboard.
   * Serves a standalone HTML page at `dashboardPath`.
   * @default false
   */
  dashboard?: boolean

  /**
   * URL path for the full-page dashboard.
   * Must start with `/`.
   * @default '/__stats'
   */
  dashboardPath?: string

  /**
   * Data retention period in days for historical persistence.
   * Records older than this are auto-pruned on startup and periodically.
   * @default 7
   */
  retentionDays?: number

  /**
   * Path to the SQLite database file for historical persistence.
   * Relative to app root.
   * @default 'tmp/server-stats.sqlite3'
   */
  dbPath?: string
}
```

### Example config

```typescript
// config/server_stats.ts
export default defineConfig({
  devToolbar: {
    enabled: true,
    tracing: true,
    dashboard: true,
    dashboardPath: '/__stats',
    retentionDays: 7,
    dbPath: 'tmp/server-stats.sqlite3',
  },
  // ...
})
```

---

## Database Schema

All tables use `server_stats_` prefix. SQLite database at configurable path (default `tmp/server-stats.sqlite3`). Uses a dedicated Lucid connection named `server_stats` registered at boot.

### Tables

#### `server_stats_requests`

Stores request summaries for the overview and history browsing.

```sql
CREATE TABLE IF NOT EXISTS server_stats_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  method TEXT NOT NULL,
  url TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  duration REAL NOT NULL,           -- ms
  span_count INTEGER DEFAULT 0,
  warning_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ss_requests_created ON server_stats_requests(created_at);
CREATE INDEX IF NOT EXISTS idx_ss_requests_url ON server_stats_requests(url);
```

#### `server_stats_queries`

Stores individual SQL queries for history and grouping/analysis.

```sql
CREATE TABLE IF NOT EXISTS server_stats_queries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER REFERENCES server_stats_requests(id) ON DELETE CASCADE,
  sql_text TEXT NOT NULL,
  sql_normalized TEXT NOT NULL,     -- parameterized form for grouping
  bindings TEXT,                    -- JSON
  duration REAL NOT NULL,           -- ms
  method TEXT,                      -- select, insert, etc.
  model TEXT,
  connection TEXT,
  in_transaction INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ss_queries_created ON server_stats_queries(created_at);
CREATE INDEX IF NOT EXISTS idx_ss_queries_normalized ON server_stats_queries(sql_normalized);
CREATE INDEX IF NOT EXISTS idx_ss_queries_request ON server_stats_queries(request_id);
```

#### `server_stats_events`

```sql
CREATE TABLE IF NOT EXISTS server_stats_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER REFERENCES server_stats_requests(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  data TEXT,                        -- JSON payload
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ss_events_created ON server_stats_events(created_at);
```

#### `server_stats_emails`

```sql
CREATE TABLE IF NOT EXISTS server_stats_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_addr TEXT NOT NULL,
  to_addr TEXT NOT NULL,
  cc TEXT,
  bcc TEXT,
  subject TEXT NOT NULL,
  html TEXT,
  text_body TEXT,
  mailer TEXT NOT NULL,
  status TEXT NOT NULL,
  message_id TEXT,
  attachment_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ss_emails_created ON server_stats_emails(created_at);
```

#### `server_stats_logs`

```sql
CREATE TABLE IF NOT EXISTS server_stats_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL,              -- error, warn, info, debug
  message TEXT NOT NULL,
  request_id TEXT,
  data TEXT,                        -- full JSON log entry
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ss_logs_created ON server_stats_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_ss_logs_level ON server_stats_logs(level);
CREATE INDEX IF NOT EXISTS idx_ss_logs_request ON server_stats_logs(request_id);
```

#### `server_stats_traces`

Stores complete trace records (spans embedded as JSON).

```sql
CREATE TABLE IF NOT EXISTS server_stats_traces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER REFERENCES server_stats_requests(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  url TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  total_duration REAL NOT NULL,
  span_count INTEGER DEFAULT 0,
  spans TEXT NOT NULL,              -- JSON array of TraceSpan[]
  warnings TEXT,                    -- JSON array of string[]
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ss_traces_created ON server_stats_traces(created_at);
```

#### `server_stats_metrics`

Time-series aggregated metrics for overview charts.

```sql
CREATE TABLE IF NOT EXISTS server_stats_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket TEXT NOT NULL,             -- ISO timestamp rounded to interval
  request_count INTEGER DEFAULT 0,
  avg_duration REAL DEFAULT 0,
  p95_duration REAL DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  query_count INTEGER DEFAULT 0,
  avg_query_duration REAL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ss_metrics_bucket ON server_stats_metrics(bucket);
```

#### `server_stats_saved_filters`

Stores user-created log filter presets.

```sql
CREATE TABLE IF NOT EXISTS server_stats_saved_filters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  section TEXT NOT NULL,            -- 'logs', 'queries', etc.
  filter_config TEXT NOT NULL,      -- JSON { level: 'error', field: 'userId', value: '5' }
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Auto-migration

On provider boot (when `dashboard: true`):

1. Register a dedicated Lucid connection named `server_stats` pointing to the SQLite file
2. Check if tables exist using `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'server_stats_%'`
3. Create any missing tables via raw SQL (not Lucid migrations — avoids polluting the user's migration history)
4. Run retention cleanup: `DELETE FROM server_stats_requests WHERE created_at < datetime('now', '-7 days')` (cascades to queries, events, traces)

### Self-exclusion

All collectors must check if the current request URL starts with the configured `dashboardPath`. If so, skip recording. The dedicated `server_stats` connection name is also excluded from the `db:query` event listener by checking `data.connection !== 'server_stats'`.

---

## UI Layout

### Page Structure

```
+------------------------------------------------------------------+
| Logo/Title          Search (global)                Toggle Theme   |
+--------+---------------------------------------------------------+
|        |                                                         |
| [icon] | Overview                                                |
| [icon] | Requests                                                |
| [icon] | Queries                                                 |
| [icon] | Events                                                  |
| [icon] | Routes                                                  |
| [icon] | Logs                                                    |
| [icon] | Emails                                                  |
| [icon] | Timeline          MAIN CONTENT AREA                     |
| [icon] | Cache                                                   |
| [icon] | Jobs                                                    |
| [icon] | Config                                                  |
| ----   |                                                         |
| [icon] | Custom Pane 1                                           |
| [icon] | Custom Pane 2                                           |
|        |                                                         |
| [<<]   |                                                         |
+--------+---------------------------------------------------------+
```

### Sidebar

- Collapsible (toggle button at bottom)
- Collapsed state: icons only (56px wide)
- Expanded state: icon + label (220px wide)
- Sections: Overview, Requests, Queries, Events, Routes, Logs, Emails, Timeline, Cache, Jobs, Config
- Separator line before custom panes
- Active section highlighted with accent color
- Badge counts on sections (e.g., error count on Logs, slow query count on Queries)

### Header

- Package name/logo left
- Live indicator (green dot + "Live" when Transmit connected)
- Theme toggle (sun/moon icon)
- Link back to app

### Theming

Two complete themes responding to `prefers-color-scheme`:

**Dark theme** (default when system prefers dark):
- Background: `#0f0f0f` (matching existing panel)
- Surface: `#171717`
- Text: `#d4d4d4`
- Accent: `#34d399` (emerald)

**Light theme** (when system prefers light):
- Background: `#fafafa`
- Surface: `#ffffff`
- Text: `#171717`
- Accent: `#059669` (darker emerald)

Implemented via CSS custom properties and `@media (prefers-color-scheme: ...)`.

---

## Sections Detail

### 1. Overview (Landing Page)

Performance-focused summary cards:

**Top row — Key metrics cards:**
- **Avg Response Time** — Current average with sparkline showing trend
- **P95 Response Time** — 95th percentile with sparkline
- **Requests/min** — Current rate with sparkline
- **Error Rate** — Percentage with sparkline

**Request volume chart:**
- Pure SVG bar chart showing requests over time
- Selectable range: 1h (per minute), 6h (per 5min), 24h (per 15min), 7d (per hour)
- Color-coded bars: green (2xx), blue (3xx), amber (4xx), red (5xx)
- Hover tooltip showing exact count + timestamp

**Bottom row — Secondary cards:**
- **Slowest Endpoints** — Top 5 URLs by avg response time (from history)
- **Query Stats** — Total queries, avg duration, queries per request
- **Recent Errors** — Last 5 error log entries with links to Logs section

**Data source:** Aggregated from `server_stats_metrics` table + recent `server_stats_requests`.

### 2. Requests

Enhanced version of the Timeline trace list:
- Table: Method, URL, Status, Duration, Spans, Warnings, Time
- Click row to see full trace waterfall (inline expand or separate view)
- Filters: method, status range, duration range, URL search
- Pagination through history (SQLite-backed)
- Deep-link target from debug panel

### 3. Queries

Enhanced beyond the panel:
- **List view:** Same as panel but with history (paginated from SQLite)
- **Grouped view:** Toggle to group by normalized SQL pattern
  - Shows: pattern, count, avg/min/max/total duration, % of total time
  - Sort by count, avg duration, or total time
- **EXPLAIN:** Click any query to run `EXPLAIN` (without ANALYZE) on the app's database connection
  - Shows query plan table inline
  - Only available for SELECT queries
- **Duplicate detection:** Highlight queries that ran 3+ times with the same normalized SQL in a single request
- Filters: duration threshold, model, method, connection, time range
- Deep-link target from debug panel

### 4. Events

Enhanced beyond the panel:
- Full history from SQLite (paginated)
- Click event name to filter by that event
- Click data preview to expand JSON with syntax highlighting
- Filters: event name, time range
- Deep-link target from debug panel

### 5. Routes

Same as panel but full-page width:
- Current route highlighted
- Click route to filter requests by that URL pattern
- Group by controller (collapsible)

### 6. Logs

Significantly enhanced:
- **Structured search:** Parse JSON log entries, filter by any field
  - Dropdown to select field (level, message, request_id, userId, etc.)
  - Operator selector (equals, contains, starts with)
  - Value input
  - Combine multiple filters with AND
- **Saved filter presets:** Save named filter combinations
  - Stored in `server_stats_saved_filters`
  - Quick-select dropdown to apply saved filters
  - Create/delete presets
- **Full history** from SQLite (paginated)
- Level filter buttons (All, Error, Warn, Info, Debug)
- Request ID filter (click to filter, same as panel)
- Time range filter
- Live streaming of new log entries via Transmit
- Deep-link target from debug panel

### 7. Emails

Enhanced beyond the panel:
- Full history from SQLite (paginated)
- Click row to preview email HTML in iframe (same as panel)
- Filters: from, to, subject, mailer, status, time range
- Deep-link target from debug panel

### 8. Timeline

Enhanced trace view:
- Request list (same as panel Requests section)
- Click to see waterfall (same as panel but with more space)
- Full history from SQLite
- Deep-link target from debug panel

### 9. Cache (New)

Cache inspector using `@adonisjs/cache` or Redis:
- **Key browser:** List cache keys with TTL, size, type
- **Hit/miss stats:** Hit rate, total hits, total misses (from Redis INFO)
- **Key detail:** Click key to see value, TTL, type
- Only shown if `@adonisjs/cache` or `@adonisjs/redis` is detected

### 10. Jobs/Queue (New)

Bull Queue monitor (optional — only if `@rlanz/bull-queue` detected):
- **Queue overview:** Active, waiting, delayed, completed, failed counts
- **Job list:** Table with job name, status, payload preview, attempts, duration, time
- **Failed jobs:** View error message, retry button
- **Job detail:** Click to see full payload, stack trace (if failed), processing time
- Uses Bull's Job class APIs (`getJobs()`, `getCompleted()`, `getFailed()`, etc.)

### 11. Config (New)

Read-only config viewer:
- Shows app configuration from `app.config.all()`
- Auto-redacts values matching sensitive patterns: `password`, `secret`, `key`, `token`, `api_key`, `apiKey`, `credential`, `auth`
- Redacted values shown as `••••••••`
- Expandable nested objects
- Copy sanitized config to clipboard
- Environment variables view (from `process.env`) with same redaction

### 12. Custom Panes

User-registered custom panes (from `devToolbar.panes` config) also appear as sidebar sections:
- Same rendering logic as the debug panel custom panes
- Full-page width for better table layout
- Inherit search, clear, column formatting capabilities

---

## Real-Time Streaming

### Transmit Integration

When `@adonisjs/transmit` is available:

1. Dashboard page subscribes to a dedicated channel: `server-stats/dashboard`
2. Server broadcasts events when new data arrives:
   - `request:completed` — new request finished (summary)
   - `query:captured` — new SQL query captured
   - `event:emitted` — new event emitted
   - `log:entry` — new log entry
   - `email:captured` — new email captured
   - `trace:completed` — new trace finished
3. Client-side JS receives events and appends to current view (no full refresh)
4. Overview sparklines update in real-time

### Polling Fallback

When Transmit is not available:
- Each active section polls its API endpoint every 3 seconds (same as debug panel)
- Overview polls aggregated endpoint every 5 seconds

---

## Deep Links from Debug Panel

The debug panel gets a new button in the top-right area: a link icon that opens the dashboard in a new tab.

Each data row in the panel (queries, events, emails, traces) gets a subtle link icon on hover that opens the dashboard at the corresponding section with the item highlighted.

**URL format:** `{dashboardPath}#{section}?id={itemId}`

Examples:
- `/__stats#queries?id=42` — Opens Queries section, scrolls to query #42
- `/__stats#traces?id=15` — Opens Timeline section, expands trace #15
- `/__stats#logs?requestId=abc123` — Opens Logs section, filtered by request ID

The dashboard page reads the hash on load and navigates to the correct section + highlights/filters.

---

## API Endpoints

All dashboard API routes registered under the configured `dashboardPath`:

| Method | Path | Description |
|--------|------|-------------|
| GET | `{path}` | Serve the dashboard HTML page |
| GET | `{path}/api/overview` | Overview metrics (cards + chart data) |
| GET | `{path}/api/overview/chart` | Chart data with `?range=1h\|6h\|24h\|7d` |
| GET | `{path}/api/requests` | Paginated request history |
| GET | `{path}/api/requests/:id` | Single request with trace detail |
| GET | `{path}/api/queries` | Paginated query history |
| GET | `{path}/api/queries/grouped` | Grouped query patterns |
| GET | `{path}/api/queries/:id/explain` | Run EXPLAIN on a query |
| GET | `{path}/api/events` | Paginated event history |
| GET | `{path}/api/routes` | Route table |
| GET | `{path}/api/logs` | Paginated log history with structured search |
| GET | `{path}/api/emails` | Paginated email history |
| GET | `{path}/api/emails/:id/preview` | Email HTML preview |
| GET | `{path}/api/traces` | Paginated trace history |
| GET | `{path}/api/traces/:id` | Single trace with spans |
| GET | `{path}/api/cache` | Cache stats + key list |
| GET | `{path}/api/cache/:key` | Single cache key value |
| GET | `{path}/api/jobs` | Job list with status filter |
| GET | `{path}/api/jobs/:id` | Single job detail |
| POST | `{path}/api/jobs/:id/retry` | Retry a failed job |
| GET | `{path}/api/config` | Sanitized app config |
| GET | `{path}/api/filters` | Saved filter presets |
| POST | `{path}/api/filters` | Create filter preset |
| DELETE | `{path}/api/filters/:id` | Delete filter preset |

All endpoints gated by the `shouldShow` callback (same as debug panel). The dashboard page itself is also gated.

---

## File Structure (New/Modified)

### New Files

```
src/dashboard/
  dashboard_controller.ts       # Serves the page + all API endpoints
  dashboard_store.ts            # SQLite persistence layer (Lucid models + raw queries)
  dashboard_routes.ts           # Route registration helper
  models/
    stats_request.ts            # Lucid model for server_stats_requests
    stats_query.ts              # Lucid model for server_stats_queries
    stats_event.ts              # Lucid model for server_stats_events
    stats_email.ts              # Lucid model for server_stats_emails
    stats_log.ts                # Lucid model for server_stats_logs
    stats_trace.ts              # Lucid model for server_stats_traces
    stats_metric.ts             # Lucid model for server_stats_metrics
    stats_saved_filter.ts       # Lucid model for server_stats_saved_filters
  migrator.ts                   # Auto-migration logic (raw SQL, checks table existence)
  integrations/
    cache_inspector.ts          # Cache key browsing, hit/miss stats
    queue_inspector.ts          # Bull Queue job listing, retry
    config_inspector.ts         # Sanitized config reader
  chart_aggregator.ts           # Time-series aggregation for overview charts
src/edge/
  views/dashboard.edge          # Full-page dashboard HTML template
  client/dashboard.js           # Dashboard client-side SPA logic
  client/dashboard.css          # Dashboard styles (light + dark themes)
```

### Modified Files

```
src/types.ts                    # Add dashboard config fields to DevToolbarOptions
src/debug/types.ts              # Add DashboardConfig interface
src/provider/server_stats_provider.ts  # Wire dashboard setup, register routes, auto-migrate
src/edge/plugin.ts              # Register dashboard page rendering
src/edge/client/debug-panel.js  # Add deep-link buttons to panel rows
src/edge/client/debug-panel.css # Add deep-link button styles
src/debug/debug_store.ts        # Pipe collected data to DashboardStore for persistence
src/middleware/request_tracking_middleware.ts  # Self-exclusion for dashboard routes
src/index.ts                    # Export new types
package.json                    # Add better-sqlite3 or sqlite3 as optional peer dep
```

---

## Implementation Notes

### Lucid Connection Registration

In the provider's `boot()` or `ready()`, register a SQLite connection:

```typescript
const db = await this.app.container.make('lucid.db')
db.manager.add('server_stats', {
  client: 'better-sqlite3',
  connection: { filename: this.app.makePath(dbPath) },
  useNullAsDefault: true,
})
```

**Important:** This connection's queries must be excluded from the QueryCollector. The QueryCollector already listens on `db:query` — add a check: `if (data.connection === 'server_stats') return`.

### Piping Data to SQLite

After each request completes (in the existing `finishTrace` or a new hook):
1. Write request summary to `server_stats_requests`
2. Write associated queries to `server_stats_queries`
3. Write trace to `server_stats_traces`
4. Use batched inserts (group by request) for efficiency

For events, emails, logs — insert as they arrive (from existing collectors' event handlers).

### Metrics Aggregation

A periodic task (every 60 seconds) aggregates recent requests into `server_stats_metrics`:
- Count requests in the last minute
- Calculate avg/p95 response time
- Count errors
- Count queries + avg query duration
- Store with a bucket timestamp rounded to the minute

### Retention Cleanup

On startup and every hour:
```sql
DELETE FROM server_stats_requests WHERE created_at < datetime('now', '-{retentionDays} days');
-- Cascading deletes handle queries, events, traces via foreign keys
DELETE FROM server_stats_logs WHERE created_at < datetime('now', '-{retentionDays} days');
DELETE FROM server_stats_emails WHERE created_at < datetime('now', '-{retentionDays} days');
DELETE FROM server_stats_metrics WHERE created_at < datetime('now', '-{retentionDays} days');
```

### EXPLAIN Integration

When user clicks EXPLAIN on a query:
1. Server receives the query ID
2. Look up the original SQL from `server_stats_queries`
3. Only allow EXPLAIN on SELECT queries (reject INSERT/UPDATE/DELETE)
4. Execute `EXPLAIN {sql}` on the **app's default database connection** (not the stats connection)
5. Return the query plan as a table
6. Cache the result (same query plan won't change unless schema changes)

### Dashboard Page Serving

The dashboard HTML is a single Edge template that includes:
- Inline CSS (dashboard.css, compiled at boot like the debug panel)
- Inline JS (dashboard.js, compiled at boot)
- SVG icons for sidebar (inline, no external deps)
- No external dependencies — fully self-contained

The page is served via a GET route handler that:
1. Checks `shouldShow(ctx)` — returns 403 if unauthorized
2. Renders the Edge template with config data (endpoints, tracing enabled, etc.)

---

## Transmit Channel Events

Channel name: `server-stats/dashboard`

### Event payloads

```typescript
// request:completed
{ type: 'request', data: { id, method, url, statusCode, duration, spanCount, timestamp } }

// query:captured
{ type: 'query', data: { id, sql, duration, method, model, timestamp } }

// event:emitted
{ type: 'event', data: { id, event, timestamp } }

// log:entry
{ type: 'log', data: { id, level, message, requestId, timestamp } }

// email:captured
{ type: 'email', data: { id, from, to, subject, status, timestamp } }

// trace:completed
{ type: 'trace', data: { id, method, url, statusCode, totalDuration, spanCount, timestamp } }
```

---

## Package.json Changes

```json
{
  "peerDependenciesMeta": {
    "better-sqlite3": {
      "optional": true
    },
    "@rlanz/bull-queue": {
      "optional": true
    }
  },
  "devDependencies": {
    "better-sqlite3": "^11.0.0",
    "@types/better-sqlite3": "^7.0.0"
  }
}
```

Note: `better-sqlite3` is only required when `dashboard: true`. The dashboard features gracefully degrade without it (in-memory only, no history).

---

## Exports

```typescript
// src/index.ts — new exports
export type { DashboardConfig } from './debug/types.js'
```

```json
// package.json exports — new entry
{
  "./dashboard": {
    "types": "./dist/src/dashboard/dashboard_controller.d.ts",
    "import": "./dist/src/dashboard/dashboard_controller.js"
  }
}
```

---

## Verification Checklist

1. `npm run build` passes (typecheck + copy assets)
2. Dashboard page loads at `/__stats` with dark/light theme
3. Sidebar navigation switches sections without page reload
4. Overview shows sparkline charts with selectable time ranges
5. Queries section shows grouped view with EXPLAIN integration
6. Logs section supports structured JSON field filtering + saved presets
7. Real-time updates via Transmit (queries/logs/events stream in)
8. Historical data persists across server restarts (SQLite)
9. Auto-prune works (records older than 7 days removed)
10. Deep links from debug panel open correct section in new tab
11. Dashboard's own requests/queries excluded from collectors
12. Cache inspector shows Redis keys/stats (if available)
13. Jobs section shows Bull Queue jobs (if available)
14. Config viewer shows sanitized config (secrets redacted)
15. Custom panes from config appear in sidebar
16. `shouldShow` callback gates both panel and dashboard
17. Polling fallback works when Transmit is not available
