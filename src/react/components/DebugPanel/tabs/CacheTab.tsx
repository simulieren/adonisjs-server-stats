import React, {
  useState,
  useMemo,
  useCallback,
} from "react";

import { formatTtl, formatCacheSize } from "../../../../core/formatters.js";
import { useDebugData } from "../../../hooks/useDebugData.js";
import { useDashboardApiBase } from "../../../hooks/useDashboardApiBase.js";
import { useResizableTable } from "../../../hooks/useResizableTable.js";
import { JsonViewer } from "../../shared/JsonViewer.js";

import type {
  CacheStats,
  CacheEntry,
  DebugPanelProps,
} from "../../../../core/types.js";

interface CacheTabProps {
  options?: DebugPanelProps;
  dashboardPath?: string;
}

export function CacheTab({ options, dashboardPath }: CacheTabProps) {
  const { dashApiBase, resolvedOptions } = useDashboardApiBase(
    dashboardPath,
    options,
  );
  const { data, isLoading, error } = useDebugData<CacheStats>(
    "cache",
    resolvedOptions,
  );
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [keyValue, setKeyValue] = useState<unknown>(null);

  const keys = useMemo(() => {
    const items = data?.keys || [];
    if (!search) return items;
    const lower = search.toLowerCase();
    return items.filter((k: CacheEntry) => k.key.toLowerCase().includes(lower));
  }, [data, search]);

  const handleKeyClick = useCallback(
    async (key: string) => {
      if (selectedKey === key) {
        setSelectedKey(null);
        setKeyValue(null);
        return;
      }
      setSelectedKey(key);
      // Fetch key value via API
      try {
        const { baseUrl = "", authToken } = options || {};
        const apiBase =
          dashApiBase || options?.debugEndpoint || "/admin/api/debug";
        const url = `${baseUrl}${apiBase}/cache/${encodeURIComponent(key)}`;
        const headers: Record<string, string> = { Accept: "application/json" };
        if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
        const resp = await fetch(url, {
          headers,
          credentials: authToken ? "omit" : "same-origin",
        });
        const result = await resp.json();
        setKeyValue(result);
      } catch {
        setKeyValue({ error: "Failed to fetch key value" });
      }
    },
    [selectedKey, options, dashApiBase],
  );

  const tableRef = useResizableTable([keys]);

  if (isLoading && !data) {
    return <div className="ss-dbg-empty">Loading cache data...</div>;
  }

  if (error) {
    return <div className="ss-dbg-empty">Error: {error.message}</div>;
  }

  if (!data) {
    return <div className="ss-dbg-empty">Cache inspector not available</div>;
  }

  // Dashboard API wraps stats in a nested `stats` object; handle both shapes.
  const stats = (data as unknown as Record<string, unknown>).stats as
    | CacheStats
    | undefined;
  const resolved = stats || data;

  return (
    <div>
      {/* Stats row */}
      <div className="ss-dbg-cache-stats">
        <div className="ss-dbg-cache-stat">
          <span className="ss-dbg-cache-stat-label">Hit Rate:</span>
          <span className="ss-dbg-cache-stat-value">
            {resolved.hitRate !== null && resolved.hitRate !== undefined ? resolved.hitRate.toFixed(1) : "0"}%
          </span>
        </div>
        <div className="ss-dbg-cache-stat">
          <span className="ss-dbg-cache-stat-label">Hits:</span>
          <span className="ss-dbg-cache-stat-value">
            {resolved.totalHits ?? 0}
          </span>
        </div>
        <div className="ss-dbg-cache-stat">
          <span className="ss-dbg-cache-stat-label">Misses:</span>
          <span className="ss-dbg-cache-stat-value">
            {resolved.totalMisses ?? 0}
          </span>
        </div>
        <div className="ss-dbg-cache-stat">
          <span className="ss-dbg-cache-stat-label">Keys:</span>
          <span className="ss-dbg-cache-stat-value">
            {(resolved as CacheStats & { keyCount?: number }).keyCount ?? "-"}
          </span>
        </div>
      </div>

      {/* Search */}
      <div className="ss-dbg-search-bar">
        <input
          type="text"
          className="ss-dbg-search"
          placeholder="Filter keys..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="ss-dbg-summary">{keys.length} keys</span>
      </div>

      {/* Key detail overlay */}
      {selectedKey && !!keyValue && (
        <div className="ss-dbg-cache-detail">
          <strong>{selectedKey}</strong>
          <button
            type="button"
            className="ss-dbg-btn-clear"
            onClick={() => setSelectedKey(null)}
          >
            {"\u2190"} Back
          </button>
          <JsonViewer data={keyValue} classPrefix="ss-dbg" />
        </div>
      )}

      {/* Keys table */}
      {keys.length === 0 ? (
        <div className="ss-dbg-empty">No cache keys found</div>
      ) : (
        <table ref={tableRef} className="ss-dbg-table">
          <colgroup>
            <col />
            <col style={{ width: "80px" }} />
            <col style={{ width: "80px" }} />
            <col style={{ width: "80px" }} />
          </colgroup>
          <thead>
            <tr>
              <th>Key</th>
              <th>Type</th>
              <th>TTL</th>
              <th>Size</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((entry: CacheEntry) => (
              <tr
                key={entry.key}
                className="ss-dbg-email-row"
                onClick={() => handleKeyClick(entry.key)}
              >
                <td className="ss-dbg-c-sql">{entry.key}</td>
                <td className="ss-dbg-c-muted">{entry.type}</td>
                <td className="ss-dbg-c-muted">
                  {entry.ttl > 0 ? formatTtl(entry.ttl) : "-"}
                </td>
                <td className="ss-dbg-c-dim">
                  {entry.size > 0 ? formatCacheSize(entry.size) : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default CacheTab;
