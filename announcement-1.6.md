# adonisjs-server-stats v1.6–v1.11 — Announcement

---

## Twitter / X

adonisjs-server-stats v1.11 is out — 15 releases since v1.6 and the biggest update yet.

What's new since v1.6:
- React & Vue (Inertia) support — full component libraries
- Zero-config setup — collectors auto-detect Lucid, Redis, BullMQ
- New diagnostics page — internals, config viewer, route map
- Expandable structured log data with JSON viewer
- Cross-process email capture via mail:queueing events
- EXPLAIN plans for slow queries — click any query to see its execution plan
- Request-log correlation — click a request ID in any log to see the full trace
- Deferred debug panel loading — tiny main bundle
- Resizable tables, badge filtering, simplified config API
- SQLite stability fixes — no more pool exhaustion or event loop starvation
- 1,267 tests, 16% smaller npm bundle, zero oxlint warnings

Thank you to @eduwass for the first community PR!

https://github.com/simulieren/adonisjs-server-stats

---

## Discord

**adonisjs-server-stats v1.11 — Multi-framework support, EXPLAIN plans, log correlation, and 1,267 tests**

15 releases since v1.6. Here's the full rundown.

**Multi-Framework Support** (v1.6)
- Full **React (Inertia)** component library — StatsBar, DebugPanel, DashboardPage
- Complete **Vue 3 (Inertia)** port with composables
- **Edge/Preact** and **Edge/Vue** IIFE bundles for Edge templates
- Shared framework-agnostic core — consistent behavior everywhere

**Zero-Config Setup** (v1.6)
- Collectors auto-detect your installed packages (Lucid, Redis, BullMQ) and enable themselves
- Simplified config API — `toolbar`, `dashboard`, `authorize` as clean top-level keys

```ts
import { defineConfig } from 'adonisjs-server-stats'

export default defineConfig({})
// That's it. Everything is auto-detected.
```

**New Diagnostics & Internals Page** (v1.6)
- See package info, active renderer, registered collectors, and full route map
- Config viewer with search, expand/collapse, redacted value reveal, and one-click copy
- App config and env vars alongside server-stats config (v1.6.2)

**Expandable Structured Logs** (v1.9)
- Log entries with JSON payloads now expand inline with a full JSON viewer
- Click any log row to see the structured data — no more copying log lines to parse manually

**Cross-Process Email Capture** (v1.7)
- Emails sent via `mail.sendLater()` (queued in a separate worker process) are now captured automatically through AdonisJS `mail:queueing` events
- Every email shows up in the debug panel regardless of which process sent it

**Query EXPLAIN Plans** (v1.11)
- Click any slow query in the Dashboard to see its PostgreSQL EXPLAIN plan
- Visualizes Seq Scans, Index Scans, costs, and row estimates — useful for spotting missing indexes

**Request-Log Correlation** (v1.10)
- Logs now include request IDs. Click a request ID in the log viewer to jump to the full request trace with waterfall timeline
- Related log entries appear in a split pane below the waterfall chart when viewing a request

**Performance & DX**
- Deferred debug panel loading — main bundle stays tiny, heavy UI loads on demand
- Resizable table columns across all data tables
- Badge-based filtering in logs, events, and queries
- New CSS architecture with design tokens, component styles, and utility classes
- 16% smaller npm bundle through tree-shaking and dead code removal
- Newest-first sorting across all debug panes and timeline traces

**Stability**
- **SQLite pool exhaustion prevention** (v1.6.5–v1.6.9) — Major reliability rework:
  - Single-connection pool to prevent deadlocks under load
  - Batched writes to prevent event loop starvation
  - All multi-query reads wrapped in transactions
  - Retention cleanup deferred and made non-throwing
- **Non-blocking server startup** — Dashboard SQLite initialization can no longer block the event loop or hang the server. Knex/better-sqlite3 are truly optional.
- **Timer and resource leak fixes** (v1.6.10) — Fixed timer leaks in debug panes and statusbar. Polling now properly cleans up on unmount.
- **Correct Pino stream hooking** (v1.10) — Fixed log piping to use the correct pino symbol for stream detection.
- **Environment-aware initialization** (v1.7) — Smarter detection of available features, merged log stream and email bridge setup.

**Code Quality & Architecture**
- **Zero oxlint warnings** — Eliminated all 214 oxlint warnings via TDD decomposition. Every function under complexity 10, every file under max lines.
- **12 shared components extracted** between Dashboard and DebugPanel (v1.11):
  - LogEntryRow, FilterBar, SplitPaneWrapper, TimeAgoCell
  - JobStatsBar, CacheStatsBar, EmailPreviewOverlay
  - Method/Status badges, duration severity classes
  - useDiagnosticsData hook, field resolver utilities
- **1,267 tests** — Added 891 tests across 22 new test files. Found and fixed 4 bugs during the audit.
- Unified API layer — single `ApiController` + `DataAccess` replaces scattered route handlers
- `registerAllRoutes()` — one call sets up everything
- Separate Vite configs and tsconfigs per build target

**Bug Fixes**
- Fixed EXPLAIN button returning 404 (was using POST instead of GET)
- Fixed debug panel close button not working (`isOpen` → `defaultOpen`) — thanks @eduwass (PR #6)
- Fixed SQLite email field normalization and preview HTML fetching
- Fixed timezone parsing for SQLite datetime strings
- Fixed Prometheus collector type conflicts for symlinked installs
- Fixed trace list field normalization
- Fixed deprecated config warnings to use friendlier tone
- Fixed Vue PropertyKey type error with key bindings

Thank you to @eduwass for the first community contribution!

https://github.com/simulieren/adonisjs-server-stats

---

## Reddit (r/adonisjs)

**Title: adonisjs-server-stats v1.11 — EXPLAIN plans, log correlation, multi-framework support, and 1,267 tests**

**Body:**

15 releases since v1.6. Here's everything that's changed.

### Multi-framework support (v1.6)

You can now use adonisjs-server-stats with React or Vue via Inertia — full component libraries for StatsBar, DebugPanel, and DashboardPage. Edge templates still work out of the box with Preact or Vue-powered IIFE bundles. All frontends share a common core, so behavior is consistent everywhere.

### Zero-config setup (v1.6)

Collectors now auto-detect your installed packages. If you have Lucid, Redis, or BullMQ installed, the corresponding collectors enable themselves automatically. The config API has been simplified too — `toolbar`, `dashboard`, and `authorize` are now clean top-level keys.

```ts
import { defineConfig } from 'adonisjs-server-stats'

export default defineConfig({})
// That's it. Everything is auto-detected.
```

### New diagnostics page (v1.6)

A new Internals tab shows package info, the active renderer, registered collectors, and a full route map. The config viewer lets you search, expand/collapse sections, reveal redacted values, and copy with one click. Since v1.6.2 it also shows your app config and environment variables.

### Expandable structured logs (v1.9)

Log entries with JSON payloads now expand inline with a full tree viewer. No more copying log lines to parse them manually.

### Cross-process email capture (v1.7)

Emails sent via `mail.sendLater()` — which runs in a queue worker process — are now captured automatically through AdonisJS `mail:queueing` events. Every email shows up in the debug panel regardless of which process sent it.

### Query EXPLAIN plans (v1.11)

Click any query in the Dashboard to see its PostgreSQL EXPLAIN output. It shows the execution plan, node types, costs, and row estimates — useful for spotting Seq Scans and missing indexes.

### Request-log correlation (v1.10)

Every log entry now carries its request ID. Click it to jump to the full request trace with a waterfall timeline and related logs in a split pane.

### Stability

The SQLite-backed dashboard storage got a major reliability rework across v1.6.5–v1.6.9:
- Single-connection pool to prevent deadlocks
- Batched writes to prevent event loop starvation under load
- All multi-query reads wrapped in transactions
- Knex/better-sqlite3 are truly optional — missing deps never block startup

### Performance & DX

- Deferred debug panel loading — the main bundle stays tiny
- Significantly smaller JS & CSS bundles (16% smaller npm package)
- Resizable table columns across all data tables
- Badge-based filtering in logs, events, and queries
- Newest-first sorting across all panes
- New CSS architecture with design tokens and utility classes

### Code quality

- **Zero oxlint warnings** — all 214 eliminated via TDD decomposition
- **1,267 tests** — up from ~370 in v1.6. Added 891 tests across 22 new files, found and fixed 4 bugs along the way
- **12 shared components** extracted between Dashboard and DebugPanel, removing ~2,000 lines of duplication
- First community PR merged — thank you to @eduwass for the debug panel close button fix

### Upgrade

```bash
npm install adonisjs-server-stats@latest
```

No breaking changes since v1.6. All fixes and features are backwards compatible.

GitHub: https://github.com/simulieren/adonisjs-server-stats
