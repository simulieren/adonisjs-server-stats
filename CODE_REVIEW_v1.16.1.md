# Code Review — adonisjs-server-stats v1.16.1

**Date:** 2026-08-20
**Version reviewed:** 1.16.1 (branch `main`, commit `ea86d15`)
**Scope:** Full repository — security surface, performance, runtime correctness/lifecycle, React/Vue/Edge frontends, packaging & tooling.
**Method:** Four independent review passes (security, performance, correctness, frontend) plus a packaging pass, each verifying findings against the current source with file:line evidence. The previous full review (`CODE_REVIEW.md`, v1.13.0, 2026-07-13) was used as a regression checklist. Redaction regexes were verified empirically in a Node harness, not just by reading. Where a number is an estimate rather than a measurement, it is labeled as such.

---

## Remediation (2026-08-20, branch `fix/code-review-1.16.1`)

Every finding in this review — including the tooling section — has been fixed on the
`fix/code-review-1.16.1` branch (18 commits, `4006577` through `99b1f7e`). Highlights, keyed to the
action list below:

- **1** camelCase normalization + plural-tolerant boundaries + expanded word list (`totp`, `mfa`, `passwd`, `pwd`, `cvv`, `cvc`, `pin`, `ssn`, `authorization`, `cookie`); one fix covers bindings, config, URLs, and logs.
- **2–3** `DashboardStore` and both Redis-bridge call sites obey `capture.emails`; `recordEmail` guards the bridge ingest path; channel configurable via `advanced.emailBridgeChannel`.
- **4** flag reset in `cleanupResources`; **5** `yieldToEventLoop` every 10 requests and between insert chunks; **6** AbortController ported to the Dashboard sections (React + Vue) and `/api/overview` shared through a React context matching the Vue fix (**14**); **7** required indexes documented in JSDoc + README.
- **8** bindings sanitized at capture time in `QueryCollector` (write path kept as idempotent defense in depth); **9** Edge tag keys on `registerAllRoutes`' actual result; **10** `advanced.cacheKeyPrefix` scopes list/read/delete and production fails closed without one; **11** CoalesceCache capped at 500 entries with expiry sweep; **12** array items routed through value-shape redaction; **13** URL query params redacted at the middleware choke point and log records redacted (untruncated) before persistence.
- **15** `(created_at, duration)` composite index; **16** COUNT scans capped at 10k rows + `?page=` clamped into range.
- **17** GitHub Actions CI (Node 20/22/24: typecheck, lint, tests, build) with `scripts/run-tests-split.mjs` running each spec file in its own process — the combined-run better-sqlite3 exit-134 teardown abort never triggers per-file; `package.json` gains `author`/`repository`/`homepage`/`bugs`.
- **18 (Lows)** token-link regex bypasses closed incl. opaque path segments; saved-filter size bounds; dead EXPLAIN path deleted; `types.ts` events claim corrected; Edge `<script>` JSON escapes `<`; TraceCollector patch-owner takeover; FlushManager stop() blocks late timers; per-instance/resettable warn-once state; `boot_initializer.ts` deleted.

Verified after the last commit: typecheck (tsc + React + Vue) clean · lint at the 29-warning
baseline · **1,557 tests passing across 75 files, zero failures** (split runner) · build clean.
24 new tests cover the fixes.

---

## Executive summary

**The v1.13.0 review has been almost entirely worked off.** Of its 47 tracked findings, 43 are verifiably fixed in the current tree — including every Critical (plaintext config secrets to the browser, unsandboxed email iframe), the fail-closed route registration, CSP/nosniff/XFO on email previews, CSRF guards on mutating endpoints, `perPage` clamping, all five performance bugs, all 18 frontend findings, and 13 of 14 lifecycle/restart bugs. That is an unusually good remediation rate.

What remains clusters in three places:

1. **The redaction machinery has a shared blind spot: camelCase.** The word-boundary regexes in `sensitive_patterns.ts` treat only `_`, `.`, `-` as separators, so `passwordHash`, `clientSecret`, `jwtSecret`, `apiSecret` are all invisible to both the SQL-binding redactor *and* the config inspector. AdonisJS config keys are camelCase by convention, so this is the normal case, not an edge case — and it fails silently while snake_case redaction visibly works. One boundary fix closes both holes.

2. **Production mode does not honor its own contract for email.** `capture.emails: false` (the default in production) gates the in-memory collector but not `DashboardStore`, which subscribes to the `mail:*` events unconditionally and persists full bodies to SQLite. Separately, the Redis email bridge publishes full mail bodies outside *every* production gate — including from queue workers with `production.enabled: false`. Queries, events, traces, and logs are all gated correctly; mail is the exception on both paths.

3. **One lifecycle fix regressed, and one fix pattern wasn't propagated.** The request-persistence pipe now permanently locks out after any in-process restart (the guard flag is never reset), and the AbortController fix for fetch races landed in the DebugPanel tabs but never reached the Dashboard section variants of the same features (both React and Vue).

Nothing here is remotely as severe as the v1.13.0 Criticals. The package's overall posture is now strong: fail-closed auth, zero runtime dependencies, sandboxed previews, well-cached read paths, batched-and-yielding retention. The items below are the gap between "hardened" and "done."

---

## Prioritized action list

| # | Severity | Area | Finding | Location |
|---|----------|------|---------|----------|
| 1 | High | Security | camelCase names invisible to all redaction (SQL bindings + config-to-browser) | `src/dashboard/sensitive_patterns.ts:14-15` |
| 2 | High | Security | `production.capture.emails: false` doesn't stop email capture — `DashboardStore` subscribes to `mail:*` unconditionally and persists full bodies | `src/dashboard/dashboard_store.ts:108,319-334` |
| 3 | High | Security | Redis email bridge publishes full mail bodies outside every production gate (incl. queue workers) | `src/provider/server_stats_provider.ts:167-170`, `src/provider/toolbar_setup.ts:61` |
| 4 | High | Correctness | `dashRequestPipeInstalled` never reset — dashboard persistence permanently dead after any in-process restart | `src/provider/dashboard_init.ts:168-178` |
| 5 | High | Performance | Flush path runs up to ~800 synchronous SQLite statements with zero event-loop yields (est. 25–160 ms stall per cycle under load; the migrator guards against this exact class) | `src/dashboard/flush_manager.ts:96-121`, `src/dashboard/write_queue.ts:274-342` |
| 6 | High | Frontend | Dashboard `EmailsSection`/`CacheSection` fetch races — AbortController fix exists in DebugPanel tabs, never ported (React + Vue) | `src/react/components/Dashboard/sections/EmailsSection.tsx:34-56`, `CacheSection.tsx:47-78`, Vue equivalents |
| 7 | High | Performance | `appCollector` runs 3 `COUNT(*)` queries on the host's primary DB every 3 s; required indexes undocumented | `src/collectors/app_collector.ts:80-96` |
| 8 | Medium | Security | Debug panel serves unredacted bindings — sanitization only on the SQLite write path, not the in-memory ring buffer | `src/debug/query_collector.ts:19`, `src/routes/debug_routes.ts:73` |
| 9 | Medium | Security | Edge `@serverStats()` tag registered even when fail-closed refused the routes; bar renders for anonymous visitors | `src/provider/server_stats_provider.ts:110-114`, `src/edge/plugin.ts:136-146` |
| 10 | Medium | Security | Cache inspector reads/deletes arbitrary Redis keys by default (`SERVER_STATS_CACHE_KEY_PREFIX` unset ⇒ unrestricted) | `src/dashboard/cache_handlers.ts:12-19` |
| 11 | Medium | Security | `CoalesceCache.resultCache` unbounded; keys embed user search input; `clearCache()` has zero callers | `src/dashboard/coalesce_cache.ts:11,48` |
| 12 | Medium | Security | Config-inspector skips value-shape redaction inside arrays (verified: Stripe key in an array survives) | `src/dashboard/integrations/config_inspector.ts:150-152` |
| 13 | Medium | Security | Log lines persisted verbatim (full pino record incl. bound context); URLs stored with full query strings (`?token=…`) | `src/dashboard/write_queue.ts:227,296`, `src/middleware/request_tracking_middleware.ts:121,127` |
| 14 | Medium | Performance | React dashboard double-polls `/api/overview` — the shared-poller fix landed in Vue only | `src/react/components/Dashboard/DashboardPage.tsx:178` + `OverviewSection.tsx:346` |
| 15 | Medium | Performance | Overview p95 = `ORDER BY duration OFFSET n` with no composite index — full sort of the range per cache miss (2 s TTL) | `src/dashboard/overview_query_runners.ts:59-69` |
| 16 | Medium | Performance | Search uses leading-wildcard `LIKE` on unindexable columns — two full scans (count + data) per query | `src/dashboard/filtered_queries.ts`, `src/dashboard/paginate_helper.ts:26-52` |
| 17 | Medium | Tooling | No CI at all — 1533 tests, typecheck, lint run only locally (blocked by the better-sqlite3 exit-134 teardown crash) | `.github/workflows` (absent) |
| 18 | Low | — | 12 further Low items (see sections) | — |

---

## Prior-review scorecard (v1.13.0 → v1.16.1)

| Area | Findings | Fixed | Partial | Still open / regressed |
|------|----------|-------|---------|------------------------|
| Security | 10 | 7 | 2 (secrets-at-rest: bindings now redacted but bypassable; cache CSRF fixed, scoping default-open) | 1 (URLs with query strings) |
| Core runtime / lifecycle | 14 | 13 | — | 1 regressed (`setOnRequestComplete` clobber → permanent lockout, item 4) |
| Performance | 5 | 5 | — | — |
| React frontend | 11 | 11 | — | — |
| Vue/Edge frontend | 7 | 7 | — | — |
| **Total** | **47** | **43** | **2** | **2** |

Notable confirmed fixes (spot checks, current line refs): fail-closed registration ignoring `unsafeAllowNoAuth` in production (`register_routes.ts:66-96`); real redaction with value dropped (`config_inspector.ts:33-37`); `sandbox=""` on all three email iframes; CSP/nosniff/XFO on both preview endpoints; `guardCsrf` via `Sec-Fetch-Site` on all four mutating routes; EXPLAIN on the read client with token rejection; BullMQ `Queue` created once and closed in `stop()`; idempotent emitter/console patches with symbol guards; pino unhook on shutdown; `/core` `.d.ts` chain resolves (`dist/core/core/index.d.ts`, all relative imports verified).

---

## 1. Security

### High

- **camelCase names are invisible to all redaction.** `src/dashboard/sensitive_patterns.ts:14-15` — boundaries are `(?:^|[_.\-])` … `(?:$|[_.\-])`; an uppercase transition is neither. Verified empirically: `userPassword`, `passwordHash`, `totpSecret`, `clientSecret`, `jwtSecret`, `sessionSecret`, `apiSecret`, `bearerToken`, `stripeSecretKey` all pass as PLAIN, while their snake_case twins redact. Consequences: (a) `sqlMentionsSecret` never fires on camelCase columns, so a pre-hash password or OTP bound to `passwordHash`/`verificationCode` is written to `server_stats_queries.bindings` in the clear; (b) `isSensitiveConfigName` gates `app.config.all()` served by `GET /api/config` — AdonisJS config is camelCase by convention, so plain-string secrets under camelCase keys reach the browser. (Mitigating: `appKey` itself is a `@poppinss/utils` `Secret` and serializes as `{}`.) Also missed: `totp` (needs leading separator), plurals (`tokens`, `secrets`), `passwd`/`pwd`/`cvv`/`pin`. **Fix:** add a lower→upper transition to the boundary alternation (or split camelCase before testing); extend the word list. One change closes both holes — this is exactly why the shared module exists.

- **`production.capture.emails: false` does not stop email capture or persistence.** `src/dashboard/dashboard_store.ts:108` calls `wireEventListeners()` unconditionally; it subscribes to `mail:sending/sent/queueing/queued` and persists each (`:319-334`). Zero references to `capture` in `dashboard_store.ts` or `flush_manager.ts` (verified by grep). This directly contradicts the documented contract (`src/types.ts:556-571`). An operator enabling production mode with `capture: { queries: true }` still gets every password-reset and invoice body written to `server_stats_emails` for `retentionDays` and served in the Emails pane. Queries/events/traces/logs are gated correctly — email is the only leak. **Fix:** early-return in `wireEventListeners` when `capture.emails` is off.

- **The Redis email bridge runs outside every production gate.** Verified in `src/provider/server_stats_provider.ts:167-170`: non-web processes (queue workers) call `setupNonWebBridgeHelper` before any `isEnabledHere` check — a production `ace queue:listen` worker publishes full mail payloads (from/to/cc/bcc/subject/html/text, `email_helpers.ts:100-116`) to the hardcoded channel `adonisjs-server-stats:emails` even with `production.enabled: false`. The web-side `setupBridgeInternal` (`toolbar_setup.ts:61`) is likewise not gated on `capture.emails`. On shared Redis, any tenant with `SUBSCRIBE` reads all outbound mail; conversely `ingestRemoteEmail` (`email_bridge.ts:75-98`) trusts anything on the channel, so Redis write access lets an attacker inject stored records. **Fix:** gate both call sites on `isEnabledHere && capture.emails`; make the channel configurable/namespaced.

### Medium

- **Debug panel serves unredacted bindings.** `sanitizeBindings` is called in exactly one place — the SQLite write path (`write_queue.ts:191`). `QueryCollector` stores raw bindings (`query_collector.ts:19`) and `GET /admin/api/debug/queries` always reads `source: 'memory'` (`debug_routes.ts:73`), so the debug panel shows plaintext the dashboard redacts. **Fix:** sanitize in `buildQueryRecord` so one code path covers both stores.
- **Edge tag registered when routes were refused.** The comment at `server_stats_provider.ts:110-114` says "only when the routes it polls actually exist," but the condition is `isEnabledHere(config)`, not the `registered` boolean from `registerAllRoutes` (verified). With production enabled but no guard — the config fail-closed rejects — `@serverStats()` still renders the bar for every anonymous visitor (`edge/plugin.ts:144`), advertising the endpoints and shipping the debug bundle. **Fix:** thread `registered` through.
- **Cache inspector is unscoped by default.** `SERVER_STATS_CACHE_KEY_PREFIX` unset (the default) ⇒ `isKeyAllowed` returns true for everything (`cache_handlers.ts:12-19`): any dashboard viewer can read session keys (session hijacking to a higher-privileged account), delete rate-limit counters, and glob-search all of Redis. Env-var-only, invisible in the config type. **Fix:** surface in `ServerStatsConfig`; consider a restrictive default.
- **`CoalesceCache` never evicts.** Plain `Map` (`coalesce_cache.ts:11`); `clearCache()` has zero callers (verified). Keys embed user input (`search`, filters, pagination), each entry a full result page — an authorized viewer can grow heap without bound. **Fix:** LRU cap or sweep-on-write.
- **Array elements skip value-shape redaction in the config inspector.** `config_inspector.ts:150-152` maps arrays through `sanitizeObject`, which passes strings through untouched — verified: a Stripe key inside `{ keys: ['sk_live_…'] }` survives while a sibling `password` string redacts. **Fix:** route array items through `sanitizeValue`.
- **Log lines persisted verbatim; URLs stored with query strings.** `write_queue.ts:227` stores the whole pino record; `request_tracking_middleware.ts:121,127` uses `ctx.request.url(true)` so `?token=…` reset links land in `server_stats_requests.url` in the clear (prior finding 9, unchanged). **Fix:** run log values through `looksLikeCredentialValue`; strip or redact query strings (keep them for display-safe params only).

### Low

- **Email token-link scrubbing bypasses** (`email_helpers.ts:9,16`): `\btoken=` can't match inside `reset_token=`/`resetToken=`/`id_token=` (`_` is a word char — verified empirically), and the docblock claims path-segment redaction that doesn't exist. Fix the prefix to `[\w-]*`; correct the doc.
- **`page` unbounded** (`dashboard_routes.ts:94` et al.): huge offsets force full scans on the single-connection pool, blocking all dashboard reads. Clamp.
- **Latent unguarded EXPLAIN dead code** (`explain_query.ts:26`, `format_helpers.ts:168`): the pre-fix path still exists beside the fixed one, reachable only via the route-less `DashboardStore.runExplain` (verified no callers). Delete it before someone wires it up.
- **Docs say events are "never persisted"** (`types.ts:568`) — they are, correctly gated, since 1.16.1 (`write_queue.ts:318-321`). Fix the doc.
- **`{{{ JSON.stringify(config) }}}` in `<script>`** (`dashboard.edge:11`, `stats-bar.edge:6`): no `</script>` escaping. Config-controlled, not attacker-controlled — hardening only.
- **Saved-filter inputs length-unvalidated** (`filter_handlers.ts:35-46`) — bounded in practice by bodyparser limits.

**Verified non-issues:** retention's interpolated `retentionDays` is coerced and guarded; `sort` params allow-listed; no `eval`/`new Function`/`child_process` in `src/`; no route-reachable path traversal; no stored XSS (all `v-html`/`dangerouslySetInnerHTML` hits render the static icon constants).

---

## 2. Performance

### High

- **The flush path never yields.** `runFlush` (`flush_manager.ts:96-121`) wraps `flushRequests` + `flushEmails` + `flushLogs` in one transaction; `flushRequests` loops per request (1 insert + up to 2 batch-inserts + 1 trace insert each), `batchInsert` chunks by 50 with no yield. better-sqlite3 is fully synchronous, so awaits resolve on the microtask queue without ever reaching the I/O phase — worst case at the `MAX_Q=200` backlog cap is ~450–800 sequential synchronous statements in one macrotask, an **estimated** 25–160 ms of total event-loop stall recurring every 500 ms under sustained load (not measured; worth benchmarking with a synthetic backlog before tuning). The codebase already knows about this failure class: `migrator_tables.ts:1-12` documents it and `migrator.ts` yields between every statement and every retention batch. **Fix:** reuse the exported `yieldToEventLoop()` every N rows in `flushRequests`/`batchInsert` (verified: currently only the migrator imports it).
- **`appCollector` hits the host's primary DB every 3 s.** Three `COUNT(*)` queries (sessions, pending webhook_events, pending scheduled_emails) per tick (`app_collector.ts:80-96`). Opt-in, but once enabled it's a permanent recurring load, and the package neither creates nor documents the indexes those filters need — without them each tick is a full table scan forever. **Fix:** document required indexes prominently; consider a slower cadence independent of the metrics interval.

### Medium

- **React double-polls `/api/overview` — the Vue fix never crossed over.** Vue shares one poller via `provide('ss-overview-data')` (`DashboardPage.vue:216`, with a comment citing the original bug); React still creates two independent 5 s controllers (`DashboardPage.tsx:178` for sidebar badges + `OverviewSection.tsx:346`). The 2 s server cache absorbs some, but unphased timers land outside each other's window. **Fix:** port the shared-poller pattern (context or a small controller registry).
- **Overview p95 sorts the whole range.** `ORDER BY duration ASC OFFSET n LIMIT 1` filtered by `created_at` (`overview_query_runners.ts:59-69`) with separate single-column indexes only — SQLite sorts the full filtered set per 2 s cache miss; at `7d` range on a busy app that's a large sort with the dashboard open. **Fix:** composite `(created_at, duration)` index or a maintained histogram. (The chart aggregator's identical pattern is fine — 60 s window, once a minute.)
- **Search is two full scans per query.** Leading-wildcard `LIKE` across url/sql_text/subject/message etc. (`filtered_queries.ts`), run twice (count + data) inside `executePaginate`. User-triggered and 1 s-cached, but on multi-day retention tables each search is two full scans. **Fix:** FTS5 for the text columns, or prefix-match where acceptable.

### Low

- Redaction regex cost lands on the flush path (once per query per flush, no ReDoS-shaped patterns — verified), compounding the no-yield issue but not independently severe. `EventCollector.summarizeData` stringifies every app event synchronously but is depth/size-capped. Redis/BullMQ collectors do 2-3 round-trips per 3 s tick — fine.

**Verified non-issues:** with capture off, the per-request hot path is O(1) sub-microsecond work with **no** AsyncLocalStorage wrap (`request_tracking_middleware.ts:152-188`); retention batches and yields correctly; `CoalesceCache` gives in-flight dedup + short TTLs across the read path (good design — its unbounded map is the only flaw, filed under security); knex pool `min:1,max:1` is correct for the single-writer SQLite.

---

## 3. Runtime correctness & lifecycle

### High

- **`dashRequestPipeInstalled` permanently disables dashboard persistence after any in-process restart.** Module-level flag set at `dashboard_init.ts:178`, reset nowhere (verified by grep); `cleanupResources` (`shutdown_helpers.ts:102`) nulls the callback via `setOnRequestComplete(null)`. Sequence: boot → ready → shutdown → boot again in the same process (test harness re-bootstrapping, programmatic restart) ⇒ the second init sees the flag, warns once, returns — and the callback slot stays `null` for the life of the process. Requests, queries, events, and traces silently stop reaching SQLite while the in-memory panel keeps working. This is a regression from the v1.13.0 fix: the old bug double-installed; the new one permanently uninstalls. Practical blast radius is in-process re-boots (dev-server reloads and production restarts spawn fresh processes), which is why it isn't ranked Critical. **Fix:** reset the flag in `cleanupResources`, mirroring `resetServerStatsCollector()`.

### Medium

- **Stale `console.warn` owner if `stop()` is ever skipped.** `consoleWarnPatch.active` is a boolean, so a new `TraceCollector` defers to a dead instance's wrapper bound to the *old* AsyncLocalStorage — warnings silently stop attaching to traces (`trace_collector.ts:207-238`). Doesn't trigger on the normal lifecycle (verified `DebugStore.stop()` is reliably called). **Fix:** track the owning instance, not a boolean, so a newcomer can take over.

### Low

- **Stray flush timer can outlive `stop()`** — `runFlush`'s reschedule (`flush_manager.ts:119-120`) can fire after `stop()` cleared the timer it knew about; harmless today (queues already drained) but untracked. 
- **Warn-once state at module level:** `redis_collector.ts:6-8` (siblings use per-instance closures) and `write_queue.ts:19-27` (`warnedWritePaths` never reset across restarts) — diagnostics-only, same class as bugs already fixed elsewhere.
- **`boot_initializer.ts` is dead code** — verbatim copy of `boot_helpers.ts` helpers, no importers (verified), already drifting (missing the `domain` param). Delete.

**Verified non-issues:** async guard properly awaited and fail-closed; Edge thenable-guard fails closed with warn-once; ring-buffer cursors correct across wraparound; retention batching correct; `DashboardStore.stop()` awaits flush, clears timers, destroys the connection.

---

## 4. Frontend (React / Vue / Edge)

All 18 prior findings fixed, including full React/Vue parity on iframe sandboxing, AbortController in the DebugPanel tabs, ARIA tab semantics, stable list keys, and per-instance API clients. No XSS surface found (every raw-HTML sink renders static icons; Edge bootstrap only `JSON.parse`s a script tag).

### High

- **The AbortController fix stopped at the DebugPanel.** The Dashboard section variants of the same two features have zero cancellation (verified: no `abort` hits in either React file):
  - Email preview: `react/.../sections/EmailsSection.tsx:34-56` and `vue/.../sections/EmailsSection.vue:51-60` — click row A then row B quickly; if A resolves last, B's selection shows A's body.
  - Cache key detail: `react/.../sections/CacheSection.tsx:47-78` and `vue/.../sections/CacheSection.vue:74-97` — same wrong-value race.
  **Fix:** mirror the `previewAbortRef`/`keyAbortRef` pattern from `DebugPanel/tabs/EmailsTab.tsx` / `CacheTab.tsx` (thread a `signal` through `fetchCacheKey` if needed). Also worth a one-time sweep of any other tab-vs-section feature pairs for the same porting gap — this and the overview-poller item (perf §) are both "fixed in one framework/variant, not the other."

**Verified non-issues:** `transmit-adapter.ts` guards callbacks with a `disposed` flag; both `useResizableTable` implementations clean up observers correctly; pollers stop on unmount.

---

## 5. Packaging, CI & tooling

- **No CI.** `.github/workflows` doesn't exist — 1533 tests, three typecheck configs, and lint run only on the maintainer's machine, and `prepublishOnly` is the only automated gate. Blocking prerequisite: the suite currently exits 134 on a better-sqlite3 GC/teardown assert under Node 24 that also eats japa's summary line, so a naive CI job would be red or, worse, unreadable. Options: run spec files individually and aggregate (the method used to verify recent releases), pin CI to Node 22, or chase the teardown crash (likely `db.close()` ordering vs. GC finalizers).
- **`package.json` has no `repository`, `bugs`, `homepage`, or `author`.** The npm page can't link back to GitHub and provenance can't be established. Two-minute fix.
- **Positive: zero runtime dependencies.** Everything is peer/dev — excellent supply-chain posture for a package that runs inside other people's production apps, and worth advertising in the README.
- The `/core` export's type chain — broken in v1.13.0 — now resolves: `dist/core/core/index.d.ts` exists and every relative import in it resolves (verified file-by-file).

---

## Suggested sequencing

1. **One-file fix with the widest blast radius:** camelCase boundaries + word-list additions in `sensitive_patterns.ts` (closes findings 1a/1b; existing tests in `tests/binding_redaction.spec.ts` make regression coverage cheap).
2. **Make production mode honest about mail:** gate `wireEventListeners` and both bridge call sites on `capture.emails` (findings 2–3). These are contract violations, not just hardening.
3. **Two small lifecycle/porting fixes:** reset `dashRequestPipeInstalled` in `cleanupResources`; port AbortController to the two Dashboard sections in both frameworks.
4. **Write-path yields** (`yieldToEventLoop` in `flushRequests`/`batchInsert`) — benchmark first to confirm the estimate, then it's a mechanical change.
5. **CI + package metadata** — independent of everything above and compounds the value of the 1533-test suite.
6. The remaining Mediums (in-memory binding sanitization, Edge tag gating, cache prefix default, CoalesceCache bound, config arrays, log/URL redaction, React overview poller, p95 index) are each small and independent; good candidates for a 1.17.0 hardening release.
