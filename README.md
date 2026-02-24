# adonisjs-server-stats

[![npm version](https://img.shields.io/npm/v/adonisjs-server-stats.svg)](https://www.npmjs.com/package/adonisjs-server-stats)
[![npm downloads](https://img.shields.io/npm/dm/adonisjs-server-stats.svg)](https://www.npmjs.com/package/adonisjs-server-stats)
[![license](https://img.shields.io/npm/l/adonisjs-server-stats.svg)](https://github.com/simulieren/adonisjs-server-stats/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9+-blue.svg)](https://www.typescriptlang.org/)
[![AdonisJS](https://img.shields.io/badge/AdonisJS-v6-5A45FF.svg)](https://adonisjs.com/)
[![AdonisJS](https://img.shields.io/badge/AdonisJS-v7-5A45FF.svg)](https://adonisjs.com/)

A Laravel Telescope-inspired dev toolbar and real-time server monitor for **AdonisJS v6**.

Drop a single Edge tag into your layout and get a live stats bar showing CPU, memory, requests/sec, database pool, Redis, queues, and logs -- plus a full debug toolbar with SQL query inspection, event tracing, route listing, live log tailing, and custom panels.

Zero frontend dependencies. Zero build step. Just `@serverStats()` and go.

![adonisjs-server-stats demo](https://raw.githubusercontent.com/simulieren/adonisjs-server-stats/main/screenshots/demo.gif)

## Screenshots

**Debug toolbar** -- expandable panels for deep inspection:

| Queries | Events |
|---------|--------|
| ![Queries panel showing SQL queries with duration and model info](https://raw.githubusercontent.com/simulieren/adonisjs-server-stats/main/screenshots/debug-queries.png) | ![Events panel showing application events with payload data](https://raw.githubusercontent.com/simulieren/adonisjs-server-stats/main/screenshots/debug-events.png) |

| Routes | Logs |
|--------|------|
| ![Routes panel showing all registered routes with handlers](https://raw.githubusercontent.com/simulieren/adonisjs-server-stats/main/screenshots/debug-routes.png) | ![Logs panel with level filtering and request ID correlation](https://raw.githubusercontent.com/simulieren/adonisjs-server-stats/main/screenshots/debug-logs.png) |

| Emails (custom pane) |
|----------------------|
| ![Emails panel showing sent emails with delivery status](https://raw.githubusercontent.com/simulieren/adonisjs-server-stats/main/screenshots/debug-emails.png) |

## Features

- **Live stats bar** -- CPU, memory, event loop lag, HTTP throughput, DB pool, Redis, queues, logs
- **Debug toolbar** -- SQL queries, events, emails, routes, logs with search and filtering
- **Request tracing** -- per-request waterfall timeline showing DB queries, events, and custom spans
- **Custom panes** -- add your own tabs (webhooks, emails, cache, anything) with a simple config
- **Full-page dashboard** -- dedicated page at `/__stats` with overview cards, charts, request history, query analysis, EXPLAIN plans, cache/queue/config inspection, and saved filters
- **Pluggable collectors** -- use built-in collectors or write your own
- **Visibility control** -- show only to admins, specific roles, or in dev mode
- **SSE broadcasting** -- real-time updates via AdonisJS Transmit
- **Prometheus export** -- expose all metrics as Prometheus gauges
- **Self-contained** -- inline HTML/CSS/JS Edge tag, no React, no external assets
- **Graceful degradation** -- missing optional dependencies are handled automatically
- **Theme support** -- dark and light themes across dashboard, debug panel, and stats bar with system preference detection and manual toggle

## Installation

```bash
npm install adonisjs-server-stats
```

## Quick Start

### 1. Register providers

```ts
// adonisrc.ts
providers: [
  {
    file: () => import('adonisjs-server-stats/provider'),
    environment: ['web'],
  },
  {
    file: () => import('adonisjs-server-stats/log-stream/provider'),
    environment: ['web'],
  },
]
```

### 2. Register middleware

```ts
// start/kernel.ts
server.use([
  () => import('adonisjs-server-stats/middleware'),
])
```

### 3. Create config

```ts
// config/server_stats.ts
import { defineConfig } from 'adonisjs-server-stats'
import { processCollector, systemCollector, httpCollector } from 'adonisjs-server-stats/collectors'

export default defineConfig({
  collectors: [
    processCollector(),
    systemCollector(),
    httpCollector(),
  ],
})
```

That's it -- this gives you CPU, memory, event loop lag, and HTTP throughput out of the box. All other options have sensible defaults. Add more collectors as needed:

```ts
// config/server_stats.ts
import env from '#start/env'
import { defineConfig } from 'adonisjs-server-stats'
import {
  processCollector,
  systemCollector,
  httpCollector,
  dbPoolCollector,
  redisCollector,
  queueCollector,
  logCollector,
  appCollector,
} from 'adonisjs-server-stats/collectors'

export default defineConfig({
  // How often to collect and broadcast stats (in milliseconds)
  intervalMs: 3000,

  // Real-time transport: 'transmit' for SSE via @adonisjs/transmit, 'none' for polling only
  transport: 'transmit',

  // Transmit channel name clients subscribe to
  channelName: 'admin/server-stats',

  // HTTP endpoint that serves the latest stats snapshot (set to false to disable)
  endpoint: '/admin/api/server-stats',

  collectors: [
    // CPU usage, event loop lag, heap/RSS memory, uptime, Node.js version
    processCollector(),

    // OS load averages, total/free system memory, system uptime
    systemCollector(),

    // Requests/sec, avg response time, error rate, active connections
    // maxRecords: size of the circular buffer for request tracking
    httpCollector({ maxRecords: 10_000 }),

    // Lucid connection pool: used/free/pending/max connections
    // Requires @adonisjs/lucid
    dbPoolCollector({ connectionName: 'postgres' }),

    // Redis server stats: memory, connected clients, keys, hit rate
    // Requires @adonisjs/redis
    redisCollector(),

    // BullMQ queue stats: active/waiting/delayed/failed jobs
    // Requires bullmq -- connects directly to Redis (not via @adonisjs/redis)
    queueCollector({
      queueName: 'default',
      connection: {
        host: env.get('QUEUE_REDIS_HOST'),
        port: env.get('QUEUE_REDIS_PORT'),
        password: env.get('QUEUE_REDIS_PASSWORD'),
      },
    }),

    // Log file stats: errors/warnings in a 5-minute window, entries/minute
    logCollector({ logPath: 'logs/adonisjs.log' }),

    // App-level metrics: online users, pending webhooks, pending emails
    // Requires @adonisjs/lucid
    appCollector(),
  ],
})
```

### 4. Add a route

```ts
// start/routes.ts
router
  .get('/admin/api/server-stats', '#controllers/admin/server_stats_controller.index')
  .use(middleware.superadmin()) // Replace with your own middleware
```

### 5. Create the controller

```ts
// app/controllers/admin/server_stats_controller.ts
import app from '@adonisjs/core/services/app'
import type { HttpContext } from '@adonisjs/core/http'
import type { StatsEngine } from 'adonisjs-server-stats'

export default class ServerStatsController {
  async index({ response }: HttpContext) {
    const engine = await app.container.make('server_stats.engine') as StatsEngine
    return response.json(engine.getLatestStats())
  }
}
```

### 6. Render the stats bar

**Edge** (add before `</body>`):

```edge
@serverStats()
```

---

## Config Reference

### `ServerStatsConfig`

| Option        | Type                   | Default                     | Description                                |
|---------------|------------------------|-----------------------------|--------------------------------------------|
| `intervalMs`  | `number`               | `3000`                      | Collection + broadcast interval (ms)       |
| `transport`   | `'transmit' \| 'none'` | `'transmit'`                | SSE transport. `'none'` = poll-only.       |
| `channelName` | `string`               | `'admin/server-stats'`      | Transmit channel name                      |
| `endpoint`    | `string \| false`      | `'/admin/api/server-stats'` | HTTP endpoint. `false` to disable.         |
| `collectors`  | `MetricCollector[]`    | `[]`                        | Array of collector instances                |
| `skipInTest`  | `boolean`              | `true`                      | Skip collection during tests               |
| `onStats`     | `(stats) => void`      | --                          | Callback after each collection tick        |
| `shouldShow`  | `(ctx) => boolean`     | --                          | Per-request visibility guard               |
| `devToolbar`  | `DevToolbarOptions`    | --                          | Dev toolbar configuration                  |

### `DevToolbarOptions`

| Option                 | Type            | Default | Description                                    |
|------------------------|-----------------|---------|------------------------------------------------|
| `enabled`              | `boolean`       | `false` | Enable the dev toolbar                         |
| `maxQueries`           | `number`        | `500`   | Max SQL queries to buffer                      |
| `maxEvents`            | `number`        | `200`   | Max events to buffer                           |
| `maxEmails`            | `number`        | `100`   | Max emails to buffer                           |
| `slowQueryThresholdMs` | `number`        | `100`   | Slow query threshold (ms)                      |
| `persistDebugData`     | `boolean \| string` | `false` | Persist debug data to disk across restarts. `true` writes to `.adonisjs/server-stats/debug-data.json`, or pass a custom path. |
| `tracing`              | `boolean`       | `false` | Enable per-request tracing with timeline visualization |
| `maxTraces`            | `number`        | `200`   | Max request traces to buffer                   |
| `dashboard`            | `boolean`       | `false` | Enable the full-page dashboard (requires `better-sqlite3`) |
| `dashboardPath`        | `string`        | `'/__stats'` | URL path for the dashboard page           |
| `retentionDays`        | `number`        | `7`     | Days to keep historical data in SQLite         |
| `dbPath`               | `string`        | `'.adonisjs/server-stats/dashboard.sqlite3'` | Path to the SQLite database file (relative to app root) |
| `excludeFromTracing`   | `string[]`      | `[]`    | URL prefixes to exclude from tracing and dashboard persistence. Requests still count toward HTTP metrics but won't appear in the timeline or be stored. The stats endpoint is always excluded automatically. |
| `panes`                | `DebugPane[]`   | --      | Custom debug panel tabs                        |

---

## Collectors

Each collector is a factory function that returns a `MetricCollector`. All collectors run in parallel each tick; missing peer dependencies are handled gracefully (the collector returns defaults instead of crashing).

### Built-in Collectors

| Collector                | Metrics                                                     | Options    | Peer Deps           |
|--------------------------|-------------------------------------------------------------|------------|---------------------|
| `processCollector()`     | CPU %, event loop lag, heap/RSS memory, uptime, Node version | none       | --                  |
| `systemCollector()`      | OS load averages, system memory, system uptime               | none       | --                  |
| `httpCollector(opts?)`   | Requests/sec, avg response time, error rate, active connections | optional | --                  |
| `dbPoolCollector(opts?)` | Pool used/free/pending/max connections                       | optional   | `@adonisjs/lucid`   |
| `redisCollector()`       | Status, memory, clients, keys, hit rate                      | none       | `@adonisjs/redis`   |
| `queueCollector(opts)`   | Active/waiting/delayed/failed jobs, worker count             | **required** | `bullmq`          |
| `logCollector(opts)`     | Errors/warnings/entries (5m window), entries/minute           | **required** | --                |
| `appCollector()`         | Online users, pending webhooks, pending emails               | none       | `@adonisjs/lucid`   |

### Collector Options

```ts
httpCollector({
  maxRecords: 10_000,  // Circular buffer size (default: 10,000)
  windowMs: 60_000,    // Rolling window for rate calc (default: 60s)
})

dbPoolCollector({
  connectionName: 'postgres',  // Lucid connection name (default: 'postgres')
})

queueCollector({
  queueName: 'default',
  connection: {
    host: 'localhost',
    port: 6379,
    password: 'secret',
  },
})

logCollector({
  logPath: 'logs/adonisjs.log',
})
```

### Custom Collectors

Implement the `MetricCollector` interface to create your own:

```ts
import type { MetricCollector } from 'adonisjs-server-stats'

function diskCollector(): MetricCollector {
  return {
    name: 'disk',
    async collect() {
      const { availableSpace, totalSpace } = await getDiskInfo()
      return {
        diskAvailableGb: availableSpace / 1e9,
        diskTotalGb: totalSpace / 1e9,
        diskUsagePercent: ((totalSpace - availableSpace) / totalSpace) * 100,
      }
    },
  }
}

// config/server_stats.ts
export default defineConfig({
  collectors: [
    processCollector(),
    diskCollector(),  // mix with built-in collectors
  ],
})
```

The `MetricCollector` interface:

```ts
interface MetricCollector {
  name: string
  start?(): void | Promise<void>
  stop?(): void | Promise<void>
  collect(): Record<string, MetricValue> | Promise<Record<string, MetricValue>>
}
```

---

## Visibility Control (`shouldShow`)

By default the stats bar renders for every request. Use `shouldShow` to restrict it. The callback receives the AdonisJS `HttpContext` and should return `true` to show the bar, `false` to hide it.

Because `shouldShow` runs **after** middleware (including auth), you have full access to `ctx.auth`.

```ts
export default defineConfig({
  // Only show in development
  shouldShow: () => env.get('NODE_ENV'),
})
```

```ts
export default defineConfig({
  // Only show for logged-in admin users
  shouldShow: (ctx) => ctx.auth?.user?.isAdmin === true,
})
```

```ts
export default defineConfig({
  // Only show for specific roles
  shouldShow: (ctx) => {
    const role = ctx.auth?.user?.role
    return role === 'admin' || role === 'superadmin'
  },
})
```

> **Tip:** When `shouldShow` is not set, the bar renders for everyone. In production you almost always want to set this.

---

## Edge Tag

The `@serverStats()` Edge tag renders a self-contained stats bar with inline HTML, CSS, and JS -- no external assets, no build step.

```edge
<body>
  @inertia()
  @serverStats()
</body>
```

Features:
- Polls the stats API at the configured interval
- Color-coded thresholds (green/amber/red)
- SVG sparkline charts with gradient fills
- Hover tooltips with min/max/avg stats
- Show/hide toggle (persisted via localStorage)
- Auto-hides for non-admin users (403 detection)
- Scoped CSS (`.ss-` prefix)
- Stale connection indicator (amber dot after 10s)

---

## Dev Toolbar

Adds a debug panel with SQL query inspection, event tracking, email capture with HTML preview, route table, live logs, and per-request tracing. Only active in non-production environments.

```ts
export default defineConfig({
  devToolbar: {
    enabled: true,
    maxQueries: 500,
    maxEvents: 200,
    maxEmails: 100,
    slowQueryThresholdMs: 100,
    persistDebugData: true,  // or a custom path: 'custom/debug.json'
    tracing: true,           // enable per-request timeline
  },
})
```

Register the debug API routes:

```ts
// start/routes.ts
router
  .group(() => {
    router.get('queries', '#controllers/admin/debug_controller.queries')
    router.get('events', '#controllers/admin/debug_controller.events')
    router.get('routes', '#controllers/admin/debug_controller.routes')
    router.get('emails', '#controllers/admin/debug_controller.emails')
    router.get('emails/:id/preview', '#controllers/admin/debug_controller.emailPreview')
    router.get('traces', '#controllers/admin/debug_controller.traces')
    router.get('traces/:id', '#controllers/admin/debug_controller.traceDetail')
  })
  .prefix('/admin/api/debug')
  .use(middleware.admin())
```

### Built-in Emails Tab

The debug toolbar captures all emails sent via AdonisJS mail (`mail:sending`, `mail:sent`, `mail:queued`, `queued:mail:error` events). Click any email row to preview its HTML in an iframe.

### Persistent Debug Data

Enable `persistDebugData: true` to save queries, events, and emails to `.adonisjs/server-stats/debug-data.json`. You can also pass a custom path (relative to app root) like `persistDebugData: 'custom/debug.json'`. Data is:
- **Loaded** on server startup (before collectors start)
- **Flushed** every 30 seconds (handles crashes)
- **Saved** on graceful shutdown

### Request Tracing

When `tracing: true` is set, the debug panel gains a **Timeline** tab that shows a waterfall view of every HTTP request -- which DB queries ran, in what order, and how long each took.

Tracing uses `AsyncLocalStorage` to automatically correlate operations to the request that triggered them. DB queries captured via `db:query` events and `console.warn` calls are automatically attached to the active request trace.

#### How it works

```
GET /organizations/create    286ms
├─ SELECT * FROM users          2ms  █
├─ SELECT * FROM orgs           4ms    █
├─ fetchMembers (custom)      180ms    ██████████████████
└─ response sent                5ms                      ██
```

1. The **Timeline** tab shows a list of recent requests with method, URL, status code, duration, span count, and any warnings
2. Click a request to see the **waterfall chart** -- each span is a horizontal bar positioned by time offset, color-coded by category
3. Spans can be nested (a custom span wrapping DB queries will show them indented)

#### Span categories

| Category | Color  | Auto-captured |
|----------|--------|---------------|
| DB       | Purple | `db:query` events |
| Request  | Blue   | Full request lifecycle |
| Mail     | Green  | -- |
| Event    | Amber  | -- |
| View     | Cyan   | -- |
| Custom   | Gray   | Via `trace()` helper |

#### Custom spans

Use the `trace()` helper to wrap any async code in a named span:

```ts
import { trace } from 'adonisjs-server-stats'

// In a controller or service:
const result = await trace('organization.fetchMembers', async () => {
  return OrganizationService.getMembers(orgId)
})
```

If tracing is disabled or no request is active, `trace()` executes the function directly with no overhead.

### Full-Page Dashboard

The dashboard is a dedicated page that provides historical data, charts, query analysis, and integration inspectors -- all persisted to a local SQLite database. It's like having Laravel Telescope built into your dev toolbar.

#### Prerequisites

The dashboard requires `better-sqlite3` for local data storage:

```bash
npm install better-sqlite3
```

If `better-sqlite3` is not installed, the dashboard will log a helpful message and disable itself gracefully -- the rest of the stats bar and debug toolbar continues to work.

#### Enable the Dashboard

```ts
// config/server_stats.ts
export default defineConfig({
  devToolbar: {
    enabled: true,
    dashboard: true,
  },
})
```

Restart your dev server and visit **`/__stats`** (or your configured `dashboardPath`).

#### Configuration

```ts
devToolbar: {
  enabled: true,
  dashboard: true,

  // URL path for the dashboard (default: '/__stats')
  dashboardPath: '/__stats',

  // Days to retain historical data (default: 7)
  retentionDays: 7,

  // SQLite database file path, relative to app root (default: '.adonisjs/server-stats/dashboard.sqlite3')
  dbPath: '.adonisjs/server-stats/dashboard.sqlite3',

  // URL prefixes to exclude from tracing and dashboard persistence (default: [])
  excludeFromTracing: ['/admin/api/debug'],

  // Enable tracing for per-request timeline in the dashboard (recommended)
  tracing: true,
}
```

#### Dashboard Sections

| Section    | Description |
|------------|-------------|
| **Overview** | Performance cards (avg/p95 response time, req/min, error rate) with sparkline charts and configurable time ranges (1h/6h/24h/7d) |
| **Requests** | Paginated request history with method, URL, status, duration. Click for detail view with associated queries and trace |
| **Queries**  | All captured SQL queries with duration, model, connection. Grouped view shows query patterns by normalized SQL. EXPLAIN plan support for SELECT queries |
| **Events**   | Application events captured from the AdonisJS emitter |
| **Routes**   | Full route table with methods, patterns, handlers, and middleware stacks |
| **Logs**     | Log history with level filtering, text search, and structured JSON field search (e.g. filter by `userId = 5`) |
| **Emails**   | Email history with sender, recipient, subject, status. Click for HTML preview in iframe |
| **Timeline** | Per-request waterfall timeline (requires `tracing: true`) |
| **Cache**    | Redis key browser with SCAN-based listing, type-aware detail view, and server stats (requires `@adonisjs/redis`) |
| **Jobs**     | Queue overview with job listing, detail, and retry for failed jobs (requires `@rlanz/bull-queue`) |
| **Config**   | Sanitized view of app configuration and environment variables. Secrets are auto-redacted |

#### Access Control

The dashboard reuses the `shouldShow` callback from the main config. If set, all dashboard routes are gated by it -- unauthorized requests receive a 403.

```ts
export default defineConfig({
  shouldShow: (ctx) => ctx.auth?.user?.role === 'admin',
  devToolbar: {
    enabled: true,
    dashboard: true,
  },
})
```

#### Deep Links from Debug Panel

When the dashboard is enabled, the debug panel gains link icons on query, event, email, and trace rows. Clicking them opens the dashboard in a new tab, navigating directly to the relevant section and item.

#### Real-Time Updates

The dashboard supports real-time updates via two mechanisms:
- **Transmit (SSE)**: If `@adonisjs/transmit` is installed, the dashboard subscribes to `server-stats/dashboard` for live overview updates
- **Polling fallback**: If Transmit is not available, the dashboard polls the API at a configurable interval

#### Data Storage

The dashboard uses a dedicated SQLite database (separate from your app's database) with 8 tables prefixed with `server_stats_`. The database is:
- **Auto-migrated** on startup (no manual migration step)
- **Self-contained** -- uses its own Knex connection, never touches your app's migration history
- **Self-cleaning** -- old data is automatically purged based on `retentionDays`
- **WAL mode** -- concurrent reads don't block writes

The SQLite file is created at the configured `dbPath` (default: `.adonisjs/server-stats/dashboard.sqlite3`). Add it to your `.gitignore`:

```
.adonisjs/server-stats/
```

#### Theme Support

All three UIs (dashboard, debug panel, and stats bar) support dark and light themes:

- **System preference** -- automatically follows `prefers-color-scheme` (dark is default)
- **Manual toggle** -- sun/moon button in the dashboard sidebar and debug panel tab bar
- **Synced** -- theme choice is shared via `localStorage` across all three UIs, including cross-tab sync
- **Scoped** -- CSS variables are scoped to their containers, so they won't leak into your app's styles

---

### Custom Debug Panes

Add custom tabs to the debug panel:

```ts
import { defineConfig } from 'adonisjs-server-stats'
import type { DebugPane } from 'adonisjs-server-stats'

const webhooksPane: DebugPane = {
  id: 'webhooks',
  label: 'Webhooks',
  endpoint: '/admin/api/debug/webhooks',
  columns: [
    { key: 'id', label: '#', width: '40px' },
    { key: 'event', label: 'Event', searchable: true },
    { key: 'url', label: 'URL', searchable: true },
    {
      key: 'status',
      label: 'Status',
      width: '80px',
      format: 'badge',
      badgeColorMap: { delivered: 'green', pending: 'amber', failed: 'red' },
    },
    { key: 'duration', label: 'Duration', width: '70px', format: 'duration' },
    { key: 'timestamp', label: 'Time', width: '80px', format: 'timeAgo' },
  ],
  search: { placeholder: 'Filter webhooks by event or URL...' },
  clearable: true,
}

export default defineConfig({
  devToolbar: {
    enabled: true,
    panes: [webhooksPane],
  },
})
```

The endpoint must return JSON with the data array under a key matching the pane `id` (or `dataKey`):

```ts
// Controller
async webhooks({ response }: HttpContext) {
  const events = await WebhookEvent.query().orderBy('created_at', 'desc').limit(200)
  return response.json({ webhooks: events })
}
```

#### `DebugPane` Options

| Option      | Type                | Default | Description                                  |
|-------------|---------------------|---------|----------------------------------------------|
| `id`        | `string`            | --      | Unique identifier (also default data key)    |
| `label`     | `string`            | --      | Tab display name                             |
| `endpoint`  | `string`            | --      | API endpoint URL                             |
| `columns`   | `DebugPaneColumn[]` | --      | Column definitions                           |
| `search`    | `{ placeholder }`   | --      | Enable search bar                            |
| `dataKey`   | `string`            | `id`    | JSON key for data array (dot notation OK)    |
| `fetchOnce` | `boolean`           | `false` | Cache after first fetch                      |
| `clearable` | `boolean`           | `false` | Show Clear button                            |

#### `DebugPaneColumn` Options

| Option          | Type                     | Default  | Description                              |
|-----------------|--------------------------|----------|------------------------------------------|
| `key`           | `string`                 | --       | JSON field name                          |
| `label`         | `string`                 | --       | Column header text                       |
| `width`         | `string`                 | auto     | CSS width (e.g. `'60px'`)               |
| `format`        | `DebugPaneFormatType`    | `'text'` | Cell format (see table below)            |
| `searchable`    | `boolean`                | `false`  | Include in search filtering              |
| `filterable`    | `boolean`                | `false`  | Click to set as search filter            |
| `badgeColorMap` | `Record<string, string>` | --       | Value-to-color map for `badge` format    |

#### Format Types

| Format     | Renders As                             | Expected Input          |
|------------|----------------------------------------|-------------------------|
| `text`     | Escaped plain text                     | any                     |
| `time`     | `HH:MM:SS.mmm`                        | Unix timestamp (ms)     |
| `timeAgo`  | `3s ago`, `2m ago`                     | Unix timestamp (ms)     |
| `duration` | `X.XXms` with color coding             | number (ms)             |
| `method`   | HTTP method pill badge                 | `'GET'`, `'POST'`, etc. |
| `json`     | Compact preview, click to expand       | object or array         |
| `badge`    | Colored pill via `badgeColorMap`       | string                  |

Badge colors: `green`, `amber`, `red`, `blue`, `purple`, `muted`

---

## Prometheus Integration

Export all metrics as Prometheus gauges. Requires `@julr/adonisjs-prometheus`.

```ts
// config/prometheus.ts
import { defineConfig } from '@julr/adonisjs-prometheus'
import { httpCollector } from '@julr/adonisjs-prometheus/collectors/http_collector'
import { serverStatsCollector } from 'adonisjs-server-stats/prometheus'

export default defineConfig({
  endpoint: '/metrics',
  collectors: [httpCollector(), serverStatsCollector()],
})
```

Gauges are updated automatically on each collection tick.

---

## Log Stream

The log stream module watches a JSON log file and broadcasts new entries via Transmit (SSE).

**Two purposes:**
1. Provides error/warning counts to the stats bar via `logCollector()`
2. Broadcasts individual log entries to a Transmit channel via `LogStreamProvider`

Standalone usage:

```ts
import { LogStreamService } from 'adonisjs-server-stats/log-stream'

const service = new LogStreamService('logs/app.log', (entry) => {
  console.log('New log entry:', entry)
})

await service.start()
// later...
service.stop()
```

---

## TypeScript

All types are exported for consumer use:

```ts
// Core types
import type {
  ServerStats,
  ServerStatsConfig,
  MetricCollector,
  MetricValue,
  LogStats,
  DevToolbarOptions,
} from 'adonisjs-server-stats'

// Debug types
import type {
  DebugPane,
  DebugPaneColumn,
  DebugPaneFormatType,
  DebugPaneSearch,
  BadgeColor,
  QueryRecord,
  EventRecord,
  EmailRecord,
  RouteRecord,
  TraceSpan,
  TraceRecord,
} from 'adonisjs-server-stats'

// Dashboard types
import type {
  RequestFilters,
  QueryFilters,
  EventFilters,
  EmailFilters,
  LogFilters,
  TraceFilters,
  PaginatedResult,
} from 'adonisjs-server-stats'

// Dashboard store (for advanced use)
import { DashboardStore } from 'adonisjs-server-stats'

// Trace helper
import { trace } from 'adonisjs-server-stats'

// Collector option types
import type {
  HttpCollectorOptions,
  DbPoolCollectorOptions,
  QueueCollectorOptions,
  QueueRedisConnection,
  LogCollectorOptions,
} from 'adonisjs-server-stats/collectors'

```

---

## Peer Dependencies

All integrations use lazy `import()` -- missing peer deps won't crash the app. The corresponding collector simply returns defaults.

| Dependency                  | Required By                                    |
|-----------------------------|------------------------------------------------|
| `@adonisjs/core`            | Everything (required)                          |
| `@adonisjs/lucid`           | `dbPoolCollector`, `appCollector`, dashboard    |
| `@adonisjs/redis`           | `redisCollector`, dashboard cache inspector    |
| `@adonisjs/transmit`        | Provider (SSE broadcast), dashboard real-time  |
| `@julr/adonisjs-prometheus` | `serverStatsCollector`                         |
| `bullmq`                    | `queueCollector`                               |
| `better-sqlite3`            | Dashboard (`dashboard: true`)                  |
| `edge.js`                   | Edge tag                                       |

## License

MIT
