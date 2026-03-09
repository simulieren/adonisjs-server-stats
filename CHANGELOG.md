# Changelog

All notable changes to `adonisjs-server-stats` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) conventions and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.11.0] - 2026-03-09

### Bug Fixes

- Fix EXPLAIN button returning 404 — route handler was registered as POST but the client sent a GET request (`ac80512`)

### Refactoring

- Deduplicate 7 shared patterns between Dashboard and DebugPanel: `JobStatsBar`, `CacheStatsBar`, `durationClassName`, `Badge` reuse, `EmailPreviewOverlay`, `TimeAgoCell`, and field-resolvers (`eb2f840`)
- Extract shared `SplitPaneWrapper` component from `RequestsSection` and `TimelineTab` to eliminate structural duplication (`d2b54f4`)
- Extract `useDiagnosticsData` hook from `InternalsSection` and `InternalsTab`, consolidating repeated data-fetching logic into a single shared hook (`c415583`)
- Extract shared `LogEntryRow` component used by Dashboard, DebugPanel, and RelatedLogs, removing three near-identical inline implementations (`808bf27`)

## [1.10.3] - 2026-03-09

### Bug Fixes

- Fix TS2352 type error in `applyAdvancedConfig`: use double-cast (`as unknown as Record<string, unknown>`) for dynamic property assignment on `DevToolbarOptions`

## [1.10.2] - 2026-03-09

### Bug Fixes

- Fix debug panel close button not working in the Preact deferred entry: changed `isOpen={true}` to `defaultOpen={true}` so the panel can be dismissed (PR #6 by @eduwass)

## [1.10.1] - 2026-03-09

### Refactoring

- Unify `FilterBar` component between Dashboard and DebugPanel — canonical DebugPanel version moved to shared location, unified CSS via variables, `JobsTab` in DebugPanel gains search field
- Fix Dashboard search lifecycle bug: `useEffect` cleanup set `stopped=true` but `syncAndFetch` called `fetch(true)` which never reset it, causing `isStaleResponse()` to silently discard all responses after param changes; fixed by calling `start()` instead
- Eliminate all oxlint warnings (214 → 0) across the entire codebase via TDD decomposition:
  - Extract `DashboardStore` (1575 → 340 lines) into 10 focused modules: `flush_manager`, `read_queries`, `overview_store_queries`, `saved_filter_queries`, `explain_query`, `cache_handlers`, `jobs_handlers`, `filter_handlers`, and more
  - Extract `ServerStatsProvider` (1178 → 268 lines) into `boot_helpers`, `provider_helpers_extra`, `toolbar_setup`, `dashboard_init`, `dashboard_setup`
  - Extract `DashboardController` (423 → 245 lines) into focused cache/jobs/filter handlers
  - Split route registration into smaller focused functions
  - Refactor Vue composables to stay under 50-line function limit
- Further decompose `DashboardDataController.fetch()` — extract `shouldSkipFetch`, `prepareFetch`, `executeFetch`, `isStaleResponse`, and `shouldIgnoreError` private methods to reduce cyclomatic complexity below 10
- Extract helpers across 11 additional core files: `config-utils`, `transmit-adapter`, `dashboard-data-controller`, `define_config`, `feature-detect`, `formatters`, `log-utils`, `pagination`, `server-stats-controller`
- Move `MAX_HISTORY`/`STALE_MS` constants to `constants.ts` with re-exports
- Fix emitter passthrough for dashboard email collection

### Documentation

- Add comprehensive JSDoc with `@default`, examples, and descriptions to `ToolbarConfig`, `DashboardConfig`, `AdvancedConfig`, and all recommended `ServerStatsConfig` fields (`pollInterval`, `realtime`, `authorize`, etc.)
- Update `defineConfig()` JSDoc with clean defaults table and progressive examples
- Fix `tracing` default in README: `false` → `true` (both `ToolbarConfig` and legacy tables)
- Add missing debug panel routes to README: `/config`, `/diagnostics`
- Fix stale `/logs` description: "last 256KB" → paginated entries
- Add missing `DELETE /api/cache/:key` to dashboard routes table
- Document log-request correlation feature (Related Logs in traces)
- Update intro to mention AdonisJS v7 support
- Update React version note to include React 19

## [1.6.10] - 2026-03-06

### Bug Fixes

- Wrap all multi-query SQLite reads in single transactions, reducing pool acquires per method from 2-8 down to 1:
  - `paginate()`: 2 acquires → 1
  - `getRequestDetail()`: 4 acquires → 1
  - `getOverviewMetrics()`: 5 acquires → 1
  - `getOverviewWidgets()`: 5 acquires → 1
  - `getStorageStats()`: 8 acquires → 1
  - `ChartAggregator.aggregate()`: 5 acquires → 1
- Total pool pressure per interaction cycle reduced from ~28 acquires to ~6, eliminating thundering-herd freezes under rapid clicking
- Reduce `acquireTimeoutMillis` from 5 s to 2 s for faster failure recovery and a shorter pending-acquire queue
- Cache `getStorageStats()` with a 10 s TTL (Internals tab polls every 3 s, making repeated reads unnecessary)
- Cache package version reads in `DebugController` to avoid disk I/O on every poll
- Add `RingBuffer.findFromEnd()` for zero-copy single-item lookup
- Use `findFromEnd` in `TraceCollector.getTrace(id)` instead of `toArray().find()`
- Cache `QueryCollector.getSummary()` for 1 s to avoid 4x O(500) recomputation per poll

## [1.6.9] - 2026-03-06

### Bug Fixes

- Replace all `Promise.all` with sequential awaits in SQLite queries — the `max: 1` connection pool makes concurrent acquires pointless and thrashes tarn's scheduler
- Use SQL aggregation instead of loading all rows into JS for overview metrics and chart aggregation, significantly reducing memory pressure
- Compute p95 latency via `ORDER BY` + `OFFSET` in SQL instead of sorting all rows in JS
- Add `acquireTimeoutMillis: 5000` for fast-fail on connection acquire instead of the default 30s silent timeout
- Remove no-op `busy_timeout` PRAGMA (not supported by `better-sqlite3`)
- Move `recordEmail` into the batch write queue to keep writes serialized
- Pre-stringify JSON outside transactions to avoid blocking the event loop during serialization
- Yield to the event loop after each flush transaction to prevent starvation under sustained load
- Add `RingBuffer.collectFromEnd()` for O(K) query collection per request instead of O(N)
- Cap spans per trace at 200 to bound memory usage
- Reduce dashboard broadcast timer from 5s to 30s to lower idle CPU overhead

## [1.5.0] - 2026-02-25

### Features

- Added `oxfmt` and `oxlint` for consistent code formatting and linting across the entire codebase
- Dashboard client (`dashboard.js`) now uses centralized DRY helpers: `fetchSection`, `TRUNC` constant, and typed data accessors — significantly reducing repetition across all panel rendering code

### Refactoring

- Extracted shared server-side utility modules under `src/utils/`:
  - `time_helpers.ts` — timestamp formatting and duration utilities
  - `math_helpers.ts` — numeric rounding and aggregation helpers
  - `transmit_client.ts` — centralized SSE/Transmit client wrapper
  - `mail_helpers.ts` — email normalization utilities
  - `json_helpers.ts` — safe JSON parsing helpers
- `dashboard_controller.ts` now delegates data access to `dashboard_store` instead of issuing raw database queries directly (~400 lines removed from the controller)
- Applied consistent formatting (single quotes, no semicolons) across all TypeScript source files via `oxfmt`

### Bug Fixes

- Fixed sparkline chart cutoff: hardcoded 60-minute window now correctly respects the user-selected range parameter
- Fixed CSS undefined variable references (`--ss-font-mono`, `--ss-text-primary`) that caused broken styles in certain configurations
- Removed duplicate dark theme CSS block that was causing style conflicts
- Fixed Events panel showing blank event names due to a camelCase/snake_case field name mismatch (`eventName` vs `event_name`)
- Fixed overview widgets disappearing during live updates: partial SSE payloads were wiping previously cached widget data
- Fixed Slowest Queries widget showing no SQL: field name mismatch between `sqlNormalized` and `normalizedSql` is now resolved
- Removed placeholder dash (`-`) rendered for empty request IDs in the Logs panel

## [1.4.0] - 2025-02-14

### Features

- Added overview widgets with deep links to the full-page dashboard

## [1.3.2] - 2025-02-13

### Documentation

- Updated README badges

## [1.3.1] - 2025-02-13

### Chores

- Version bump

## [1.3.0] - 2025-02-12

### Features

- Added full-page dashboard with dark/light theme support

### Documentation

- Fixed config reference in README

## [1.2.2] - 2025-02-11

### Bug Fixes

- Increased z-index of all toolbar elements by 3x to prevent overlap with application UI

## [1.2.1] - 2025-02-10

### Documentation

- Added request tracing section to README

## [1.2.0] - 2025-02-10

### Features

- Added per-request tracing with timeline visualization

## [1.1.4] - 2025-02-09

### Documentation

- Removed non-functional `ace configure` command from README

## [1.1.3] - 2025-02-09

### Documentation

- Updated README for configurable debug data path

## [1.1.2] - 2025-02-09

### Features

- Moved debug data storage to `.adonisjs/` directory with configurable path

## [1.1.1] - 2025-02-08

### Features

- Added built-in email collector and persistent debug data support
