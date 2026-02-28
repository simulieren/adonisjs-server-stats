import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";

import { ApiClient } from "../../../../core/api-client.js";
import {
  timeAgo,
  formatDuration,
  formatTime,
} from "../../../../core/formatters.js";
import { initResizableColumns } from "../../../../core/resizable-columns.js";
import { useDebugData } from "../../../hooks/useDebugData.js";

import type {
  TraceRecord,
  TraceSpan,
  DebugPanelProps,
} from "../../../../core/types.js";

interface TimelineTabProps {
  options?: DebugPanelProps;
}

const BAR_COLORS: Record<string, string> = {
  request: "#1e3a5f",
  middleware: "rgba(30, 58, 95, 0.7)",
  db: "#6d28d9",
  view: "#0e7490",
  mail: "#059669",
  event: "#b45309",
  custom: "#525252",
};

const LEGEND_ITEMS = [
  { label: "Request", color: "#1e3a5f" },
  { label: "Middleware", color: "rgba(30, 58, 95, 0.7)" },
  { label: "Database", color: "#6d28d9" },
  { label: "View", color: "#0e7490" },
  { label: "Mail", color: "#059669" },
  { label: "Event", color: "#b45309" },
];

export function TimelineTab({ options }: TimelineTabProps) {
  const {
    baseUrl = "",
    debugEndpoint = "/admin/api/debug",
    authToken,
  } = options || {};
  const { data, isLoading, error } = useDebugData<{ traces: TraceRecord[] }>(
    "timeline",
    options,
  );
  const [search, setSearch] = useState("");
  const [selectedTraceId, setSelectedTraceId] = useState<number | null>(null);
  const [traceDetail, setTraceDetail] = useState<TraceRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const traces = useMemo(() => {
    const items = data?.traces || [];
    if (!search) return items;
    const lower = search.toLowerCase();
    return items.filter(
      (t) =>
        t.url.toLowerCase().includes(lower) ||
        t.method.toLowerCase().includes(lower) ||
        String(t.statusCode).includes(lower),
    );
  }, [data, search]);

  const clientRef = useRef<ApiClient | null>(null);
  const getClient = useCallback(() => {
    if (!clientRef.current) {
      clientRef.current = new ApiClient({ baseUrl, authToken });
    }
    return clientRef.current;
  }, [baseUrl, authToken]);

  // Fetch trace detail (with spans) when a trace is selected
  useEffect(() => {
    if (selectedTraceId === null) {
      setTraceDetail(null);
      setDetailError(null);
      return;
    }

    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);

    const client = getClient();
    client
      .get<TraceRecord>(`${debugEndpoint}/traces/${selectedTraceId}`)
      .then((detail) => {
        if (!cancelled) {
          setTraceDetail(detail);
          setDetailLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setDetailError(
            err instanceof Error ? err.message : "Failed to load trace",
          );
          setDetailLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedTraceId, debugEndpoint, getClient]);

  const handleSelectTrace = useCallback((id: number) => {
    setSelectedTraceId((prev) => (prev === id ? null : id));
  }, []);

  const statusClass = useCallback((code: number) => {
    if (code >= 500) return "ss-dbg-status-5xx";
    if (code >= 400) return "ss-dbg-status-4xx";
    if (code >= 300) return "ss-dbg-status-3xx";
    return "ss-dbg-status-2xx";
  }, []);

  const tableRef = useRef<HTMLTableElement>(null);
  useEffect(() => {
    if (tableRef.current) {
      return initResizableColumns(tableRef.current);
    }
  }, [traces]);

  if (isLoading && !data) {
    return <div className="ss-dbg-empty">Loading traces...</div>;
  }

  if (error) {
    return <div className="ss-dbg-empty">Error: {error.message}</div>;
  }

  // Waterfall detail view
  if (selectedTraceId !== null) {
    if (detailLoading) {
      return <div className="ss-dbg-empty">Loading trace detail...</div>;
    }

    if (detailError) {
      return (
        <div>
          <div className="ss-dbg-tl-detail-header">
            <button
              type="button"
              className="ss-dbg-btn-clear"
              onClick={() => setSelectedTraceId(null)}
            >
              &larr; Back
            </button>
          </div>
          <div className="ss-dbg-empty">Error: {detailError}</div>
        </div>
      );
    }

    if (!traceDetail) {
      return <div className="ss-dbg-empty">Loading trace detail...</div>;
    }

    const spans = traceDetail.spans || [];
    const warnings = traceDetail.warnings || [];

    return (
      <div>
        <div className="ss-dbg-tl-detail-header">
          <button
            type="button"
            className="ss-dbg-btn-clear"
            onClick={() => setSelectedTraceId(null)}
          >
            &larr; Back
          </button>
          <span
            className={`ss-dbg-method ss-dbg-method-${traceDetail.method.toLowerCase()}`}
          >
            {traceDetail.method}
          </span>
          <span className="ss-dbg-tl-detail-url">{traceDetail.url}</span>
          <span
            className={`ss-dbg-status ${statusClass(traceDetail.statusCode)}`}
          >
            {traceDetail.statusCode}
          </span>
          <span className="ss-dbg-tl-meta">
            {formatDuration(traceDetail.totalDuration)} &middot;{" "}
            {traceDetail.spanCount} spans
          </span>
        </div>

        {/* Legend */}
        <div className="ss-dbg-tl-legend">
          {LEGEND_ITEMS.map((item) => (
            <div key={item.label} className="ss-dbg-tl-legend-item">
              <div
                className="ss-dbg-tl-legend-dot"
                style={{ background: item.color }}
              />
              <span>{item.label}</span>
            </div>
          ))}
        </div>

        {/* Waterfall rows */}
        <div style={{ padding: "8px 12px", overflow: "auto" }}>
          {spans.length === 0 ? (
            <div className="ss-dbg-empty">
              No spans captured for this request
            </div>
          ) : (
            spans.map((span: TraceSpan) => {
              const totalDuration = traceDetail.totalDuration || 1;
              const left = (span.startOffset / totalDuration) * 100;
              const width = Math.max(
                (span.duration / totalDuration) * 100,
                0.5,
              );

              return (
                <div key={span.id} className="ss-dbg-tl-row">
                  <div className="ss-dbg-tl-label" title={span.label}>
                    {span.label}
                  </div>
                  <div className="ss-dbg-tl-track">
                    <div
                      className={`ss-dbg-tl-bar ss-dbg-tl-bar-${span.category}`}
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        background:
                          BAR_COLORS[span.category] || BAR_COLORS.custom,
                      }}
                      title={`${span.label}: ${formatDuration(span.duration)}`}
                    />
                  </div>
                  <span className="ss-dbg-tl-dur">
                    {formatDuration(span.duration)}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* Warnings */}
        {warnings.length > 0 && (
          <div className="ss-dbg-tl-warnings">
            <div className="ss-dbg-tl-warnings-title">Warnings</div>
            {warnings.map((w, i) => (
              <div key={i} className="ss-dbg-tl-warning">
                {w}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Trace list view
  return (
    <div>
      <div className="ss-dbg-search-bar">
        <input
          type="text"
          className="ss-dbg-search"
          placeholder="Filter traces..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="ss-dbg-summary">{traces.length} traces</span>
      </div>

      {traces.length === 0 ? (
        <div className="ss-dbg-empty">
          No traces captured. Enable tracing in config.
        </div>
      ) : (
        <table ref={tableRef} className="ss-dbg-table">
          <colgroup>
            <col style={{ width: "50px" }} />
            <col style={{ width: "70px" }} />
            <col />
            <col style={{ width: "60px" }} />
            <col style={{ width: "80px" }} />
            <col style={{ width: "50px" }} />
            <col style={{ width: "80px" }} />
          </colgroup>
          <thead>
            <tr>
              <th>#</th>
              <th>Method</th>
              <th>URL</th>
              <th>Status</th>
              <th>Duration</th>
              <th>Spans</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {traces.map((trace) => (
              <tr
                key={trace.id}
                className="ss-dbg-email-row"
                onClick={() => handleSelectTrace(trace.id)}
              >
                <td className="ss-dbg-c-dim" style={{ whiteSpace: "nowrap" }}>
                  {trace.id}
                </td>
                <td>
                  <span
                    className={`ss-dbg-method ss-dbg-method-${trace.method.toLowerCase()}`}
                  >
                    {trace.method}
                  </span>
                </td>
                <td title={trace.url}>{trace.url}</td>
                <td>
                  <span
                    className={`ss-dbg-status ${statusClass(trace.statusCode)}`}
                  >
                    {trace.statusCode}
                  </span>
                </td>
                <td
                  className={`ss-dbg-duration ${trace.totalDuration > 500 ? "ss-dbg-very-slow" : trace.totalDuration > 100 ? "ss-dbg-slow" : ""}`}
                >
                  {formatDuration(trace.totalDuration)}
                </td>
                <td className="ss-dbg-c-muted" style={{ textAlign: "center" }}>
                  {trace.spanCount}
                </td>
                <td
                  className="ss-dbg-event-time"
                  title={formatTime(trace.timestamp)}
                >
                  {timeAgo(trace.timestamp)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default TimelineTab;
