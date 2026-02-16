# adonisjs-server-stats

[![npm version](https://img.shields.io/npm/v/adonisjs-server-stats.svg)](https://www.npmjs.com/package/adonisjs-server-stats)
[![npm downloads](https://img.shields.io/npm/dm/adonisjs-server-stats.svg)](https://www.npmjs.com/package/adonisjs-server-stats)
[![bundle size](https://img.shields.io/bundlephobia/minzip/adonisjs-server-stats)](https://bundlephobia.com/package/adonisjs-server-stats)
[![license](https://img.shields.io/npm/l/adonisjs-server-stats.svg)](https://github.com/simulieren/adonisjs-server-stats/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9+-blue.svg)](https://www.typescriptlang.org/)
[![AdonisJS](https://img.shields.io/badge/AdonisJS-v6-5A45FF.svg)](https://adonisjs.com/)

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
- **Debug toolbar** -- SQL queries, events, routes, logs with search and filtering
- **Custom panes** -- add your own tabs (webhooks, emails, cache, anything) with a simple config
- **Pluggable collectors** -- use built-in collectors or write your own
- **Visibility control** -- show only to admins, specific roles, or in dev mode
- **SSE broadcasting** -- real-time updates via AdonisJS Transmit
- **Prometheus export** -- expose all metrics as Prometheus gauges
- **Self-contained** -- inline HTML/CSS/JS Edge tag, no React, no external assets
- **Graceful degradation** -- missing optional dependencies are handled automatically

## Installation

```bash
node ace configure adonisjs-server-stats
```

This publishes `config/server_stats.ts` and registers the providers in `adonisrc.ts`.

Or install manually:

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
  intervalMs: 3000,
  transport: 'transmit',
  channelName: 'admin/server-stats',
  endpoint: '/admin/api/server-stats',
  collectors: [
    processCollector(),
    systemCollector(),
    httpCollector({ maxRecords: 10_000 }),
    dbPoolCollector({ connectionName: 'postgres' }),
    redisCollector(),
    queueCollector({
      queueName: 'default',
      connection: {
        host: env.get('QUEUE_REDIS_HOST'),
        port: env.get('QUEUE_REDIS_PORT'),
        password: env.get('QUEUE_REDIS_PASSWORD'),
      },
    }),
    logCollector({ logPath: 'logs/adonisjs.log' }),
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

| Option                 | Type            | Default | Description                        |
|------------------------|-----------------|---------|------------------------------------|
| `enabled`              | `boolean`       | `false` | Enable the dev toolbar             |
| `maxQueries`           | `number`        | `500`   | Max SQL queries to buffer          |
| `maxEvents`            | `number`        | `200`   | Max events to buffer               |
| `slowQueryThresholdMs` | `number`        | `100`   | Slow query threshold (ms)          |
| `panes`                | `DebugPane[]`   | --      | Custom debug panel tabs            |

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

Adds a debug panel with SQL query inspection, event tracking, route table, and live logs. Only active in non-production environments.

```ts
export default defineConfig({
  devToolbar: {
    enabled: true,
    maxQueries: 500,
    maxEvents: 200,
    slowQueryThresholdMs: 100,
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
  })
  .prefix('/admin/api/debug')
  .use(middleware.admin())
```

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
  RouteRecord,
} from 'adonisjs-server-stats'

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

| Dependency                  | Required By                       |
|-----------------------------|-----------------------------------|
| `@adonisjs/core`            | Everything (required)             |
| `@adonisjs/lucid`           | `dbPoolCollector`, `appCollector` |
| `@adonisjs/redis`           | `redisCollector`                  |
| `@adonisjs/transmit`        | Provider (SSE broadcast)          |
| `@julr/adonisjs-prometheus` | `serverStatsCollector`            |
| `bullmq`                    | `queueCollector`                  |
| `edge.js`                   | Edge tag                          |

## License

MIT
