# Dashboard & Debug Panel: Shared Component Refactoring Spec

## Overview

The Dashboard (`src/react/components/Dashboard/`) and Debug Panel (`src/react/components/DebugPanel/`) share significant duplicate code. This spec documents all overlapping patterns and proposes refactorings to eliminate duplication.

---

## Current State

### Already Shared (`src/react/components/shared/`)

| Component | Dashboard Consumer | DebugPanel Consumer |
|---|---|---|
| `ConfigContent` | `ConfigSection` | `ConfigTab` |
| `InternalsContent` | `InternalsSection` | `InternalsTab` |
| `JsonViewer` | `EventsSection`, `CacheSection`, `LogsSection`, `JobsSection` | `EventsTab`, `CacheTab`, `LogsTab`, `JobsTab` |
| `RelatedLogs` | `RequestsSection` | `TimelineTab` |
| `ThemeToggle` | `DashboardPage` | `DebugPanel` |
| `Badge` / `MethodBadge` / `StatusBadge` | `RequestsSection`, `RoutesSection`, `JobsSection` | **Not used** (inlined instead) |
| `Tooltip` | **Not used** | **Not used** |

### Already Shared Hooks (`src/react/hooks/`)

| Hook | Dashboard | DebugPanel | StatsBar |
|---|---|---|---|
| `useApiClient` | `RequestsSection`, `InternalsSection` | `TimelineTab`, `InternalsTab` | - |
| `useFeatures` | `DashboardPage` | `DebugPanel` | `StatsBar` |
| `useResizableTable` | `DataTable` (used by 7 sections) | 8 tabs directly | - |
| `useTheme` | `DashboardPage` | `DebugPanel` | `StatsBar` |

### Dashboard-Only Hooks

| Hook | Consumers |
|---|---|
| `useDashboardData` | `DashboardPage` + all 10 section components |
| `useDashboardApiBase` | - (DebugPanel only: `CacheTab`, `JobsTab`, `ConfigTab`) |

### DebugPanel-Only Hooks

| Hook | Consumers |
|---|---|
| `useDebugData` | All 10 tab components |
| `useDashboardApiBase` | `CacheTab`, `JobsTab`, `ConfigTab` |

### Dashboard-Only Shared Components (`Dashboard/shared/`)

| Component | Used By | Notes |
|---|---|---|
| `DataTable` | 7 sections | DebugPanel builds tables inline with `useResizableTable` |
| `FilterBar` | All 11 sections | DebugPanel copy-pastes equivalent HTML |
| `Pagination` | 6 sections | DebugPanel caps at 200 entries, no pagination |
| `TimeRangeSelector` | `OverviewSection` only | - |
| `WaterfallChart` | `RequestsSection` only | DebugPanel renders waterfall as CSS bars inline |

---

## Duplicates to Refactor

### 1. Search/Filter Bar (HIGH PRIORITY)

**Problem**: The Dashboard has a shared `FilterBar` component. The DebugPanel re-implements the same search bar structure inline in 7 tabs (`QueriesTab`, `EventsTab`, `EmailsTab`, `RoutesTab`, `TimelineTab`, `LogsTab`, `CacheTab`).

**Dashboard** (`Dashboard/shared/FilterBar.tsx`):
```tsx
<FilterBar
  summary={`${items.length} items`}
  search={search}
  onSearchChange={setSearch}
  placeholder="Filter..."
>
  {/* additional controls */}
</FilterBar>
```

**DebugPanel** (duplicated in every tab):
```tsx
<div className="ss-dbg-search-bar">
  <input
    type="text"
    className="ss-dbg-search"
    placeholder="Filter queries..."
    value={search}
    onChange={(e) => setSearch(e.target.value)}
  />
  <span className="ss-dbg-summary">{queries.length} queries ...</span>
</div>
```

**Fix**: Add `classPrefix` prop to `FilterBar` (or move it to `shared/`), then replace inline search bars in all 7 DebugPanel tabs.

**Files to change**: `FilterBar.tsx` + `QueriesTab.tsx`, `EventsTab.tsx`, `EmailsTab.tsx`, `RoutesTab.tsx`, `TimelineTab.tsx`, `LogsTab.tsx`, `CacheTab.tsx`

---

### 2. SplitPaneWrapper (HIGH PRIORITY)

**Problem**: `RequestsSection.tsx` and `TimelineTab.tsx` each define identical private `SplitPaneWrapper` components. Only difference: default `classPrefix` value.

**Both files**:
```tsx
function SplitPaneWrapper({
  children, classPrefix = 'ss-dash', storageKey,
}: { children: [React.ReactNode, React.ReactNode]; classPrefix?: string; storageKey?: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLDivElement>(null)
  const topRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (containerRef.current && handleRef.current && topRef.current && bottomRef.current) {
      return initSplitPane({
        container: containerRef.current, handle: handleRef.current,
        topPane: topRef.current, bottomPane: bottomRef.current, storageKey,
      })
    }
  }, [storageKey])
  // ... identical JSX
}
```

**Fix**: Move to `src/react/components/shared/SplitPaneWrapper.tsx`. Both call sites already pass `classPrefix` explicitly.

**Files to change**: Create `shared/SplitPaneWrapper.tsx`, update `RequestsSection.tsx`, `TimelineTab.tsx`

---

### 3. Log Entry Row Rendering (HIGH PRIORITY)

**Problem**: `LogsSection.tsx` (Dashboard) and `LogsTab.tsx` (DebugPanel) both render log entries with near-identical structure. `RelatedLogs.tsx` in `shared/` already implements the same pattern with `classPrefix` support, but neither uses it.

**Dashboard (`LogsSection.tsx`)**:
```tsx
<div className={`ss-dash-log-entry${structured ? ' ss-dash-log-entry-expandable' : ''}`}>
  <span className={`ss-dash-log-level ${getLogLevelCssClass(level, 'ss-dash-log-level')}`}>
    {level.toUpperCase()}
  </span>
  <span className="ss-dash-log-time" title={formatTime(ts)}>{timeAgo(ts)}</span>
  {reqId ? (
    <span className="ss-dash-log-reqid" onClick={handleReqIdClick}>{reqId.slice(0, 8)}</span>
  ) : <span className="ss-dash-log-reqid-empty">--</span>}
  <span className="ss-dash-log-msg">{message}</span>
</div>
```

**DebugPanel (`LogsTab.tsx`)** — identical with `ss-dbg-` prefixes.

**Fix**: Extract a `LogEntryRow` component (or extend `RelatedLogs`) with:
- `classPrefix` prop for CSS namespace
- Optional `onReqIdClick` callback (the one behavioral difference)

**Files to change**: Create `shared/LogEntryRow.tsx` (or update `RelatedLogs.tsx`), update `LogsSection.tsx`, `LogsTab.tsx`

---

### 4. Diagnostics Polling Logic (HIGH PRIORITY)

**Problem**: `InternalsSection.tsx` and `InternalsTab.tsx` are byte-for-byte identical — same state variables, same `useRef` timer, same `fetchData` callback with `UnauthorizedError` guard, same polling `setInterval`. Only differences: refresh interval constant and `classPrefix`.

**Both files**:
```tsx
const [data, setData] = useState<DiagnosticsResponse | null>(null)
const [isLoading, setIsLoading] = useState(true)
const [error, setError] = useState<Error | null>(null)
const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
const getClient = useApiClient(baseUrl, authToken)

const fetchData = useCallback(async () => {
  try {
    const client = getClient()
    const result = await client.get<DiagnosticsResponse>(`${debugEndpoint}/diagnostics`)
    setData(result); setError(null); setIsLoading(false)
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      setError(err); setIsLoading(false); clearInterval(timerRef.current!); return
    }
    setError(err instanceof Error ? err : new Error(String(err))); setIsLoading(false)
  }
}, [debugEndpoint, getClient])

useEffect(() => {
  setIsLoading(true); setError(null); fetchData()
  timerRef.current = setInterval(fetchData, REFRESH_INTERVAL)
  return () => { clearInterval(timerRef.current!); timerRef.current = null }
}, [fetchData])
```

**Fix**: Extract `useDiagnosticsData(endpoint, baseUrl, authToken, intervalMs)` hook to `src/react/hooks/`. Both components become trivial wrappers:

```tsx
// InternalsSection.tsx
export function InternalsSection({ options, debugEndpoint }) {
  const { data, isLoading, error } = useDiagnosticsData(debugEndpoint, baseUrl, authToken, SECTION_REFRESH_MS)
  if (isLoading) return <LoadingSpinner />
  if (error) return <ErrorMessage error={error} />
  return <InternalsContent data={data} classPrefix="ss-dash" />
}
```

**Files to change**: Create `hooks/useDiagnosticsData.ts`, simplify `InternalsSection.tsx`, `InternalsTab.tsx`

---

### 5. Job Stats Bar (MEDIUM PRIORITY)

**Problem**: `JobsSection.tsx` and `JobsTab.tsx` both render identical stats rows (Active / Waiting / Delayed / Completed / Failed counters) with only CSS prefix differences.

**Dashboard (`JobsSection.tsx`)**:
```tsx
<div className="ss-dash-job-stats">
  <div className="ss-dash-job-stat">
    <span className="ss-dash-job-stat-label">Active:</span>
    <span className="ss-dash-job-stat-value">{stats.active ?? 0}</span>
  </div>
  <div className="ss-dash-job-stat">
    <span className="ss-dash-job-stat-label">Failed:</span>
    <span className="ss-dash-job-stat-value" style={{ color: 'var(--ss-red-fg)' }}>
      {stats.failed ?? 0}
    </span>
  </div>
  ...
</div>
```

**DebugPanel (`JobsTab.tsx`)** — identical with `ss-dbg-` prefixes.

**Fix**: Extract `shared/JobStatsBar.tsx` with `classPrefix` prop.

**Files to change**: Create `shared/JobStatsBar.tsx`, update `JobsSection.tsx`, `JobsTab.tsx`

---

### 6. Cache Stats Bar (MEDIUM PRIORITY)

**Problem**: `CacheSection.tsx` and `CacheTab.tsx` both render identical stats (Hit Rate / Hits / Misses / Keys).

**Dashboard (`CacheSection.tsx`)**:
```tsx
<div className="ss-dash-cache-stats">
  <div className="ss-dash-cache-stat">
    <span className="ss-dash-cache-stat-label">Hit Rate:</span>
    <span className="ss-dash-cache-stat-value">{(stats.hitRate ?? 0).toFixed(1)}%</span>
  </div>
  ...
</div>
```

**DebugPanel (`CacheTab.tsx`)** — identical with `ss-dbg-` prefixes.

**Fix**: Extract `shared/CacheStatsBar.tsx` with `classPrefix` prop.

**Files to change**: Create `shared/CacheStatsBar.tsx`, update `CacheSection.tsx`, `CacheTab.tsx`

---

### 7. Duration Severity CSS Class String (MEDIUM PRIORITY)

**Problem**: The same ternary chain for computing duration severity CSS classes is repeated in 4+ files:

```tsx
// Repeated in QueriesSection, QueriesTab, RequestsSection, TimelineTab
className={`${prefix}-duration ${
  durationSeverity(dur) === 'very-slow' ? `${prefix}-very-slow` :
  durationSeverity(dur) === 'slow' ? `${prefix}-slow` : ''
}`}
```

**Fix**: Add helper to `core/formatters.ts`:

```ts
export function durationClassName(ms: number, prefix: string): string {
  const sev = durationSeverity(ms)
  return `${prefix}-duration${sev === 'very-slow' ? ` ${prefix}-very-slow` : sev === 'slow' ? ` ${prefix}-slow` : ''}`
}
```

**Files to change**: `core/formatters.ts`, `QueriesSection.tsx`, `QueriesTab.tsx`, `RequestsSection.tsx`, `TimelineTab.tsx`

---

### 8. Badge Usage in DebugPanel (MEDIUM PRIORITY)

**Problem**: DebugPanel tabs inline method/status badge rendering instead of using the shared `Badge.tsx` components that already support `classPrefix`.

**DebugPanel (`RoutesTab.tsx`, `TimelineTab.tsx`)** — inline:
```tsx
<span className={`ss-dbg-method ss-dbg-method-${method.toLowerCase()}`}>{method}</span>
```

**Dashboard** — uses shared component:
```tsx
<MethodBadge method={method} classPrefix="ss-dash" />
```

**`TimelineTab.tsx`** also has a local `statusClass()` function duplicating `StatusBadge` logic:
```tsx
const statusClass = (code: number) => {
  if (code >= 500) return 'ss-dbg-status-5xx'
  if (code >= 400) return 'ss-dbg-status-4xx'
  if (code >= 300) return 'ss-dbg-status-3xx'
  return 'ss-dbg-status-2xx'
}
```

**Fix**: Import `MethodBadge` and `StatusBadge` with `classPrefix="ss-dbg"` in DebugPanel tabs.

**Files to change**: `RoutesTab.tsx`, `TimelineTab.tsx`, `EmailsTab.tsx`

---

### 9. Email Preview Overlay (MEDIUM PRIORITY)

**Problem**: `EmailsSection.tsx` and `EmailsTab.tsx` both implement near-identical email preview overlays with sandboxed iframes, subject/from/to headers, and close buttons.

**Dashboard (`EmailsSection.tsx`)**:
```tsx
<div className="ss-dash-email-preview">
  <div className="ss-dash-email-preview-header">
    <div className="ss-dash-email-preview-meta">
      <strong>Subject:</strong> {email.subject} | <strong>From:</strong> {email.from}
    </div>
    <button className="ss-dash-btn" onClick={closePreview}>Close</button>
  </div>
  <iframe className="ss-dash-email-iframe" srcDoc={previewHtml} sandbox="" />
</div>
```

**DebugPanel (`EmailsTab.tsx`)** — identical with `ss-dbg-` prefixes.

**Fix**: Extract `shared/EmailPreviewOverlay.tsx` with `classPrefix` prop.

**Files to change**: Create `shared/EmailPreviewOverlay.tsx`, update `EmailsSection.tsx`, `EmailsTab.tsx`

---

### 10. TimeAgo + Tooltip Span (LOW PRIORITY)

**Problem**: The `timeAgo(ts)` display with `title={formatTime(ts)}` tooltip pattern is repeated in 8+ files:

```tsx
// Dashboard
<span className="ss-dash-event-time" title={formatTime(ts)}>{timeAgo(ts)}</span>

// DebugPanel
<td className="ss-dbg-event-time" title={formatTime(ts)}>{timeAgo(ts)}</td>
```

**Fix** (optional): Extract a tiny `TimeAgoCell` component:

```tsx
export function TimeAgoCell({ ts, classPrefix, as = 'span' }: {
  ts: string | number; classPrefix: string; as?: 'span' | 'td'
}) {
  const Tag = as
  return <Tag className={`${classPrefix}-event-time`} title={formatTime(ts)}>{timeAgo(ts)}</Tag>
}
```

**Files to change**: `shared/TimeAgoCell.tsx` + any section/tab files that want to adopt it

---

### 11. snake_case / camelCase Field Fallbacks (LOW PRIORITY)

**Problem**: Dashboard sections repeatedly guard against both `snake_case` (raw DB) and `camelCase` (AdonisJS serializer) field names:

```tsx
// RequestsSection.tsx (3 occurrences):
const dur = (row.total_duration || row.totalDuration || row.duration || 0) as number
const ts = (row.createdAt || row.created_at || row.timestamp || '') as string
const code = row.status_code || row.statusCode

// EventsSection.tsx:
const ts = (row.createdAt || row.created_at || row.timestamp) as string
const name = (row.event_name || row.eventName || row.event || '') as string

// EmailsSection.tsx:
const from = (row.from_addr || row.from || '') as string
```

**Fix**: Add normalizer helpers to `core/dashboard-data-helpers.ts`:

```ts
export const resolveField = {
  timestamp: (row: Record<string, unknown>) =>
    (row.createdAt || row.created_at || row.timestamp || '') as string,
  duration: (row: Record<string, unknown>) =>
    (row.total_duration || row.totalDuration || row.duration || 0) as number,
  statusCode: (row: Record<string, unknown>) =>
    (row.status_code || row.statusCode) as number,
}
```

**Files to change**: `core/dashboard-data-helpers.ts`, `RequestsSection.tsx`, `EventsSection.tsx`, `EmailsSection.tsx`

---

### 12. Tab Navigation Structure (LOW PRIORITY)

**Problem**: `DashboardPage.tsx` and `DebugPanel.tsx` both implement similar tab/nav logic:
- `builtInSections` / `builtInTabs` array with `{ id, label, visible }` shape
- Filter to `visibleSections` / `visibleTabs` based on `features`
- Append `customPanes` after built-ins
- Active state tracking
- `TAB_ICONS` SVG rendering per item
- Map-based content dispatch

**Fix** (optional): Extract `useVisibleTabs(builtIns, features, customPanes)` hook. Layout differences (sidebar vs horizontal tabs) mean the rendering stays separate.

**Files to change**: Create `hooks/useVisibleTabs.ts`, update `DashboardPage.tsx`, `DebugPanel.tsx`

---

## New Shared Components to Create

| File | Purpose | Consumers |
|---|---|---|
| `shared/SplitPaneWrapper.tsx` | Resizable split pane React wrapper | `RequestsSection`, `TimelineTab` |
| `shared/LogEntryRow.tsx` | Single log entry row with expand | `LogsSection`, `LogsTab`, `RelatedLogs` |
| `shared/JobStatsBar.tsx` | Job queue counter stats bar | `JobsSection`, `JobsTab` |
| `shared/CacheStatsBar.tsx` | Cache hit rate stats bar | `CacheSection`, `CacheTab` |
| `shared/EmailPreviewOverlay.tsx` | Email iframe preview with header | `EmailsSection`, `EmailsTab` |
| `shared/TimeAgoCell.tsx` (optional) | TimeAgo with tooltip | 8+ files |

## New Hooks to Create

| File | Purpose | Consumers |
|---|---|---|
| `hooks/useDiagnosticsData.ts` | Poll diagnostics endpoint with error handling | `InternalsSection`, `InternalsTab` |
| `hooks/useVisibleTabs.ts` (optional) | Compute visible tabs from features + custom panes | `DashboardPage`, `DebugPanel` |

## Existing Components to Update

| File | Change |
|---|---|
| `Dashboard/shared/FilterBar.tsx` | Add `classPrefix` prop, move to `shared/` or keep and import from DebugPanel |
| `core/formatters.ts` | Add `durationClassName(ms, prefix)` helper |
| `core/dashboard-data-helpers.ts` | Add `resolveField` normalizers |

---

## Refactoring Priority

### Phase 1 — High Priority (exact copy-paste, easy wins)

1. `SplitPaneWrapper` -> `shared/` (trivial move)
2. `FilterBar` -> add `classPrefix`, use in DebugPanel tabs
3. `useDiagnosticsData` hook extraction
4. `LogEntryRow` extraction

### Phase 2 — Medium Priority (near-identical patterns)

5. `JobStatsBar` extraction
6. `CacheStatsBar` extraction
7. `durationClassName()` helper
8. Use `Badge`/`MethodBadge`/`StatusBadge` in DebugPanel
9. `EmailPreviewOverlay` extraction

### Phase 3 — Low Priority (minor cleanup)

10. `TimeAgoCell` component (optional)
11. `resolveField` normalizers
12. `useVisibleTabs` hook (optional)

---

## Design Principles

All shared components follow the `classPrefix` pattern established by existing shared components:

```tsx
interface Props {
  classPrefix?: 'ss-dash' | 'ss-dbg'
}
```

This allows the same component to render correct CSS class names for either the Dashboard (`ss-dash-*`) or Debug Panel (`ss-dbg-*`) context without any style coupling between the two UIs.

---

## Unused Component

`shared/Tooltip.tsx` is not imported by any component in the codebase. It should either be adopted where hover tooltips are needed or removed to reduce dead code.
