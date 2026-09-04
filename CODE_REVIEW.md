# Code Review — adonisjs-server-stats

**Date:** 2026-07-13
**Version reviewed:** 1.13.0 (branch `main`)
**Scope:** Full repository — core runtime, AdonisJS integration, security surface, React frontend, Vue/Edge frontends, build/packaging/tests.

This review was conducted by six independent reviewers, each covering a slice of the codebase. Every finding below was verified against the actual source (quoted line references). Findings are grouped by area; a cross-cutting summary and a prioritized action list are at the top.

---

## Executive summary

The package is well-architected: per-collector error isolation, bounded ring buffers, atomic file writes, `AsyncLocalStorage`-based per-request tracing, and a disciplined Vue port of the React frontend. The provider lifecycle (boot/ready/shutdown) is structurally sound and most timers/listeners are tracked and cleared.

The highest-impact issues cluster in two places:

1. **Security of the exposed dashboard.** The dashboard has no built-in auth — protection is entirely opt-in (`shouldShow`) plus a `NODE_ENV === production` gate. Combined with the config inspector shipping **plaintext secrets** to the browser and an **unsandboxed email-preview iframe**, a single misconfigured non-production environment (staging, preview, container) leaks DB passwords, `app.key`, tokens, and email bodies, and is exploitable via stored XSS from any email the app sends.

2. **Metrics-skew and resource-leak bugs in the core runtime.** Two circular-buffer indexing bugs in `RequestMetrics` quietly distort req/s and error-rate numbers, and the BullMQ `queue_collector` leaks a Redis connection on every failed poll — the most operationally dangerous non-security bug.

Nothing here is a crash-the-host-app bug, but several items will corrupt the data the tool exists to report, and the security items are serious for any deployment that isn't strictly local dev.

### Prioritized action list

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| 1 | Critical | Config inspector sends plaintext secret values to the browser; redaction is cosmetic | `src/dashboard/integrations/config_inspector.ts:73` |
| 2 | Critical | Debug-panel email-preview iframe has no `sandbox` → stored XSS | `src/vue/components/DebugPanel/tabs/EmailsTab.vue:108` |
| 3 | High | No default access control — guard is fully opt-in; only `inProduction` gate protects staging/preview | `src/routes/register_routes.ts:39` |
| 4 | High | Email-preview endpoints serve raw attacker HTML as `text/html`, no CSP/nosniff | `src/routes/dashboard_routes.ts:155`, `debug_routes.ts:116` |
| 5 | High | Secrets persisted unencrypted (email bodies with reset/magic links, SQL bindings) to sqlite + JSON dump | `src/provider/email_helpers.ts:52`, `src/dashboard/write_queue.ts:122` |
| 6 | High | `queue_collector` leaks a BullMQ `Queue`/Redis connection on every failed poll tick | `src/collectors/queue_collector.ts:63` |
| 7 | High | `RequestMetrics.recordRequest` advances `writeIndex` during fill → misaligned scan on first wrap | `src/engine/request_metrics.ts:40` |
| 8 | High | `RequestMetrics.#scanPartialBuffer` assumes ascending timestamps; wrong under out-of-order completion | `src/engine/request_metrics.ts:86` |
| 9 | High | Module-level `_whenReady` singleton clobbered on re-registration (hot-reload/tests) | `src/routes/debug_routes.ts:10`, `dashboard_routes.ts:8` |
| 10 | High | Broken `.d.ts` re-export chain in `/core` bundle → `TS2307` for consumers | `dist/core/types.d.ts` (build: `vite.config.core.ts`) |
| 11 | High | React hook layer ignores post-mount config changes (stale ApiClient / controller / auth latch) | `src/react/hooks/useApiClient.ts:13`, `useDebugData.ts:24`, `useServerStats.ts:35` |

---

## 1. Security (server-exposed surface)

**Posture:** Protection rests on (a) the `this.app.inProduction` gate that skips route registration and toolbar setup in production, and (b) an optional user-supplied `shouldShow` callback. There is no built-in authentication, and CSRF is effectively off on all routes because `noSessionMiddleware` strips `Set-Cookie`. Acceptable for strict local dev, dangerous anywhere the data (plaintext secrets, email bodies, SQL bindings, request URLs) can reach an untrusted viewer.

### Critical

- **Config inspector ships plaintext secrets to the browser; redaction is cosmetic.** `src/dashboard/integrations/config_inspector.ts:73-74`
  `redact(value)` returns `{ __redacted: true, display: '••••••••', value }` — the real plaintext `value` (DB passwords, `app.key`, API keys, env vars) is included in the object. It is serialized into `GET /api/config` (`dashboard_controller.ts:191`) and revealed client-side by a toggle (`revealed ? redacted.value : redacted.display`, `src/react/components/shared/ConfigContent.tsx:42`). Every secret is in the DOM payload before any click; an XSS or a captured response yields cleartext.
  **Fix:** Never send `value` over the wire. Drop it from the payload, or gate reveal behind a separate confirmed server endpoint.

- **Debug-panel email-preview iframe has no `sandbox` → stored XSS.** `src/vue/components/DebugPanel/tabs/EmailsTab.vue:108`
  `<iframe :srcdoc="previewHtml">` renders captured email HTML (attacker-influenced: any outbound mail the app sends) with no `sandbox`, so `<script>` in an email runs same-origin with the admin's session. The dashboard React/Vue variants use `sandbox=""`; only this tab is missing it.
  **Fix:** Add `sandbox=""` (do not include `allow-scripts`).

### High

- **No default access control — guard is fully opt-in.** `src/routes/register_routes.ts:39-42`
  `const middleware = [noSessionMiddleware, ...(options.shouldShow ? [createAccessMiddleware(options.shouldShow)] : [])]`. Without `shouldShow`, the dashboard, debug API, and stats routes register with no auth guard; protection collapses to the `inProduction` check. Any non-production deployment (staging, preview, misconfigured container) is fully exposed.
  **Fix:** Fail closed — refuse to register sensitive routes unless `shouldShow` is provided or an explicit `unsafeAllowNoAuth` flag is set.

- **Email-preview endpoints serve raw attacker HTML as `text/html`, no CSP/nosniff.** `src/routes/dashboard_routes.ts:155`, `src/routes/debug_routes.ts:116`
  Both send captured email HTML with `Content-Type: text/html` and no `Content-Security-Policy` / `X-Content-Type-Options: nosniff`. The endpoint is directly navigable, so a link executes attacker HTML in the dashboard origin even with a client-side sandboxed iframe. (Also flagged by the integration reviewer as a clickjacking vector — add `X-Frame-Options: SAMEORIGIN` too.)
  **Fix:** Return `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'`, `X-Content-Type-Options: nosniff`, and `X-Frame-Options: SAMEORIGIN` on both routes.

- **Secrets persisted unencrypted.** `src/provider/email_helpers.ts:52-58`, `src/dashboard/write_queue.ts:122`, `src/debug/debug_store.ts` (`saveToDisk`)
  Full email bodies (reset links, magic-login URLs, OTPs) up to 50k chars and SQL `bindings` (runtime parameter values — pre-hash passwords, tokens, PII) are stored in `.adonisjs/server-stats/dashboard.sqlite3` and the shutdown JSON dump, and served back through the API. Package `.gitignore` lists only `node_modules/` and `dist/`.
  **Fix:** Strip token-bearing links / truncate bindings before storage; default the DB path outside the app root and document gitignoring it.

### Medium

- **Query EXPLAIN runs stored SQL against the host's *write* connection.** `src/dashboard/query_explain_handler.ts:65,148`
  `getAppDbClient` resolves `conn.getWriteClient()`, and `isSelectQuery` only checks `startsWith('SELECT')` — it doesn't reject trailing `;`/DDL. Risk is bounded (SQL is a previously-executed captured query fetched by id, and pg/mysql reject stacked statements by default) but running on the write client is needless exposure.
  **Fix:** Use the read client; reject SQL containing `;`, `--`, `/*` after the SELECT check.

- **Unbounded `perPage` on list endpoints (DoS).** `src/routes/dashboard_routes.ts:59,83,113,135,170`; `src/dashboard/paginate_helper.ts:27`
  `Number(qs.perPage) || 25` with no clamp, applied directly as `.limit()` on the single better-sqlite3 connection. `?perPage=100000000` forces a large scan/serialization. The `requests` route already clamps to 1–100 (`dashboard_controller.ts:110`) — apply the same everywhere.
  **Fix:** Clamp `perPage` (e.g. 1–200) in every list handler.

- **State-changing endpoints with no CSRF protection.** `src/routes/dashboard_routes.ts:236,250,263,266`
  `DELETE /api/cache/:key` (matches any key incl. slashes), `POST /api/jobs/:id/retry`, `POST/DELETE /api/filters`. `noSessionMiddleware` strips `Set-Cookie` so session CSRF can't apply. Cache handlers pass `decodeURIComponent(params.key)` straight to Redis (`cache_handlers.ts:41`), so an attacker can delete arbitrary Redis keys (sessions, rate-limit counters) or trigger job re-execution.
  **Fix:** Require a custom header / same-origin check on mutating routes; restrict cache ops to a configurable key prefix.

- **Request URLs stored with full query strings.** `src/middleware/request_tracking_middleware.ts`
  Traces finish with `ctx.request.url(true)` (query string included), persisted to `server_stats_requests.url` — so `/auth/verify?token=...` retains tokens.
  **Fix:** Strip sensitive query params before persisting.

### Low

- **Divergent redaction lists.** `src/core/config-utils.ts:261-274`
  The toolbar's `SENSITIVE_WORDS` omits `dsn`, `connectionString`, `database_url`, `redis_url`, `smtp`, `signing` that `config_inspector.ts` catches — the same key can be redacted in one view and cleartext in another.
  **Fix:** Consolidate to one shared predicate.

> **Verified non-issues (not reported as findings):** SQL operator-injection in `filtered_queries.ts:141` (op is a fixed ternary, field is bound via `?`, no HTTP route wires it); `datetime(?, '-${windowSec} seconds')` in `detail_queries.ts:26` (windowSec is a computed integer, not user input); memory-source search in `data_access_helpers.ts:67` filters in JS, not SQL.

---

## 2. Core runtime (collectors, engine, debug, data, utils)

**Assessment:** Defensively written with good error isolation and bounded buffers. The main concerns are two `RequestMetrics` indexing bugs that skew metrics for busy apps, the BullMQ connection leak, and a shutdown data-loss gap.

### High

- **`RequestMetrics.recordRequest` advances `writeIndex` during fill.** `src/engine/request_metrics.ts:40-47`
  During the fill phase (`count < maxRecords`) the `push()` path doesn't use `writeIndex`, but it's incremented on every write anyway. When the buffer first wraps, `writeIndex` is already `maxRecords` positions ahead, so `#scanFullBuffer` starts at the wrong slot and visits records out of order for the first overwrite cycle — inflating/deflating req/s and error-rate just after the buffer fills.
  **Fix:** Only increment `writeIndex` in the overwrite branch, or derive the slot as `count % maxRecords`.

- **`RequestMetrics.#scanPartialBuffer` assumes ascending timestamps.** `src/engine/request_metrics.ts:86-96`
  It walks backwards to find the first record older than the cutoff, then reads forward — correct only if records are strictly time-ordered. Two requests completing out of order leave an older timestamp after a newer one, so the backward scan finds the wrong `startIdx`, including stale and excluding fresh records.
  **Fix:** Scan all `count` records unconditionally in the partial path (buffer is small; cost is trivial).

- **`queue_collector` leaks a BullMQ `Queue`/Redis connection on every failed poll.** `src/collectors/queue_collector.ts:63-75`
  A new `Queue` is created each ~3s tick; if `getJobCounts()`/`getWorkers()` rejects, `queue.close()` is never reached, leaking a Redis connection per failure. Under flaky Redis this drains file descriptors.
  **Fix:** `try { … } finally { await queue.close().catch(() => {}) }`; better, create the `Queue` once in `start()` and close in `stop()`.

### Medium

- **`EventCollector.start()` not idempotent — double-call permanently corrupts `emitter.emit`.** `src/debug/event_collector.ts:93-113`
  A second `start()` sets `originalEmit` to the already-patched function; `stop()` then restores the wrapper, leaving the patch installed and eventually throwing on a null `originalEmit`. (Same root cause flagged by integration reviewer as H3.)
  **Fix:** `if (this.originalEmit) return` at the top of `start()`.

- **`FlushManager.stop()` drops queued data when a flush is in flight.** `src/dashboard/flush_manager.ts:58-63`
  `flush()` early-returns if `this.flushing`. If the timer-triggered flush is running when `stop()` calls `this.flush()`, it returns immediately and everything in `writeQueue`/`pendingLogs`/`pendingEmails` is lost at shutdown.
  **Fix:** Await the in-flight flush before issuing the final one (store/await the flush promise).

- **`LogStreamService.pollNewEntries` module-level `warnedPollFailure` flag.** `src/log_stream/log_stream_service.ts:7,128`
  Module-scoped, so two instances suppress each other's warnings; also reset on every successful poll.
  **Fix:** Make it an instance field.

- **`pollNewEntries` stores `entry.level` without type-checking.** `src/log_stream/log_stream_service.ts:147`
  `level: entry.level as number` is a compile-time-only cast. With string-level Pino output, `getLogStats()`'s `level >= 50` is always false, so error/warning counts are permanently 0. (Also flagged by integration reviewer M2 re: `time` using `Date.now()` instead of `entry.time`.)
  **Fix:** `const level = typeof entry.level === 'number' ? entry.level : 30`.

- **`TraceCollector.span` pushes "completed" spans even when `fn()` throws.** `src/debug/trace_collector.ts:133-156`
  The `finally` block pushes the span unconditionally with no error marker, so error traces look successful.
  **Fix:** Catch to detect the throw path, add `error: true`, rethrow.

- **`RingBuffer.push` propagates `pushCallback` exceptions out of a synchronous infallible write path.** `src/debug/ring_buffer.ts:26-27`
  Callbacks wired to `FlushManager.recordEmail`/`recordLog`; a synchronous throw escapes `push()`, which callers (event/emitter wrappers) don't handle.
  **Fix:** Wrap the callback in try/catch and log instead of propagating.

### Low / Nit

- **`TraceCollector.stop()` clears `globalRef.current` unconditionally.** `src/debug/trace_collector.ts:213` — breaks a second active instance. Fix: `if (globalRef.current === this)`.
- **`appImport` swallows module-init errors in Strategy A/B.** `src/utils/app_import.ts:42-50` — final throw hides the real init error. Fix: push init errors into the `errors` array.
- **`normalizeSql` replaces digits inside identifiers.** `src/dashboard/write_queue.ts:37-39` — `orders_2024` → `orders_?`, merging distinct queries. (Also flagged by integration reviewer L3.) Fix: restrict numeric replacement to value contexts.
- **Nit — `QueryCollector.getSummary` cache not invalidated by `clear()`.** `src/debug/query_collector.ts:102` — stale totals for up to 1s. Fix: `this.cachedSummary = null` in `clear()`.

---

## 3. AdonisJS integration (provider, middleware, controllers, routes, config)

**Assessment:** Provider lifecycle is structurally correct — timers tracked/cleared, `whenReady` prevents startup 503s, most monkey-patches guarded. Main risks are the module-level route singleton, double-wrapping on hot-reload, and missing type fields.

### Critical

- **Module-level `_whenReady` shared across route registrations.** `src/routes/debug_routes.ts:10`, `src/routes/dashboard_routes.ts:8`
  Two `let _whenReady` singletons are overwritten on each `registerDebugRoutes`/`registerDashboardRoutes` call. A second call (hot-reload, test restart) clobbers the closure captured by previously-registered handlers, which then await a promise that may never resolve for their context.
  **Fix:** Pass `whenReady` as a closure parameter to each handler rather than at module scope.

### High

- **`pino_hook` monkey-patch never restored on restart.** `src/provider/pino_hook.ts:23`, `provider_helpers_extra.ts:65`
  `cleanupResources` never unwraps `stream.write`; on hot-reload it re-wraps the already-wrapped fn, so every log entry is ingested/broadcast twice per restart.
  **Fix:** Return the original `write` and restore it during `cleanupResources`.

- **`TraceCollector` patches `console.warn` globally + process-wide singleton.** `src/debug/trace_collector.ts:192,33` — a second instance overwrites the singleton and leaves `console.warn` patched if the first `stop()` is skipped. **Fix:** guard against double-wrapping.

- **`EventCollector` double-wraps `emitter.emit` on restart.** `src/debug/event_collector.ts:99` — same issue as core-runtime finding above.

- **`setOnRequestComplete` silently clobbered by re-init.** `src/provider/dashboard_init.ts:157` — launched via `setImmediate` with no guard; a restart can drop the first handler. **Fix:** disallow multiple calls or accumulate handlers.

- **`ResolvedServerStatsConfig` missing all new recommended fields.** `src/types.ts:961`
  Declares only deprecated names (`intervalMs`, `transport`, `endpoint`, `shouldShow`, `devToolbar`) but not the new ones (`pollInterval`, `realtime`, `statsEndpoint`, `authorize`, `toolbar`, `dashboard`, `advanced`). `app.config.get<ResolvedServerStatsConfig>('server_stats')` reading a new field gets `undefined` at runtime with no TS error.
  **Fix:** Add the new fields to the resolved type, or document that the resolved shape uses old names.

### Medium

- **`noSessionMiddleware` strips `Set-Cookie` after response is sent.** `src/routes/no_session_middleware.ts:20` — `removeHeader` after `await next()` is a no-op for flushed/streaming responses; a future SSE route under these prefixes would leak the cookie. **Fix:** remove before `next()` or use a pre-send hook.
- **`createStartTimeout` leaks a dangling timer on success.** `src/provider/dashboard_setup.ts:32` — 15s timer not cleared when the primary promise wins; can block clean test exit. **Fix:** clear in `.finally()`.
- **`setupDebugBroadcastInternal` returns `timer: null` but creates a live timer.** `src/provider/toolbar_setup.ts:176,189` — shutdown never clears it; it can fire after `stop()` on a destroyed transmit instance. **Fix:** return the live `timer`.

### Low

- **`resolve()` swallows all errors at `info` level.** `src/provider/server_stats_provider.ts:237` — hides real programming errors. Fix: log unexpected errors at `warn`.
- **Stats engine runs in production with no endpoint.** `src/provider/server_stats_provider.ts:83,113` — `ready()`→`initStats()` has no production guard while `boot()` skips routes; collection timer runs in prod with no way to serve data unless `realtime: true`. Undocumented.
- **`PrometheusCollector` static singleton survives shutdown.** `src/prometheus/prometheus_collector.ts:232` — `prom-client` may throw "Metric already registered" on restart. Fix: null the instance on shutdown.
- **Email bridge `processTag` not unique in PID-recycling envs.** `src/provider/email_bridge.ts:144` — `process.pid + Date.now()` collides where all procs are pid 1; cross-process emails filtered out as self-sent. Fix: append `crypto.randomUUID()`.

### Nit

- `ResolvedServerStatsConfig` retains `shouldShow` but not `authorize` (`src/types.ts:987`) — v2 cleanup.
- `DebugStore.stop()` calls collector `stop()` synchronously (`debug_store.ts:107`) — won't await a future async `stop()`.
- `FlushManager` queue fields are public/mutable (`flush_manager.ts:21`) — no `private`/`readonly`.
- `buildExcludedPrefixes` can produce duplicates (`dashboard_setup.ts:53`) — harmless (idempotent matching).

---

## 4. React frontend (`src/react`, `src/dashboard` contract)

**Assessment:** The controller layer (fetchId race guards, AbortController chaining, stop/start lifecycle) is well-designed. The bugs live in the React hook wrapper layer, where three independent issues mean post-mount config changes are silently ignored.

### High

- **`useApiClient` ref never resets on config change.** `src/react/hooks/useApiClient.ts:13`
  The `useCallback` body returns the existing `clientRef.current` and never nulls it when `baseUrl`/`authToken` deps change, so a rotated `authToken` keeps returning a stale client with the old token.
  **Fix:** `useEffect` that sets `clientRef.current = null` when `baseUrl`/`authToken` change.

- **`useDebugData` controller never recreated on config change.** `src/react/hooks/useDebugData.ts:24`
  Created lazily and never replaced; changes to `baseUrl`/`debugEndpoint`/`authToken` after mount are ignored (unlike `useServerStats`, which rebuilds correctly).
  **Fix:** reconstruct the controller when config deps change, or add a `reconfigure()` method.

- **`useDashboardData` action callbacks use empty dep arrays.** `src/react/hooks/useDashboardData.ts:80-90`
  `refresh`/`mutate`/`getApi` memoized with `[]`; `mutate` also uses `controllerRef.current!` which throws if called before first mount.
  **Fix:** include `controllerRef` in deps; guard the non-null assertion.

- **`useServerStats` unauthorized latch can't reset without unmount.** `src/react/hooks/useServerStats.ts:35-59`
  Once `unauthorized` is `true`, the effect's guard permanently blocks reconnection unless the component fully unmounts; a same-instance auth refresh stays stuck.

### Medium

- **Uncancelled ad-hoc `fetch` in `EmailsTab.openPreview` / `CacheTab.handleKeyClick`.** `src/react/components/DebugPanel/tabs/EmailsTab.tsx:43`, `CacheTab.tsx:41` — rapid clicks race; last-resolved wins; setState after unmount. Fix: `AbortController` ref, abort on new click and cleanup.
- **`RequestsSection.handleRowClick` no cancellation for detail fetch.** `src/react/components/Dashboard/sections/RequestsSection.tsx:50` — two quick row clicks race, wrong trace displayed. Fix: `AbortController` ref.
- **`DebugPanel.renderTabContent` allocates all tab JSX every render.** `src/react/components/DebugPanel/DebugPanel.tsx:107-143` — inline-spread `debugOptions` makes every lazy tab's props new each render. Fix: `useMemo` keyed on `activeTab` + stable config, or a switch.
- **`DashboardPage` `hashchange` listener re-registers on every section nav.** `src/react/components/Dashboard/DashboardPage.tsx:126` — narrow teardown/re-attach window can miss a fast hashchange. Fix: read `activeSection` from a ref.
- **`useFeatures` `fetchedRef` latch ignores post-mount config changes.** `src/react/hooks/useFeatures.ts:18` — feature flags stay stale on tenant switch. Fix: reset the ref in cleanup or remove the guard.

### Low / Nit

- **`LogsTab` uses array index as key.** `src/react/components/DebugPanel/tabs/LogsTab.tsx:98` — prepended logs shift expand/collapse state to the wrong row (`LogsSection` correctly uses `log.id`). Fix: stable key.
- **Tab nav lacks ARIA semantics.** `DebugPanel.tsx:182`, `DashboardPage.tsx:271` — no `role="tablist"`/`role="tab"`/`aria-selected`; invisible to screen readers as a tabbed UI.
- **Nit — `OverviewChart` SVG gradient IDs globally scoped.** `OverviewSection.tsx:177` — duplicate IDs collide if rendered twice. Fix: `useId()`.

---

## 5. Vue & Edge frontends (`src/vue`, `src/edge`)

**Assessment:** A disciplined port of the React implementation with consistent `onUnmounted`/`onBeforeUnmount` cleanup. Most actionable issues are the module-scope API client in `CacheSection.vue` and the missing `AbortController` in `RequestsSection.vue` (which `TimelineTab.vue` already solves correctly). Edge integration is clean.

### High

- **Module-level `DashboardApi`/`useApiClient` in `CacheSection.vue`.** `src/vue/components/Dashboard/sections/CacheSection.vue:29-30`
  Both execute at module-evaluation time, not inside `setup()`, so `inject()` results are captured from the first mount — stale config/credentials on hot-reload or across instances. React's `CacheSection.tsx` calls the hook in the component body each render.
  **Fix:** move both lines inside `onMounted` or a reactive callback.

- **`RequestsSection.vue` no cancellation of in-flight detail fetch.** `src/vue/components/Dashboard/sections/RequestsSection.vue:51-68`
  `handleRowClick` issues `getClient().fetch<TraceDetail>()` with no `AbortController`; two quick clicks race and the first can overwrite `traceDetail` after the second resolves. `TimelineTab.vue:87-110` does this correctly.
  **Fix:** add an `AbortController`, abort previous on each click and in `onUnmounted`.

### Medium

- **`useApiClient` can become a shared singleton when called outside `setup()`.** `src/vue/composables/useApiClient.ts:9` — root cause of the `CacheSection` issue. Fix: ensure all calls are inside `setup()`/`onMounted`; document in JSDoc.
- **`LogsSection.vue` mutates injected reactive `filterState` internals directly.** `src/vue/components/Dashboard/sections/LogsSection.vue:122-141` — deletes keys and sets `pagination.page` directly, bypassing `setFilter`/`goToPage` guards. Fix: use the composable API.
- **`OverviewSection.vue` — three concurrent pollers for `overview`.** `OverviewSection.vue:31-46` + `DashboardPage.vue:205` — two `useDashboardData` calls in the section plus one in the page for sidebar badges, all hitting `overview`. Fix: share via `provide/inject` from `DashboardPage`.
- **`InternalsTab.vue` falls back to `props.data` (stale prior-tab data).** `src/vue/components/DebugPanel/tabs/InternalsTab.vue:124` — briefly renders the previous tab's response before self-fetch resolves. Fix: drop the `props.data` fallback.

### Low / Nit

- **Index-keyed `v-for` on reorderable rows.** `OverviewSection.vue:559,617,644,868` — `recentErrors` carries `id`; others need composite keys. Fix: use stable keys.
- **`EmailsSection.vue` calls `emails.find()` 7× in template for the same id.** `EmailsSection.vue:71-106`. Fix: one `computed`.
- **`useDebugData.ts:89` misleading non-null assertion** on a possibly-null `dashboardController`. Fix: explicit check.
- **`CustomPaneTab.vue` `fetched` flag persists across `<KeepAlive>`.** `CustomPaneTab.vue:31` — with `fetchOnce`, data never refreshes after first load (symmetric with React). Worth documenting.
- **Nit — Edge triple-brace `{{{ JSON.stringify(dashConfig) }}}`.** `src/edge/views/dashboard.edge:11` (also `stats-bar.edge:6`, `debug-panel.edge:2`) — safe because V8's `JSON.stringify` escapes `<>&`, but relying on it is implicit. Add a clarifying comment.
- **Nit — `v-html` for static SVG constants.** `DashboardPage.vue:310` — static `TAB_ICONS`, not a vuln; will trip Vue lint/audit.

---

## 6. Build, packaging & tests

**Assessment:** Well-structured for a multi-frontend ESM library; all non-wildcard export paths resolve to real files. One High type-resolution defect in the `/core` bundle, a missing `engines` field, and several tests that leak global state or depend on a prior build.

### High

- **Broken type re-export chain in `dist/core/types.d.ts`.** `vite.config.core.ts:8`, `tsconfig.core.json:5`
  `vite-plugin-dts` emits `export type { … } from '../types.js'` / `'../debug/types.js'`, which resolve from `dist/core/` to `dist/types.d.ts` / `dist/debug/types.d.ts` — neither exists (the main compile puts them under `dist/src/`). Any TS consumer of `adonisjs-server-stats/core` importing the re-exported types gets `TS2307`.
  **Fix:** inline the declarations in `src/core/types.ts`, or enable `rollupTypes`/`copyDtsFiles` so vite-plugin-dts flattens the re-exports.

### Medium

- **`tests/pino_hook_test.ts` silently excluded.** `bin/test.ts:7`, `tests/pino_hook_test.ts:1` — Japa glob is `tests/**/*.spec.ts`; this file never runs and imports `pino` (not a dep). Fix: rename to `.diagnostic.ts`, move to `scripts/`, or delete.
- **`globalThis.fetch` mock restored in test body, not teardown.** `tests/react_tab_lifecycle.spec.ts:122+`, `stress_fetch_cancellation.spec.ts:128+`, `api_client.spec.ts:114+` — a throw before the restore line leaks the mock into later tests; `forceExit: true` masks it. Fix: restore in `teardown`/`finally`.
- **`package_exports.spec.ts` depends on a prior build; no `pretest`.** `tests/package_exports.spec.ts:37`, `package.json:122` — reads `dist/...`; fresh checkout throws `ENOENT`. Fix: add `"pretest": "npm run build"` or `skipIf(!existsSync)`.
- **`configure` hook unconditionally registers `log-stream/provider`.** `configure.ts:18` — added for every user regardless of `@adonisjs/transmit`. Fix: prompt before adding.

### Low / Nit

- **Missing `engines` field.** `package.json` — targets ES2022 + `node:fs/promises` + `import.meta.url` (Node 18+). Fix: `"engines": { "node": ">=18.0.0" }`.
- **Real-timer `sleep()` in timing-sensitive tests.** `dashboard_store_perf.spec.ts:41`, `coalesce_cache.spec.ts:14`, `stress_coalesce.spec.ts:41` — 5–60ms sleeps can flake on busy CI. Fix: inject a clock / make TTL configurable.
- **Untested high-risk surface.** `src/routes/*`, `provider/boot_helpers.ts`, `boot_initializer.ts`, `auth_middleware_detector.ts`, `data/data_access.ts` — route registration, boot sequence, and the SQLite data-access layer have no direct spec coverage. These overlap the C1/`_whenReady` concurrency path.
- **`scripts/compare-frontends.ts` uses Bun-only `import.meta.dir`.** `compare-frontends.ts:87` — silent `undefined` under Node/tsx; not in any npm script. Fix: use `fileURLToPath(import.meta.url)`.
- **Nit — `sideEffects: ["*.css", …]`.** `package.json:21` — esbuild/Rollup want `**/*.css`. Low real impact given CSS is consumed via subpath exports.

---

## Cross-cutting themes

1. **Monkey-patch / singleton lifecycle is not restart-safe.** `pino_hook`, `EventCollector`, `TraceCollector`, `PrometheusCollector`, and the route `_whenReady` singletons all misbehave on a second `start()`/registration (hot-reload, test suites). A shared "install once, restore on shutdown, guard double-install" pattern would fix a whole cluster of High/Medium findings at once.

2. **Post-mount reconfiguration is unhandled in both frontends.** React hooks and the Vue `CacheSection` capture config once and ignore later `baseUrl`/`authToken`/endpoint changes. Multi-tenant / token-refresh scenarios silently use stale clients.

3. **Ad-hoc `fetch` bypasses the controller's race protection.** The controller layer has solid AbortController/fetchId guards, but detail/preview fetches in `EmailsTab`, `CacheTab`, and both `RequestsSection`s were written outside it and reintroduce the exact races the controllers prevent.

4. **Sensitive data is captured broadly and protected narrowly.** Secrets, email bodies, SQL bindings, and full URLs are all captured, persisted, and served, while access control is opt-in and redaction is cosmetic. The tool's value depends on this data, so the fix is to secure the transport/storage (fail-closed auth, real redaction, sandboxing, storage hygiene) rather than stop capturing.

## Suggested sequencing

1. **Security must-fix before any non-dev exposure:** items 1–5 in the action table (plaintext secrets, iframe sandbox, fail-closed auth, preview-endpoint headers, storage hygiene).
2. **Correctness of the data the tool reports:** RequestMetrics indexing (7, 8), queue connection leak (6), FlushManager shutdown data loss, log-level type guard.
3. **Restart-safety cluster:** the monkey-patch/singleton pattern (9 and its siblings).
4. **Frontend reconfiguration + ad-hoc fetch races** (11 and Vue equivalents).
5. **Build/packaging:** `/core` `.d.ts` chain (10), `pretest`/`engines`, stale test file.
