# Spec: "Internals" Diagnostics Page

## Overview

Add a new **"Internals"** section to the dashboard sidebar and a new **"Internals"** tab in the debug panel across all three frontends (Edge, React, Vue). This section provides deep runtime introspection into the `adonisjs-server-stats` package itself — active collectors, buffer utilization, timer health, transmit status, SQLite storage metrics, resolved configuration, and per-collector error tracking.

## Design Decisions

| Decision          | Choice                                           | Rationale                                                                                   |
| ----------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Placement         | New separate section alongside existing Config   | Config shows app-level config/env; Internals shows package runtime state                    |
| Runtime depth     | Deep — live runtime metrics                      | Show live timer states, buffer fill %, per-collector errors, SQLite stats, Pino hook status |
| Data flow         | Piggyback on existing 5s dashboard SSE broadcast | No extra polling endpoint; diagnostics data added to `server-stats/dashboard` channel       |
| Debug panel scope | Full mirror                                      | Same detailed diagnostics in both debug panel tab and dashboard section                     |
| Error tracking    | Current status + last error per collector        | Track healthy/errored status, last error message and timestamp                              |
| Buffer display    | Read-only                                        | Show current size / max size, no runtime modifications                                      |
| Sensitivity       | Redact with click-to-reveal                      | Same pattern as existing ConfigSection for passwords/secrets                                |
| Layout            | Grouped tables                                   | Vertical sections with dense, scannable tables                                              |
| SQLite health     | Dedicated section                                | Full table-level stats: row counts, file size, WAL, retention                               |
| Availability      | Always available                                 | Show in debug panel when `devToolbar.enabled=true`, show in dashboard when `dashboard=true` |
| Naming            | "Internals"                                      | Developer-oriented, signals package-internal state                                          |
| API design        | Keep `/config` separate, add `/diagnostics`      | `/config` stays lightweight for tab visibility; `/diagnostics` is the rich new endpoint     |

---

## Backend Changes

### 1. New Diagnostics Endpoint

**Route:** `GET {debugEndpoint}/diagnostics`

Registered in `src/routes/debug_routes.ts` alongside existing debug routes. Gated by `shouldShow` like all other endpoints.

**Response shape:**

```ts
interface DiagnosticsResponse {
  // Package metadata
  package: {
    version: string // from package.json
    nodeVersion: string // process.version
    adonisVersion: string // from @adonisjs/core package.json if available
  }

  // Resolved configuration (with redaction)
  config: {
    intervalMs: number
    transport: 'transmit' | 'none'
    channelName: string
    endpoint: string | false
    skipInTest: boolean
    hasOnStatsCallback: boolean // whether onStats is defined (don't serialize the function)
    hasShouldShowCallback: boolean // whether shouldShow is defined
  }

  // Resolved DevToolbar config
  devToolbar: {
    enabled: boolean
    maxQueries: number
    maxEvents: number
    maxEmails: number
    maxTraces: number
    slowQueryThresholdMs: number
    tracing: boolean
    dashboard: boolean
    dashboardPath: string
    debugEndpoint: string
    retentionDays: number
    dbPath: string
    persistDebugData: boolean | string
    excludeFromTracing: string[]
    customPaneCount: number // number of custom panes registered
  }

  // Collector status
  collectors: Array<{
    name: string // e.g. 'process', 'http', 'redis'
    label: string // display label
    status: 'healthy' | 'errored' | 'stopped'
    lastError: string | null // last error message
    lastErrorAt: number | null // timestamp of last error
    config: Record<string, unknown> // collector-specific options (redacted where needed)
  }>

  // Debug store buffer utilization
  buffers: {
    queries: { current: number; max: number }
    events: { current: number; max: number }
    emails: { current: number; max: number }
    traces: { current: number; max: number }
  }

  // Timer/interval health
  timers: {
    collectionInterval: { active: boolean; intervalMs: number }
    dashboardBroadcast: { active: boolean; intervalMs: number } // 5000ms
    debugBroadcast: { active: boolean; debounceMs: number } // 200ms
    persistFlush: { active: boolean; intervalMs: number } // 30000ms
    retentionCleanup: { active: boolean; intervalMs: number }
  }

  // Transmit/SSE status
  transmit: {
    available: boolean // whether @adonisjs/transmit is installed
    channels: string[] // active channel names
  }

  // Integration status
  integrations: {
    prometheus: { active: boolean }
    pinoHook: { active: boolean; mode: 'stream' | 'file' | 'none' }
    edgePlugin: { active: boolean }
    cacheInspector: { available: boolean } // redis dependency present
    queueInspector: { available: boolean } // queue dependency present
  }

  // SQLite storage (only when dashboard=true)
  storage: {
    ready: boolean
    dbPath: string
    fileSizeMb: number
    walSizeMb: number
    retentionDays: number
    tables: Array<{
      name: string // e.g. 'server_stats_requests'
      rowCount: number
    }>
    lastCleanupAt: number | null
  } | null
}
```

### 2. StatsEngine Changes

**File:** `src/engine/stats_engine.ts`

Add per-collector error tracking:

```ts
interface CollectorHealth {
  name: string
  label: string
  status: 'healthy' | 'errored' | 'stopped'
  lastError: string | null
  lastErrorAt: number | null
}
```

- Add a `private collectorHealth: Map<string, CollectorHealth>` field
- On successful collect: set status to `'healthy'`
- On error: set status to `'errored'`, store error message and `Date.now()` timestamp
- On stop: set status to `'stopped'`
- Add public `getCollectorHealth(): CollectorHealth[]` method
- Add public `getCollectorConfigs(): Array<{ name: string; config: Record<string, unknown> }>` — each collector factory should store its options for later retrieval

### 3. Collector Config Exposure

Each collector factory needs to expose its config. Add an optional `getConfig?(): Record<string, unknown>` method to the `MetricCollector` interface (or store config at factory time).

- `httpCollector` → `{ maxRecords, windowMs }`
- `dbPoolCollector` → `{ connectionName }`
- `queueCollector` → `{ queueName, connection: { host, port, password: '••••••••' } }` (redact password)
- `logCollector` → `{ logPath, mode: 'stream' | 'file' }` (zero-config vs file)
- Others → `{}` (no config)

### 4. DebugStore Changes

**File:** `src/debug/debug_store.ts`

Add public method to expose buffer utilization:

```ts
getBufferStats(): {
  queries: { current: number; max: number }
  events: { current: number; max: number }
  emails: { current: number; max: number }
  traces: { current: number; max: number }
}
```

### 5. DashboardStore Changes

**File:** `src/dashboard/dashboard_store.ts`

Add public methods:

```ts
getStorageStats(): Promise<{
  ready: boolean
  dbPath: string
  fileSizeMb: number
  walSizeMb: number
  retentionDays: number
  tables: Array<{ name: string; rowCount: number }>
  lastCleanupAt: number | null
}>
```

Uses `fs.stat()` for file sizes and `SELECT COUNT(*) FROM ...` for row counts.

### 6. Provider Changes

**File:** `src/provider/server_stats_provider.ts`

- Expose timer states via a `getDiagnostics()` method (or pass timer refs to a new `DiagnosticsService`)
- Track Pino hook status: `private pinoHookActive: boolean = false`
- Track edge plugin status: `private edgePluginActive: boolean = false`
- Track Prometheus status: `private prometheusActive: boolean = false`
- Make these accessible to the debug controller

### 7. DebugController Changes

**File:** `src/debug/debug_controller.ts`

Add `diagnostics()` handler that assembles the full `DiagnosticsResponse` by querying:

- `StatsEngine.getCollectorHealth()` and `getCollectorConfigs()`
- `DebugStore.getBufferStats()`
- `DashboardStore.getStorageStats()` (if available)
- Provider timer/integration states
- Package version from `package.json`

### 8. SSE Broadcast Integration

Add diagnostics summary to the existing `server-stats/dashboard` broadcast (5s interval):

```ts
// In the dashboard broadcast timer callback, add:
diagnostics: {
  collectors: engine.getCollectorHealth(),
  buffers: debugStore.getBufferStats(),
  storage: dashboardStore ? { fileSizeMb, totalRows } : null
}
```

This is a lightweight summary — the full diagnostics endpoint provides complete data on initial load.

---

## Frontend Changes

### All Frontends: Section Name and Icon

- Sidebar label: **"Internals"**
- Tab label in debug panel: **"Internals"**
- Position: After "Config" in sidebar, last tab in debug panel (before custom panes)

### Layout Structure (all frontends)

The Internals section uses **grouped tables** with the following sections:

#### 1. Package Info (top summary row)

| Field           | Value    |
| --------------- | -------- |
| Package Version | 1.2.3    |
| Node.js         | v20.11.0 |
| AdonisJS        | 6.x.x    |
| Uptime          | 2h 34m   |

#### 2. Collectors Table

| Collector | Label   | Status    | Last Error         | Config                             |
| --------- | ------- | --------- | ------------------ | ---------------------------------- |
| process   | Process | `healthy` | —                  | —                                  |
| http      | HTTP    | `healthy` | —                  | maxRecords: 10000, windowMs: 60000 |
| redis     | Redis   | `errored` | Connection refused | —                                  |
| queue     | Queue   | `healthy` | —                  | queueName: default                 |

- Status column: green dot for healthy, red dot for errored, gray dot for stopped
- Last Error: shows message + relative timestamp ("2m ago")
- Config: inline key=value pairs, redacted values show `••••••••` with click-to-reveal

#### 3. Buffers Table

| Buffer  | Usage     | Fill %            |
| ------- | --------- | ----------------- |
| Queries | 342 / 500 | `████████░░` 68%  |
| Events  | 15 / 200  | `█░░░░░░░░░` 8%   |
| Emails  | 3 / 100   | `░░░░░░░░░░` 3%   |
| Traces  | 200 / 200 | `██████████` 100% |

- Fill % column: visual progress bar (CSS-only, no chart library)
- When at 100%: bar turns amber/warning color

#### 4. Timers Table

| Timer               | Status     | Interval         |
| ------------------- | ---------- | ---------------- |
| Stats Collection    | `active`   | 3000ms           |
| Dashboard Broadcast | `active`   | 5000ms           |
| Debug Broadcast     | `active`   | 200ms (debounce) |
| Persist Flush       | `active`   | 30000ms          |
| Retention Cleanup   | `inactive` | —                |

- Status: green "active" or gray "inactive"

#### 5. Integrations Table

| Integration     | Status        | Details                                                                  |
| --------------- | ------------- | ------------------------------------------------------------------------ |
| Transmit (SSE)  | `connected`   | Channels: admin/server-stats, server-stats/debug, server-stats/dashboard |
| Prometheus      | `active`      | —                                                                        |
| Pino Log Hook   | `active`      | Mode: stream interception                                                |
| Edge Plugin     | `active`      | @serverStats() tag registered                                            |
| Cache Inspector | `available`   | Redis dependency detected                                                |
| Queue Inspector | `unavailable` | @rlanz/bull-queue not installed                                          |

#### 6. Storage Table (SQLite)

| Metric       | Value                                    |
| ------------ | ---------------------------------------- |
| Status       | `ready`                                  |
| DB Path      | .adonisjs/server-stats/dashboard.sqlite3 |
| File Size    | 12.4 MB                                  |
| WAL Size     | 0.8 MB                                   |
| Retention    | 7 days                                   |
| Last Cleanup | 2h ago                                   |

**Table breakdown:**
| Table | Rows |
|-------|------|
| server_stats_requests | 14,203 |
| server_stats_queries | 45,891 |
| server_stats_events | 3,420 |
| server_stats_emails | 156 |
| server_stats_logs | 28,744 |
| server_stats_traces | 1,203 |
| server_stats_metrics | 8,640 |
| server_stats_saved_filters | 3 |

#### 7. Resolved Config Table

| Setting             | Value                   |
| ------------------- | ----------------------- |
| intervalMs          | 3000                    |
| transport           | transmit                |
| channelName         | admin/server-stats      |
| endpoint            | /admin/api/server-stats |
| skipInTest          | true                    |
| onStats callback    | defined                 |
| shouldShow callback | defined                 |

**DevToolbar sub-table:**
| Setting | Value |
|---------|-------|
| enabled | true |
| tracing | true |
| dashboard | true |
| dashboardPath | /\_\_stats |
| debugEndpoint | /admin/api/debug |
| maxQueries | 500 |
| maxEvents | 200 |
| maxEmails | 100 |
| maxTraces | 200 |
| slowQueryThresholdMs | 100 |
| retentionDays | 7 |
| dbPath | .adonisjs/server-stats/dashboard.sqlite3 |
| persistDebugData | false |
| excludeFromTracing | /admin/api/debug, /admin/api/server-stats |
| customPanes | 2 registered |

---

## Frontend Implementation Files

### Edge

- **Dashboard section:** Add `data-ss-section="internals"` block in `src/edge/views/dashboard.edge`
- **Client JS:** Add internals rendering logic in `src/edge/client/dashboard.js`
- **Debug panel tab:** Add internals tab in `src/edge/views/debug-panel.edge` + `src/edge/client/debug-panel.js`
- **Stats bar:** No changes needed

### React

- **Dashboard section:** New file `src/react/components/Dashboard/sections/InternalsSection.tsx`
- **Debug panel tab:** New file `src/react/components/DebugPanel/tabs/InternalsTab.tsx`
- **Register in:** `DashboardPage.tsx` sidebar + lazy import, `DebugPanel.tsx` tab list

### Vue

- **Dashboard section:** New file `src/vue/components/Dashboard/sections/InternalsSection.vue`
- **Debug panel tab:** New file `src/vue/components/DebugPanel/tabs/InternalsTab.vue`
- **Register in:** `DashboardPage.vue` sidebar + async import, `DebugPanel.vue` tab list

---

## Implementation Order

1. **Backend first:**
   - Add `getConfig()` to `MetricCollector` interface and implement in all collectors
   - Add `CollectorHealth` tracking to `StatsEngine`
   - Add `getBufferStats()` to `DebugStore`
   - Add `getStorageStats()` to `DashboardStore`
   - Expose timer/integration states from `ServerStatsProvider`
   - Add `diagnostics()` handler to `DebugController`
   - Register `GET {debugEndpoint}/diagnostics` route
   - Add diagnostics summary to dashboard SSE broadcast

2. **Edge frontend:**
   - Dashboard section + debug panel tab (vanilla JS)

3. **React frontend:**
   - `InternalsSection.tsx` + `InternalsTab.tsx`

4. **Vue frontend:**
   - `InternalsSection.vue` + `InternalsTab.vue`

---

## Out of Scope

- Runtime mutation of config (buffer sizes, intervals, toggling collectors)
- Clearing buffers from the UI
- Historical diagnostics (only current snapshot)
- Alerting or notifications when collectors error
