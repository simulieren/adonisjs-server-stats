# Changelog

All notable changes to `adonisjs-server-stats` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) conventions and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
