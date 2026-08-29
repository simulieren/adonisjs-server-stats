# Changelog

All notable changes to `adonisjs-server-stats` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) conventions and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.18.0] - 2026-08-29

One new feature: a size cap on the dashboard's SQLite database, on by default.

### Added

- **`maxDbSizeMb` — a disk budget for persisted stats** (default **500 MB**, `0` disables).
  `retentionDays` bounds *age*, not *size*: with tracing and `persist: true` a busy dev server
  can write hundreds of MB per day (a real week-old dev database reached 1.9 GB — full SQL
  text and bindings per query, ~2.3 KB of span JSON per trace), and time-based retention
  working exactly as configured will happily keep all of it. The cap bounds size directly.

  When the database's live data exceeds the cap, the cleanup pass (30 s after boot, then
  hourly) deletes the **globally oldest** rows — regardless of age — in 1,000-row batches
  until usage drops below ~90% of the cap, then returns the freed pages to the OS. Each batch
  comes from whichever root table currently holds the oldest data, so a trace-heavy and a
  log-heavy app both shed their actual oldest history first. Hitting the cap simply shortens
  the effective retention window instead of growing the file without bound.

  Configure it wherever retention already lives, with `production.maxDbSizeMb` taking
  precedence in production:

  ```ts
  export default defineConfig({
    dashboard: { retentionDays: 7, maxDbSizeMb: 500 },
    production: { enabled: true, maxDbSizeMb: 200 },
  })
  ```

  The storage panel (`GET {dashboardPath}/api/storage`) and the Internals tab report the cap
  alongside file size and retention.

### ⚠️ Behavior change

- **The cap is on by default.** An existing install whose database already exceeds 500 MB will
  be pruned down to the cap on the first cleanup after upgrading — oldest records first. Set
  `maxDbSizeMb: 0` to keep unbounded growth, or raise the number. Because pruning works in
  1,000-row batches, the stop point can overshoot below the target by up to one batch.

### Internal

- Enforcement measures live data as `(page_count − freelist_count) × page_size`, so pages
  already freed by the retention pass don't count against the budget.
- 8 new tests: cap pruning oldest-first, exact stop behavior, `0` disabling the cap, untouched
  under-cap databases, cross-table oldest-first ordering, and config resolution
  (default, explicit `0`, production override, `dashboard.{}` alias mapping).
- Verified at scale: 36 MB of un-expired data against a 10 MB cap prunes to 7.7 MB in ~0.4 s
  with FK cascades intact and the freelist fully drained.

## [1.17.1] - 2026-08-29

One bug fix (with two amplifying defects fixed alongside it), no API changes.

### Bug Fixes

- **Retention cleanup no longer blocks the host event loop indefinitely** ([#14](https://github.com/simulieren/adonisjs-server-stats/issues/14)). `server_stats_events.request_id` had an `ON DELETE CASCADE` foreign key but **no index** — the one FK child that was missed (`queries`, `traces`, and `logs` all have one). Every request deleted by retention cleanup triggered a full scan of the events table, synchronously, inside better-sqlite3. On a week-old dev database (147k events, ~10k expired requests) that meant ~1.5 billion row visits on the event loop: HTTP stopped responding, CPU pegged at 100%, and SIGTERM could not even be processed. Because the cleanup runs 30 seconds after every boot, it presented as "the app randomly stopped working today". `migrateEvents` now creates `idx_ss_events_request`; `autoMigrate` runs on every boot, so existing installs get the index automatically.

  Two defects amplified the hang and are fixed alongside it:

  - **`batchDelete` was O(n²) in backlog size.** After each 1,000-row batch it re-counted the entire remaining backlog with a ranged `COUNT(*)`. It now reads `SELECT changes()` from the delete itself, making total work linear.
  - **Deleted pages were never returned to the OS.** The cleanup ended with `PRAGMA optimize`, which only updates planner statistics, so the database file stayed at its high-water mark forever (1.9 GB in the report). New databases are now created with `auto_vacuum=INCREMENTAL` and each cleanup drains the freelist in ~8 MB chunks, yielding to the event loop between chunks. Existing databases can't switch modes in place, so when more than ~30% of the file is dead pages the cleanup runs a guarded one-time `VACUUM` that reclaims the space *and* converts the file to incremental mode — VACUUM cost scales with surviving data, not file size, so a mostly-expired bloated file converts quickly.

  One subtlety worth recording: `PRAGMA incremental_vacuum(N)` frees one page per `sqlite3_step`, and Knex's `raw()` steps no-result statements exactly once — so through Knex it silently freed a single page per call. The vacuum runs on the underlying better-sqlite3 handle (`.pragma()` steps to completion). Likewise `auto_vacuum` must be the *first* pragma applied on a new connection: even `journal_mode=WAL` initializes the database header, after which the mode is frozen.

### Internal

- 6 new tests (`tests/retention_cleanup.spec.ts`): FK index presence, incremental `auto_vacuum` on new databases, cascade correctness, exact-batch-multiple termination, multi-batch backlogs, and freelist drained to zero across multiple vacuum chunks.
- Verified against the reported scale: 10,000 expired requests cascading to 150,000 events and 100,000 queries — cleanup completes in **~0.5 s** (previously hung indefinitely), freelist drains to 0, and the file shrinks 36 MB → 0.1 MB. A simulated legacy (`auto_vacuum=NONE`) database converts via the guarded VACUUM path: 42 MB → 0.1 MB, with the next cleanup taking the incremental path.

## [1.17.0] - 2026-08-20

Hardening release: every finding from a full four-track code review (security, performance,
correctness, frontend) fixed in one pass. No breaking API changes; two behavior changes in
production mode are called out below.

### Security

- **camelCase credential names are now redacted.** The `_`/`.`/`-` word boundaries in
  `sensitive_patterns.ts` never matched a lower→upper transition, so `passwordHash`,
  `clientSecret`, `jwtSecret` — the normal shape for AdonisJS config keys and camelCase column
  strategies — bypassed both the SQL-binding redaction and the config inspector while their
  snake_case twins were masked. Names are normalized before testing, the trailing boundary
  tolerates plurals (`tokens`, `secrets`), and the word list gains
  `totp`/`mfa`/`passwd`/`pwd`/`cvv`/`cvc`/`pin`/`ssn`/`authorization`/`cookie`.
- **`production.capture.emails: false` is now honored everywhere.** `DashboardStore` subscribed
  to the `mail:*` events unconditionally and persisted full bodies regardless of the capture
  flag, and the Redis email bridge published mail outside every production gate — including
  from queue workers with production mode off. Both now obey `production.enabled` +
  `capture.emails`, and the bridge channel is configurable via `advanced.emailBridgeChannel`
  for namespacing on shared Redis.
- **SQL bindings are sanitized at capture time**, not only at persistence, so the in-memory
  debug panel can no longer show plaintext the persisted dashboard would have redacted.
- **Stored request URLs redact credential-bearing query params** (`?token=…`, `?reset_token=…`,
  credential-shaped values) at the middleware choke point; ordinary params pass through.
- **Persisted log records are redacted** against the shared rules (secret-named keys incl.
  `authorization`/`cookie` headers, credential-shaped values) — without truncation, so stack
  traces stay whole.
- **Cache inspector is scoped.** New `advanced.cacheKeyPrefix` (env var
  `SERVER_STATS_CACHE_KEY_PREFIX` still works) allow-lists which Redis keys the Cache tab may
  list, read, and delete. **Behavior change:** in production, single-key reads and deletes are
  refused until a prefix is configured — a production dashboard must not be able to read
  session keys or delete rate-limit counters. Dev without a prefix keeps full access.
- **Config inspector redacts credential-shaped values inside arrays** (a provider key inside
  `{ keys: [...] }` previously reached the browser intact).
- **Edge `@serverStats()` tag registers only when the routes actually registered.**
  **Behavior change:** when the fail-closed guard refuses registration (no `authorize`
  callback), the stats bar no longer renders — previously it rendered for every visitor and
  404'd on every poll, or in production advertised the stats API to anonymous users.
- **Email token-link redaction bypasses closed:** `reset_token=` / `resetToken=` / `id_token=`
  slipped past the `\b`-anchored regex; `set-password` paths join the sensitive-path list; a
  long opaque path segment (a bare token in the path) is now redacted while hyphenated
  newsletter slugs survive.
- **Deleted the latent unguarded EXPLAIN path** (`DashboardStore.runExplain`,
  `explain_query.ts`, `format_helpers.runExplain`) — zero callers, none of the hardening the
  live handler received.
- Saved-filter create validates input sizes; Edge templates escape `<` in JSON `<script>`
  blocks; `CoalesceCache` is capped at 500 entries (keys embed user search input and nothing
  ever evicted).

### Performance

- **The SQLite flush path yields to the event loop** (every 10 requests and between insert
  chunks). better-sqlite3 is synchronous, so a full backlog previously executed hundreds of
  statements back-to-back on microtask continuations — a multi-ms stall recurring every 500ms
  under load.
- **Composite `(created_at, duration)` index** covers the overview p95 query, which otherwise
  sorted the whole filtered range on every 2s cache miss.
- **Paginated lists cap their COUNT scan at 10k rows** and clamp `?page=` into the real range
  (an arbitrary offset forced a full scan on the single SQLite connection).
- **React dashboard no longer double-polls `/api/overview`** — `DashboardPage` shares its
  poller through a context that `OverviewSection` consumes, matching the earlier Vue fix.
- `appCollector` documents the indexes its 3s `COUNT(*)` polls require (JSDoc + README).

### Bug Fixes

- **Dashboard persistence survives in-process restarts.** The request-pipe guard flag was never
  reset while shutdown nulled the handler slot, so a second boot in the same process (test
  harness, programmatic restart) silently disabled persistence for the rest of the process.
- **Dashboard email preview and cache-key detail fetches are cancellable** (React and Vue):
  rapid clicks can no longer resolve out of order and show the wrong body under the current
  selection. `DashboardApi.fetchCacheKey`/`fetchEmailPreview` accept an optional `RequestInit`.
- `TraceCollector` tracks the `console.warn` patch owner and takes over from a stale instance
  instead of deferring to its dead wrapper; `FlushManager.stop()` blocks late timer
  rescheduling; redis-collector and write-queue warn-once state is per-instance/resettable;
  dead `boot_initializer.ts` removed; `types.ts` no longer claims events are never persisted.

### Tooling

- **GitHub Actions CI**: typecheck, lint, tests, and build on Node 20/22/24. Tests run through
  `scripts/run-tests-split.mjs` (`npm run test:ci`), one process per spec file — the combined
  single-process suite aborts at exit on a better-sqlite3 environment-cleanup assert under
  Node 22+ that also eats the japa summary; individual files run and exit cleanly.
- `package.json` gains `author`, `repository`, `homepage`, and `bugs`; the README notes the
  package has zero runtime dependencies.

## [1.16.1] - 2026-08-19

Two bug fixes, no API changes.

### Bug Fixes

- **Application events are now persisted** ([#12](https://github.com/simulieren/adonisjs-server-stats/issues/12)). `server_stats_events` was never written to: `DashboardStore.queueEvents()` forwarded to `FlushManager.queueEvents()`, which fed `flushEvents()` — every piece worked, but nothing ever called it. Because `DataAccess.getEvents()` prefers the SQLite table whenever persistence is on, **enabling `dashboard: true` made the Events tab permanently empty** and hid in-memory events that `EventCollector` had already collected.

  Simply wiring the existing path would not have been enough — `buildEventRows` hardcoded `request_id: null`, and events are pruned only via the `server_stats_requests` foreign-key cascade, so those rows would never have been reclaimed. Events now travel on `PersistRequestInput` alongside queries and traces and are inserted with the real request id, which gives correct FK linkage (retention prunes them), inherits the existing write-queue backpressure, and let the misleading `queueEvents`/`pendingEvents`/`flushEvents` path be removed rather than half-wired. Respects `production.capture.events`.

  Adds `EventCollector.getEventsSince()`, mirroring `QueryCollector.getQueriesSince()` (`src/debug/event_collector.ts`, `src/provider/dashboard_init.ts`, `src/dashboard/write_queue.ts`).

- **SQL bindings are now redacted by name and by shape** ([#13](https://github.com/simulieren/adonisjs-server-stats/issues/13)). `sanitizeBindings` claimed to redact secret-looking values but only truncated strings over 256 characters, so anything shorter was persisted verbatim — password reset tokens, API keys, bcrypt hashes, session ids, OTPs. `ConfigInspector` masked those same values properly, so the same secret was redacted in the Config tab and printed in full in the Queries tab.

  Two rules now apply, because neither is sufficient alone:

  - **By statement** — if the SQL mentions a credential-shaped identifier (`password`, `remember_token`, `otp`, ...), every binding for that statement is redacted. Positional bindings cannot be mapped back to columns, so it is all-or-nothing per statement, and it is the only rule that catches a short secret like a 6-digit OTP.
  - **By value shape** — password hashes, JWTs, provider key prefixes (`sk_`, `ghp_`, `xoxb-`, `AKIA`), long hex digests, and URLs with embedded credentials are redacted wherever they appear.

### ⚠️ Behavior change

- **Some bindings you used to see are now `[redacted]`.** Statement-level redaction is deliberately coarse: a query touching a `password` or `token` identifier has *all* of its bindings masked, including innocuous ones like the row id. That is the safe trade, but it does make those specific queries less informative than before. Ordinary parameters — ids, flags, emails, timestamps — still pass through untouched.

### Internal

- Sensitive-name patterns extracted to `src/dashboard/sensitive_patterns.ts` so the config inspector and the binding writer share one definition of "looks like a secret". Email and SMTP names remain **config-only**: an `email` env var is usually an SMTP account, but an `email` column is ordinary application data and redacting it would make auth debugging impossible.
- 30 new tests (`tests/binding_redaction.spec.ts`, `tests/event_persistence.spec.ts`), plus a rewritten `buildEventRows` assertion that previously encoded the `request_id: null` bug.
- Verified in a real AdonisJS app: events persist with a real `request_id` where the table was previously always empty; a password update has every binding redacted; a hex token is redacted inside an otherwise ordinary statement while its plain bindings survive untouched.

## [1.16.0] - 2026-08-19

Opt-in production mode, plus a security fix to the access guard found while building it.

### Security

- **`authorize` is now awaited.** The route guard called the callback without `await`, so an **async** `authorize` returned a promise — always truthy — and **every request was allowed through**. Anyone whose guard did `async (ctx) => { await ctx.auth.authenticate(); ... }` had an unguarded dashboard. `authorize` now accepts `(ctx) => boolean | Promise<boolean>` and is awaited in the route middleware (`src/routes/access_middleware.ts`) and in the dashboard page check (`src/dashboard/dashboard_controller.ts`).

  The declared type was `(ctx) => boolean`, so TypeScript users were warned at compile time; JS consumers, `as any`, or an ignored error were not.

### ⚠️ Behavior changes

- **An async `authorize` that resolves `false` now returns 403** instead of allowing the request. If your dashboard "worked" with an async guard, it was not being guarded — expect 403s until the guard genuinely passes.
- **The `@serverStats()` Edge toolbar hides itself when `authorize` is async.** Edge evaluates the guard synchronously while rendering and cannot await it, so the bar fails closed and logs a one-time warning. HTTP routes are guarded correctly either way; only the cosmetic bar is affected. Use a synchronous guard to keep the bar.
- **The Edge plugin is no longer registered when routes were not registered.** Previously the tag rendered a stats bar in production that polled a 404 on every tick.

### New options

- **`production?: ProductionConfig`** — opt in to running in production, where this package previously did nothing at all. Both hard gates (`registerRoutes` and the debug/dashboard store setup) now lift when `production.enabled` is set.

  ```ts
  export default defineConfig({
    authorize: async (ctx) => (await ctx.auth.check()) && ctx.auth.user?.isAdmin === true,
    dashboard: true,
    production: {
      enabled: true,
      capture: { queries: true }, // everything else stays off
      retentionDays: 3,
    },
  })
  ```

  - **An `authorize` guard is mandatory.** `unsafeAllowNoAuth` is **ignored** in production — without a guard the routes are not registered and a warning explains why.
  - **Capture is off unless requested,** one subsystem at a time via `production.capture` (`queries`, `events`, `emails`, `traces`, `logs`). With none enabled you still get the request list, overview, and charts, at a small fraction of the write volume. A disabled subsystem is never subscribed, so it costs nothing and its pane simply stays empty.
  - **`retentionDays` defaults to 3** in production instead of 7.
  - An always-visible boot banner reports what is reachable, which guard is active, what is being captured, and where the data lands. It fires only after routes were actually registered.

  Two caveats, both documented: the toolbar and React/Vue components request relative URLs, and retention deletes rows without running `VACUUM`, so the SQLite file plateaus rather than shrinking.

### Improvements

- `registerAllRoutes` returns whether it registered anything, so callers cannot announce a dashboard that was never wired up (`src/routes/register_routes.ts`)
- `tracing: false` still overrides `capture.traces` — the older kill switch keeps winning (`src/provider/dashboard_setup.ts`)
- `DebugStore` treats a config without `capture` as capture-everything, so a config object built before this release behaves exactly as before (`src/debug/debug_store.ts`)

### Tests

- 24 new tests covering config resolution, the production registration gate, per-subsystem capture resolution, retention precedence, and collector subscription (`tests/production_mode.spec.ts`), plus rewritten async-guard tests that previously asserted the fail-open behavior (`tests/access_middleware.spec.ts`)
- Verified end to end in a real AdonisJS v7 app under `NODE_ENV=production`: async guard returns 403/200 correctly, enabled subsystems capture while disabled ones stay empty, `unsafeAllowNoAuth` is ignored, and the default remains fully off

## [1.15.0] - 2026-08-18

### New options

- **`domain?: string`** — restrict every server-stats route (stats endpoint, debug panel, dashboard) to a single host, using AdonisJS's native `router.group().domain()`. Useful when your admin surface already lives on its own subdomain.

  ```ts
  defineConfig({ domain: 'admin.example.com' })
  defineConfig({ domain: ':tenant.example.com' }) // dynamic subdomain
  ```

  The dashboard is then reachable at `admin.example.com/__stats` and nowhere else. Opt-in and inert when unset — the route tree is unchanged for anyone who does not configure it.

  Two caveats, both documented in the README:

  - The `@serverStats()` Edge tag and the React/Vue components request **relative** URLs, so the toolbar only works on pages served from the configured domain.
  - Routes are never registered in production regardless (`app.inProduction` short-circuits registration), so `domain` shapes dev and staging environments.

- `defineConfig` warns when `domain` carries a protocol, path, or port. `.domain()` matches the host alone, so such values silently match nothing — a warning rather than a throw, so a typo degrades to "dashboard unreachable" instead of "app won't boot".

### Improvements

- The auto-registered route log is host-qualified when `domain` is set (`admin.example.com/__stats/*` rather than a bare path that will not resolve) (`src/provider/boot_helpers.ts`)
- Boot-time advisory when `domain` and the Edge toolbar are both enabled, explaining the relative-URL caveat (`src/provider/boot_helpers.ts`)
- `registerStatsRoute` takes an options object, matching the debug and dashboard registrars (`src/routes/stats_routes.ts`)
- `AdonisRouteGroup.use()` returns the group, as AdonisJS does, allowing any chaining order (`src/routes/router_types.ts`)

### Tests

- 11 tests covering config resolution, route registration under `domain`, the invariant that the stats route stays ungrouped without one, dynamic subdomains, value validation, and the startup log prefix (`tests/domain_routing.spec.ts`)

## [1.14.1] - 2026-07-13

### Bug Fixes

- Fix a TypeScript error in the React dashboard `RequestsSection` — the parameterized `fetch<TraceDetail>()` made the direct `Record<string, unknown>` cast a `TS2352`; now cast through `unknown` (`src/react/components/Dashboard/sections/RequestsSection.tsx`)
- Fix a pre-existing `vue-tsc` error in the Vue `DataTable` — `rowKey` cast to `PropertyKey` (which includes `symbol`) but returns `string | number`; now cast to `string | number` (`src/vue/components/Dashboard/shared/DataTable.vue`)

### Internal

- `typecheck` now covers the React (`tsconfig.react.json` via `tsc`) and Vue (`tsconfig.vue.json` via `vue-tsc`) sources in addition to the root config. The root `tsconfig` excludes `src/react`/`src/vue`, so frontend type errors were previously never caught by `npm run typecheck`. Adds `vue-tsc` as a devDependency.

These are type-only fixes — the emitted JavaScript is unchanged from 1.14.0.

## [1.14.0] - 2026-07-13

Security-hardening, correctness, and restart-safety release. Every fix below was verified against the source and the full test suite (1466 tests) passes.

### ⚠️ Behavior changes

- **The dashboard now fails closed.** If no access guard is configured (`authorize`, or the legacy `shouldShow`), the sensitive routes — dashboard, debug API, and stats — are **no longer registered**, and a warning is logged. To register them without a guard (local dev only), set the new `unsafeAllowNoAuth: true`. **Existing users with `authorize`/`shouldShow` are unaffected** — their guard is honored exactly as before.
- **Config values are truly redacted.** The config inspector no longer sends plaintext secret values to the browser; only the masked display is transmitted. The client-side "reveal" of plaintext has been removed.
- **Mutating dashboard routes now require a same-origin request** (`DELETE /api/cache/:key`, `POST /api/jobs/:id/retry`, `POST`/`DELETE /api/filters`). Cross-origin calls receive `403`.
- **Cache key operations can be scoped** via the `SERVER_STATS_CACHE_KEY_PREFIX` env var (unset = unrestricted, preserving current behavior). `EXPLAIN` now runs against the read connection.

### New options

- `unsafeAllowNoAuth?: boolean` — escape hatch to expose the dashboard without an access guard. Off by default; logs a one-time warning when enabled. Local development only.
- `SERVER_STATS_CACHE_KEY_PREFIX` (env var) — restricts dashboard cache read/delete to keys under this prefix.

### Security

- Config inspector no longer ships plaintext secrets to the browser; redaction is applied before serialization (`src/dashboard/integrations/config_inspector.ts`)
- Debug-panel email-preview iframe is now sandboxed (`sandbox=""`), preventing stored XSS from captured email HTML (`src/vue/components/DebugPanel/tabs/EmailsTab.vue`)
- Email-preview endpoints now send `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, and `X-Frame-Options: SAMEORIGIN` (`src/routes/dashboard_routes.ts`, `src/routes/debug_routes.ts`)
- Fail-closed access control on route registration with the `unsafeAllowNoAuth` escape hatch (`src/routes/register_routes.ts`)
- Storage hygiene: token-bearing links in captured email bodies are stripped and oversized SQL bindings truncated before persistence (`src/provider/email_helpers.ts`, `src/dashboard/write_queue.ts`, `src/debug/debug_store.ts`)
- Consolidated and expanded the sensitive-key redaction word list (`src/core/config-utils.ts`)
- `EXPLAIN` uses the read client and rejects `;`/`--`/`/*`; `perPage` is clamped (1–200) on all list endpoints (`src/dashboard/query_explain_handler.ts`, `src/dashboard/paginate_helper.ts`)

### Bug Fixes

- Fix two `RequestMetrics` circular-buffer indexing bugs that skewed req/s and error-rate after the buffer first wrapped or under out-of-order request completion (`src/engine/request_metrics.ts`)
- Fix BullMQ `queue_collector` leaking a Redis connection on every failed poll — the Queue is now created once and closed on stop (`src/collectors/queue_collector.ts`)
- Make `EventCollector`/`TraceCollector` idempotent and restart-safe; error spans are now marked instead of appearing successful (`src/debug/event_collector.ts`, `src/debug/trace_collector.ts`)
- `FlushManager.stop()` now awaits an in-flight flush before the final flush, so queued data is no longer dropped at shutdown (`src/dashboard/flush_manager.ts`)
- Log-level type guard so string-level Pino output no longer zeroes error/warning counts (`src/log_stream/log_stream_service.ts`)
- Restore the pino `write` monkey-patch on shutdown to prevent double log ingestion after hot-reload (`src/provider/pino_hook.ts`, `src/provider/shutdown_helpers.ts`)
- Remove module-level `_whenReady` route singletons that could be clobbered on re-registration/hot-reload (`src/routes/debug_routes.ts`, `src/routes/dashboard_routes.ts`)
- `RingBuffer` no longer propagates push-callback exceptions out of the synchronous write path (`src/debug/ring_buffer.ts`)
- Add the new resolved config fields to `ResolvedServerStatsConfig` (`src/types.ts`); reset the Prometheus singleton and clear lifecycle timers on shutdown

### Frontend

- React hooks now react to post-mount config changes (API client, controller, and unauthorized latch reset on `baseUrl`/`authToken` change) (`src/react/hooks/*`)
- Add `AbortController` cancellation to ad-hoc detail/preview fetches in React and Vue, eliminating click-race data corruption (`src/react`, `src/vue`)
- Vue `CacheSection` API client is created inside `setup()` instead of at module scope; a single shared overview poller replaces three; stable keys and ARIA tab roles added (`src/vue/components/Dashboard`)

### Build & packaging

- Fix the broken `/core` `.d.ts` re-export chain that produced `TS2307` for consumers of `adonisjs-server-stats/core` (`vite.config.core.ts`, `package.json`)
- Add `engines: { node: ">=18.0.0" }` and correct the `sideEffects` CSS glob
- `configure` now prompts before registering the `log-stream` provider; the excluded pino diagnostic was moved out of the test glob (`configure.ts`)

## [1.13.0] - 2026-06-05

### Features

- Add `@adonisjs/queue` support (parity with BullMQ): live metrics collector + Jobs inspector (overview, list, detail, retry). Auto-detected alongside BullMQ — both `database` (Lucid) and `redis` drivers of `@adonisjs/queue`/`@boringnode/queue` are supported
- Cross-process email capture now persists worker-process emails to the dashboard SQLite store — emails sent from `@adonisjs/queue` workers (or any separate process) appear in the dashboard with HTML preview, not just the in-memory toolbar

### Bug Fixes

- Fix queue collector resolving config via a non-existent `@adonisjs/queue/config` subpath — now resolved via `@adonisjs/core/services/app`
- Fix `AdonisQueueInspector` store-reader resolution race: concurrent `getOverview`/`listJobs` calls returned empty results — now memoizes the resolution promise

## [1.12.1] - 2026-03-14

### Bug Fixes

- Fix EXPLAIN error display in debug panel: errors were showing "No plan data returned" instead of the actual error message. Root cause: `completeExplain()` stored errors in `entry.result.error` but the renderer checked `entry.error`. Fixed by using `failExplain()` for server errors (`src/react/components/DebugPanel/tabs/QueriesTab.tsx`)
- Fix EXPLAIN error display in dashboard (React): was showing generic "API error (HTTP 500)" instead of the actual error message. Now parses `ApiError.body` to extract the real server error (`src/react/components/Dashboard/sections/QueriesSection.tsx`)
- Fix EXPLAIN error display in dashboard (Vue): same fix applied to the Vue dashboard component (`src/vue/components/Dashboard/sections/QueriesSection.vue`)

### Tests

- Add comprehensive TDD tests for EXPLAIN feature covering `buildExplainSql`, `extractPlan`, dialect detection via `getAppDbClient`, `QueryCollector.getQueryById`, and round-trip tests for all supported database dialects (`tests/query_explain_server.spec.ts`)

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
