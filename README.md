# adonisjs-server-stats

Real-time server monitoring for AdonisJS v6 applications. Collects process, system, HTTP, database, Redis, queue, and log metrics via a pluggable collector architecture, then broadcasts them over SSE (Transmit) for live dashboard display.

Ships with a self-contained Edge tag (`@serverStats()`) that renders a stats bar with sparklines, color-coded thresholds, and hover tooltips -- no React or build step required. A React component is also available as an alternative.

## Quick Start

```bash
node ace configure adonisjs-server-stats
```

This publishes `config/server_stats.ts` and registers the providers in `adonisrc.ts`.

### Manual Setup

1. Add the dependency:

```json
{
  "dependencies": {
    "adonisjs-server-stats": "^1.0.0"
  }
}
```

2. Register providers in `adonisrc.ts`:

```ts
providers: [
  // ...
  {
    file: () => import("adonisjs-server-stats/provider"),
    environment: ["web"],
  },
  {
    file: () => import("adonisjs-server-stats/log-stream/provider"),
    environment: ["web"],
  },
];
```

3. Register the middleware in `start/kernel.ts`:

```ts
server.use([
  () => import("adonisjs-server-stats/middleware"),
  // ... other middleware
]);
```

4. Create `config/server_stats.ts`:

```ts
import { defineConfig } from "adonisjs-server-stats";
import {
  processCollector,
  systemCollector,
  httpCollector,
  dbPoolCollector,
  redisCollector,
  queueCollector,
  logCollector,
  appCollector,
} from "adonisjs-server-stats/collectors";
import env from "#start/env";

export default defineConfig({
  intervalMs: 3000,
  transport: "transmit",
  channelName: "admin/server-stats",
  endpoint: "/admin/api/server-stats",
  shouldShow: (ctx) => !!ctx.auth?.user?.isAdmin,
  collectors: [
    processCollector(),
    systemCollector(),
    httpCollector({ maxRecords: 10_000 }),
    dbPoolCollector({ connectionName: "postgres" }),
    redisCollector(),
    queueCollector({
      queueName: "default",
      connection: {
        host: env.get("QUEUE_REDIS_HOST"),
        port: env.get("QUEUE_REDIS_PORT"),
        password: env.get("QUEUE_REDIS_PASSWORD"),
      },
    }),
    logCollector({ logPath: "logs/adonisjs.log" }),
    appCollector(),
  ],
});
```

5. Add a route for the stats API endpoint:

```ts
// start/routes.ts
router
  .get(
    "/admin/api/server-stats",
    "#controllers/admin/server_stats_controller.index",
  )
  .use(middleware.superadmin());
```

6. Create the controller:

```ts
// app/controllers/admin/server_stats_controller.ts
import app from "@adonisjs/core/services/app";
import type { HttpContext } from "@adonisjs/core/http";
import type { StatsEngine } from "adonisjs-server-stats";

export default class ServerStatsController {
  async index({ response }: HttpContext) {
    const engine = (await app.container.make(
      "server_stats.engine",
    )) as StatsEngine;
    return response.json(engine.getLatestStats());
  }
}
```

7. Add the Edge tag to your layout (before `</body>`):

```edge
@serverStats()
```

The tag renders a fixed bottom bar with all metrics. It polls the stats endpoint and auto-hides if the user is not authorized (403 response).

## Config Reference

| Option        | Type                   | Default                     | Description                                          |
| ------------- | ---------------------- | --------------------------- | ---------------------------------------------------- |
| `intervalMs`  | `number`               | `3000`                      | How often to collect and broadcast stats (ms)        |
| `transport`   | `'transmit' \| 'none'` | `'transmit'`                | Broadcast transport. `'none'` disables SSE.          |
| `channelName` | `string`               | `'admin/server-stats'`      | Transmit channel name                                |
| `endpoint`    | `string \| false`      | `'/admin/api/server-stats'` | HTTP endpoint path. `false` disables it.             |
| `collectors`  | `MetricCollector[]`    | `[]`                        | Array of collector instances                         |
| `skipInTest`  | `boolean`              | `true`                      | Skip collection during test runs                     |
| `onStats`     | `(stats) => void`      | -                           | Optional callback fired each tick                    |
| `shouldShow`  | `(ctx) => boolean`     | -                           | Per-request visibility guard (see below)             |
| `devToolbar`  | `object`               | -                           | Dev toolbar config (see [Dev Toolbar](#dev-toolbar)) |

### `devToolbar` Options

| Option                 | Type      | Default | Description               |
| ---------------------- | --------- | ------- | ------------------------- |
| `enabled`              | `boolean` | `false` | Enable the dev toolbar    |
| `maxQueries`           | `number`  | `500`   | Max queries to buffer     |
| `maxEvents`            | `number`  | `200`   | Max events to buffer      |
| `slowQueryThresholdMs` | `number`  | `100`   | Slow query threshold (ms) |

## Controlling Visibility with `shouldShow`

By default, `@serverStats()` renders for every request. Use the `shouldShow` config option to control who sees it.

The `shouldShow` callback receives the AdonisJS `HttpContext` and returns a boolean. When configured, the stats bar only renders if the callback returns `true` for the current request.

```ts
// config/server_stats.ts
export default defineConfig({
  // Only show for admin users
  shouldShow: (ctx) => !!ctx.auth?.user?.isAdmin,

  // Or: only in development
  shouldShow: () => process.env.NODE_ENV === "development",

  // Or: check a custom flag
  shouldShow: (ctx) =>
    ctx.auth?.user?.role === "admin" || ctx.auth?.user?.role === "superadmin",
});
```

**How it works:**

1. The `shouldShow` callback is registered in the provider at boot
2. The request tracking middleware evaluates it per-request and shares the result with Edge via `ctx.view.share()`
3. The `@serverStats()` tag checks this value at render time and conditionally outputs the stats bar HTML

The `@serverStats()` tag in your Edge layout stays unchanged -- no arguments needed:

```edge
<body>
  @inertia()
  @serverStats()
</body>
```

When `shouldShow` is not configured, the tag always renders (backward compatible).

## Edge Tag (Default UI)

The `@serverStats()` Edge tag is the recommended way to display the stats bar. It renders self-contained HTML + CSS + JS inline -- no React, no external assets, no build step.

```edge
<!-- resources/views/inertia_layout.edge -->
<body>
  @inertia()
  @serverStats()
</body>
```

Features:

- Polls the stats API endpoint at the configured interval
- Color-coded thresholds (green/amber/red) for all metrics
- SVG sparkline charts with gradient fills
- Hover tooltips with min/max/avg history stats
- Toggle button to show/hide (persisted via localStorage)
- Auto-hides for non-admin users (checks endpoint response status)
- Scoped CSS with `.ss-` prefix to avoid conflicts
- Stale connection detection (amber dot after 10s without update)

## Dev Toolbar

The dev toolbar adds a debug panel with query, event, route, and log inspection. Only active in non-production environments.

```ts
// config/server_stats.ts
export default defineConfig({
  devToolbar: {
    enabled: true,
    maxQueries: 500,
    maxEvents: 200,
    slowQueryThresholdMs: 100,
  },
});
```

The toolbar adds a wrench button to the stats bar that opens a panel with four tabs:

- **Queries** -- all SQL queries with duration, model, method, duplicate detection, and slow query highlighting
- **Events** -- all emitted events with JSON data (expandable, click-to-copy)
- **Routes** -- full route table with method, pattern, name, handler, and per-route middleware
- **Logs** -- live log entries with level filtering (error, warn, info, debug)

The dev toolbar requires debug API routes to be registered:

```ts
// start/routes.ts
router
  .group(() => {
    router.get("queries", "#controllers/admin/debug_controller.queries");
    router.get("events", "#controllers/admin/debug_controller.events");
    router.get("routes", "#controllers/admin/debug_controller.routes");
  })
  .prefix("/admin/api/debug")
  .use(middleware.admin());
```

### Custom Debug Panes

Add custom tabs to the debug panel via the `panes` config. Each pane fetches JSON from an endpoint you define and renders a generic table based on column definitions -- no package source changes needed.

```ts
// config/server_stats.ts
import { defineConfig } from "adonisjs-server-stats";

export default defineConfig({
  devToolbar: {
    enabled: true,
    panes: [
      {
        id: "webhooks",
        label: "Webhooks",
        endpoint: "/admin/api/debug/webhooks",
        columns: [
          { key: "id", label: "#", width: "40px" },
          { key: "event", label: "Event", searchable: true },
          { key: "url", label: "URL", searchable: true },
          {
            key: "status",
            label: "Status",
            width: "80px",
            format: "badge",
            badgeColorMap: { delivered: "green", pending: "amber", failed: "red" },
          },
          { key: "duration", label: "Duration", width: "70px", format: "duration" },
          { key: "timestamp", label: "Time", width: "80px", format: "timeAgo" },
        ],
        search: { placeholder: "Filter webhooks by event or URL..." },
        clearable: true,
      },
    ],
  },
});
```

Then create the route and controller that returns JSON. The response must contain an array under a key matching the pane `id` (or `dataKey` if specified):

```ts
// start/routes.ts
router
  .get("/admin/api/debug/webhooks", "#controllers/admin/debug_controller.webhooks")
  .use(middleware.admin());

// app/controllers/admin/debug_controller.ts
async webhooks({ response }: HttpContext) {
  const events = await WebhookEvent.query().orderBy('created_at', 'desc').limit(200)
  return response.json({ webhooks: events })
}
```

#### Pane Config

| Option      | Type             | Default   | Description                                       |
| ----------- | ---------------- | --------- | ------------------------------------------------- |
| `id`        | `string`         | required  | Unique pane identifier (kebab-case)               |
| `label`     | `string`         | required  | Tab display name                                  |
| `endpoint`  | `string`         | required  | API endpoint URL                                  |
| `columns`   | `DebugPaneColumn[]` | required | Column definitions (see below)                 |
| `search`    | `{ placeholder }` | -        | Enables search bar with custom placeholder        |
| `dataKey`   | `string`         | `id`      | JSON response key (supports dot notation)         |
| `fetchOnce` | `boolean`        | `false`   | Cache after first fetch (like the Routes tab)     |
| `clearable` | `boolean`        | `false`   | Show Clear button to reset data                   |

#### Column Config

| Option          | Type                    | Default  | Description                                     |
| --------------- | ----------------------- | -------- | ----------------------------------------------- |
| `key`           | `string`                | required | JSON field name                                 |
| `label`         | `string`                | required | Column header text                              |
| `width`         | `string`                | auto     | CSS width (e.g., `'60px'`)                      |
| `format`        | `DebugPaneFormatType`   | `'text'` | Cell format type (see below)                    |
| `searchable`    | `boolean`               | `false`  | Include this column in search filtering         |
| `filterable`    | `boolean`               | `false`  | Click cell value to set as search filter        |
| `badgeColorMap` | `Record<string, string>` | -       | Value-to-color mapping for `badge` format       |

#### Format Types

| Format     | Renders As                              | Notes                                              |
| ---------- | --------------------------------------- | -------------------------------------------------- |
| `text`     | Escaped plain text                      | Default                                            |
| `time`     | `HH:MM:SS.mmm`                         | Expects Unix timestamp (ms)                        |
| `timeAgo`  | `3s ago`, `2m ago`                      | Expects Unix timestamp (ms)                        |
| `duration` | `X.XXms` with green/amber/red coloring  | Expects number in milliseconds                     |
| `method`   | HTTP method pill badge                  | GET=green, POST=blue, PUT/PATCH=amber, DELETE=red  |
| `json`     | Compact preview of object/array         | Click to expand                                    |
| `badge`    | Colored pill using `badgeColorMap`       | Available colors: green, amber, red, blue, purple, muted |

#### TypeScript Types

All types are exported for consumer use:

```ts
import type { DebugPane, DebugPaneColumn, DebugPaneFormatType } from "adonisjs-server-stats";
```

## Collectors

Each collector is a factory function returning a `MetricCollector`:

```ts
interface MetricCollector {
  name: string
  start?(): void | Promise<void>
  stop?(): void | Promise<void>
  collect(): Record<string, string | number | boolean> | Promise<...>
}
```

### Built-in Collectors

| Collector                | Metrics                                                         | Peer Deps         |
| ------------------------ | --------------------------------------------------------------- | ----------------- |
| `processCollector()`     | CPU %, event loop lag, heap/RSS memory, uptime, Node version    | -                 |
| `systemCollector()`      | OS load averages, system memory, system uptime                  | -                 |
| `httpCollector(opts?)`   | Requests/sec, avg response time, error rate, active connections | -                 |
| `dbPoolCollector(opts?)` | Pool used/free/pending/max connections                          | `@adonisjs/lucid` |
| `redisCollector()`       | Status, memory, clients, keys, hit rate                         | `@adonisjs/redis` |
| `queueCollector(opts)`   | Active/waiting/delayed/failed jobs, worker count                | `bullmq`          |
| `logCollector(opts)`     | Errors/warnings/entries (5m window), entries/minute             | -                 |
| `appCollector()`         | Online users, pending webhooks, pending emails                  | `@adonisjs/lucid` |

### Collector Options

```ts
httpCollector({
  maxRecords: 10_000, // Circular buffer size (default: 10,000)
  windowMs: 60_000, // Rolling window for rate calculations (default: 60s)
});

dbPoolCollector({
  connectionName: "postgres", // Lucid connection name (default: 'postgres')
});

queueCollector({
  queueName: "default", // BullMQ queue name (default: 'default')
  connection: {
    // Redis connection for BullMQ
    host: "localhost",
    port: 6379,
    password: "secret",
  },
});

logCollector({
  logPath: "logs/adonisjs.log", // Path to the JSON log file
});
```

### Custom Collectors

```ts
import type { MetricCollector } from "adonisjs-server-stats";

function diskCollector(): MetricCollector {
  return {
    name: "disk",
    async collect() {
      const { availableSpace, totalSpace } = await getDiskInfo();
      return {
        diskAvailableGb: availableSpace / 1e9,
        diskTotalGb: totalSpace / 1e9,
        diskUsagePercent: ((totalSpace - availableSpace) / totalSpace) * 100,
      };
    },
  };
}

// config/server_stats.ts
export default defineConfig({
  collectors: [
    processCollector(),
    diskCollector(), // mix in with built-in collectors
  ],
});
```

## React Components (Alternative)

If you prefer React over the Edge tag, a full React component is available via `adonisjs-server-stats/react`.

### `<ServerStatsBar />`

Drop-in stats bar with all metrics, sparklines, and tooltips. Renders as a fixed bar at the bottom of the viewport.

```tsx
import { ServerStatsBar } from "adonisjs-server-stats/react";

function AdminLayout({ children }) {
  return (
    <div>
      {children}
      <ServerStatsBar />
    </div>
  );
}
```

Props (all optional):

| Prop           | Type     | Default                     | Description                                  |
| -------------- | -------- | --------------------------- | -------------------------------------------- |
| `endpoint`     | `string` | `'/admin/api/server-stats'` | HTTP endpoint for initial fetch              |
| `channel`      | `string` | `'admin/server-stats'`      | Transmit SSE channel                         |
| `maxHistory`   | `number` | `60`                        | Rolling history length for sparklines        |
| `staleTimeout` | `number` | `10000`                     | Milliseconds before marking connection stale |

### `useServerStats(opts?)`

Hook for building custom stats UIs. Handles HTTP fetch, SSE subscription, history tracking, and stale detection.

```tsx
import { useServerStats } from "adonisjs-server-stats/react";

function CustomDashboard() {
  const { stats, stale, history } = useServerStats({
    endpoint: "/admin/api/server-stats",
    channel: "admin/server-stats",
  });

  if (!stats) return <div>Loading...</div>;

  return (
    <div>
      <p>CPU: {stats.cpuPercent.toFixed(1)}%</p>
      <p>Memory: {stats.memRss} bytes</p>
      {stale && <p>Connection stale</p>}
    </div>
  );
}
```

### Individual Components

For custom layouts, each sub-component is exported individually:

```tsx
import {
  StatBadge,
  Sparkline,
  TooltipPopup,
  Separator,
} from "adonisjs-server-stats/react";
import { formatBytes, cpuColor } from "adonisjs-server-stats/react";
```

## Prometheus Integration

Exports Prometheus gauges for all collected metrics. Requires `@julr/adonisjs-prometheus`.

```ts
// config/prometheus.ts
import { defineConfig } from "@julr/adonisjs-prometheus";
import { httpCollector } from "@julr/adonisjs-prometheus/collectors/http_collector";
import { serverStatsCollector } from "adonisjs-server-stats/prometheus";

export default defineConfig({
  endpoint: "/metrics",
  collectors: [httpCollector(), serverStatsCollector()],
});
```

The provider automatically updates Prometheus gauges on each collection tick -- no additional wiring needed.

## Log Stream

The log stream module watches a JSON log file and broadcasts new entries via Transmit. It serves two purposes:

1. **Stats collector** -- provides error/warning counts to the stats bar via `logCollector()`
2. **Live log streaming** -- broadcasts individual log entries to a configurable Transmit channel (default: `admin/logs`) via the `LogStreamProvider`

The `LogStreamService` can also be used standalone:

```ts
import { LogStreamService } from "adonisjs-server-stats/log-stream";

const service = new LogStreamService("logs/app.log", (entry) => {
  console.log("New log entry:", entry);
});

await service.start();
// ...
service.stop();
```

## Architecture

```
adonisjs-server-stats
  src/
    edge/
      plugin.ts               # Edge plugin: mounts views, pre-renders, registers tag
      views/
        stats-bar.edge         # Stats bar Edge template
        debug-panel.edge       # Debug panel Edge template
      client/
        stats-bar.css          # Stats bar styles (.ss- prefix)
        stats-bar.js           # Client JS: polling, DOM updates, sparklines
        debug-panel.css        # Debug panel styles (.ss-dbg- prefix)
        debug-panel.js         # Client JS: tabs, queries, events, routes, logs
    engine/
      stats_engine.ts         # Orchestrator: runs collectors, merges results
      request_metrics.ts      # Circular buffer for HTTP request tracking
    collectors/
      collector.ts            # MetricCollector interface
      process_collector.ts    # CPU, memory, event loop, uptime
      system_collector.ts     # OS load, system memory
      http_collector.ts       # RPS, response time, error rate
      db_pool_collector.ts    # Lucid connection pool stats
      redis_collector.ts      # Redis info (lazy import)
      queue_collector.ts      # BullMQ job counts (lazy import)
      log_collector.ts        # Log file error/warning counts
      app_collector.ts        # App-specific DB queries
    debug/
      debug_store.ts          # DebugStore (queries, events, routes)
      query_collector.ts      # Intercepts db:query events
      event_collector.ts      # Intercepts all emitter events
      route_inspector.ts      # Caches route table at boot
      ring_buffer.ts          # Circular buffer utility
    provider/                 # AdonisJS provider lifecycle
    middleware/               # HTTP request tracking + shouldShow evaluation
    controller/               # Stats + debug API endpoints
    prometheus/               # Optional Prometheus gauge exporter
    log_stream/               # Log file watcher + Transmit broadcaster
    react/                    # React components, hook, utilities
    stubs/                    # Config file template for `node ace configure`
  configure.ts                # Setup automation
```

### How It Works

1. The **provider** reads `config/server_stats.ts` on app boot
2. During `boot()`, it wires up the `shouldShow` callback and registers the `@serverStats()` Edge tag
3. During `ready()`, it creates a `StatsEngine` with the configured collectors and starts a timer
4. Each tick, the engine calls every collector's `collect()` method in parallel
5. Results are merged into a flat object and broadcast via Transmit
6. Prometheus gauges are updated from the same data (no duplicate collection)
7. The **middleware** tracks HTTP requests and evaluates `shouldShow` per-request, sharing the result with Edge
8. The **Edge tag** checks visibility at render time and outputs inline HTML/CSS/JS that polls the stats endpoint
9. Alternatively, the React `useServerStats` hook subscribes to SSE for real-time updates

### Peer Dependencies

All integrations use lazy `import()` so missing peer deps won't crash the app -- the corresponding collector will return defaults.

| Dependency                  | Required By                       |
| --------------------------- | --------------------------------- |
| `@adonisjs/core`            | Everything (required)             |
| `@adonisjs/lucid`           | `dbPoolCollector`, `appCollector` |
| `@adonisjs/redis`           | `redisCollector`                  |
| `@adonisjs/transmit`        | Provider (SSE broadcast)          |
| `@adonisjs/transmit-client` | `useServerStats` hook             |
| `@julr/adonisjs-prometheus` | `serverStatsCollector`            |
| `bullmq`                    | `queueCollector`                  |
| `react`                     | React components (optional)       |
| `axios`                     | `useServerStats` initial fetch    |
| `edge.js`                   | Edge tag (auto-detected)          |
