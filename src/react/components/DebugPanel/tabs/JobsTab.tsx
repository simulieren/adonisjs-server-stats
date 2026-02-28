import React, {
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
} from "react";

import { timeAgo, formatDuration, formatTime } from "../../../../core/formatters.js";
import { initResizableColumns } from "../../../../core/resizable-columns.js";
import { useDebugData } from "../../../hooks/useDebugData.js";
import { JsonViewer } from "../../shared/JsonViewer.js";

import type {
  JobRecord,
  JobStats,
  DebugPanelProps,
} from "../../../../core/types.js";

interface JobsTabProps {
  options?: DebugPanelProps;
  /** Dashboard base path (e.g. '/__stats'). Jobs are served by the dashboard API. */
  dashboardPath?: string;
}

const JOB_STATUSES = [
  "all",
  "active",
  "waiting",
  "delayed",
  "completed",
  "failed",
] as const;

/**
 * Server response shape from the dashboard API `/api/jobs` endpoint.
 *
 * The server may return jobs under `jobs` or `data`, and stats under
 * `stats` or `overview`. We handle all variants to stay compatible
 * with different queue inspector implementations.
 */
interface JobsResponse {
  available?: boolean;
  overview?: JobStats;
  stats?: JobStats;
  data?: JobRecord[];
  jobs?: JobRecord[];
  total?: number;
}

export function JobsTab({ options, dashboardPath }: JobsTabProps) {
  // Jobs live on the dashboard API (e.g. /__stats/api/jobs), not the debug endpoint.
  // Override the debugEndpoint so useDebugData fetches from the correct URL.
  const dashApiBase = useMemo(
    () => (dashboardPath ? dashboardPath.replace(/\/+$/, "") + "/api" : null),
    [dashboardPath],
  );
  const jobsOptions = useMemo(
    () => (dashApiBase ? { ...options, debugEndpoint: dashApiBase } : options),
    [dashApiBase, options],
  );
  const { data, isLoading, error } = useDebugData<JobsResponse>(
    "jobs",
    jobsOptions,
  );
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [retrying, setRetrying] = useState<string | null>(null);

  // Extract jobs from the response (server may use `data` or `jobs` key)
  const jobs = useMemo(() => {
    if (!data) return [];
    const items = data.data || data.jobs || [];
    if (statusFilter === "all") return items;
    return items.filter((j) => j.status === statusFilter);
  }, [data, statusFilter]);

  const handleRetry = useCallback(
    async (jobId: string) => {
      setRetrying(jobId);
      try {
        const { baseUrl = "", authToken } = options || {};
        const apiBase =
          dashApiBase || options?.debugEndpoint || "/admin/api/debug";
        const url = `${baseUrl}${apiBase}/jobs/${jobId}/retry`;
        const headers: Record<string, string> = { Accept: "application/json" };
        if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
        await fetch(url, {
          method: "POST",
          headers,
          credentials: authToken ? "omit" : "same-origin",
        });
      } catch {
        // Silently fail
      }
      setRetrying(null);
    },
    [options, dashApiBase],
  );

  const statusColorMap: Record<string, string> = {
    completed: "ss-dbg-job-status-completed",
    failed: "ss-dbg-job-status-failed",
    active: "ss-dbg-job-status-active",
    waiting: "ss-dbg-job-status-waiting",
    delayed: "ss-dbg-job-status-delayed",
  };

  const tableRef = useRef<HTMLTableElement>(null);

  useEffect(() => {
    if (tableRef.current) {
      return initResizableColumns(tableRef.current);
    }
  }, [jobs]);

  if (!dashApiBase) {
    return (
      <div className="ss-dbg-empty">
        Queue inspector not available (no dashboard configured)
      </div>
    );
  }

  if (isLoading && !data) {
    return <div className="ss-dbg-empty">Loading jobs...</div>;
  }

  if (error) {
    return <div className="ss-dbg-empty">Error: {error.message}</div>;
  }

  if (!data) {
    return <div className="ss-dbg-empty">Queue inspector not available</div>;
  }

  // Server may return stats under `stats` or `overview`
  const stats = data.stats || data.overview;

  return (
    <div>
      {/* Stats */}
      <div className="ss-dbg-job-stats-area">
        <div className="ss-dbg-job-stats">
          <div className="ss-dbg-job-stat">
            <span className="ss-dbg-job-stat-label">Active:</span>
            <span className="ss-dbg-job-stat-value">{stats?.active ?? 0}</span>
          </div>
          <div className="ss-dbg-job-stat">
            <span className="ss-dbg-job-stat-label">Waiting:</span>
            <span className="ss-dbg-job-stat-value">{stats?.waiting ?? 0}</span>
          </div>
          <div className="ss-dbg-job-stat">
            <span className="ss-dbg-job-stat-label">Delayed:</span>
            <span className="ss-dbg-job-stat-value">{stats?.delayed ?? 0}</span>
          </div>
          <div className="ss-dbg-job-stat">
            <span className="ss-dbg-job-stat-label">Completed:</span>
            <span className="ss-dbg-job-stat-value">
              {stats?.completed ?? 0}
            </span>
          </div>
          <div className="ss-dbg-job-stat">
            <span className="ss-dbg-job-stat-label">Failed:</span>
            <span className="ss-dbg-job-stat-value ss-dbg-c-red">
              {stats?.failed ?? 0}
            </span>
          </div>
        </div>

        {/* Status filter */}
        <div className="ss-dbg-log-filters">
          {JOB_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              className={`ss-dbg-job-filter ${statusFilter === status ? "ss-dbg-active" : ""}`}
              onClick={() => setStatusFilter(status)}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      {/* Jobs table */}
      {jobs.length === 0 ? (
        <div className="ss-dbg-empty">No jobs found</div>
      ) : (
        <table ref={tableRef} className="ss-dbg-table">
          <colgroup>
            <col style={{ width: "50px" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "80px" }} />
            <col />
            <col style={{ width: "50px" }} />
            <col style={{ width: "80px" }} />
            <col style={{ width: "80px" }} />
            <col style={{ width: "60px" }} />
          </colgroup>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Status</th>
              <th>Payload</th>
              <th>Tries</th>
              <th>Duration</th>
              <th>Time</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => {
              const jobAny = job as Record<string, unknown>;
              return (
                <tr key={job.id}>
                  <td className="ss-dbg-c-dim">{job.id}</td>
                  <td className="ss-dbg-c-sql" title={job.name}>
                    {job.name}
                  </td>
                  <td>
                    <span
                      className={`ss-dbg-badge ${statusColorMap[job.status] || "ss-dbg-badge-muted"}`}
                    >
                      {job.status}
                    </span>
                  </td>
                  <td>
                    <JsonViewer
                      data={job.payload || job.data}
                      maxPreviewLength={60}
                      classPrefix="ss-dbg"
                    />
                  </td>
                  <td
                    className="ss-dbg-c-muted"
                    style={{ textAlign: "center" }}
                  >
                    {job.attempts || (jobAny.attemptsMade as number) || 0}
                  </td>
                  <td className="ss-dbg-duration">
                    {job.duration !== null ? formatDuration(job.duration) : "-"}
                  </td>
                  <td className="ss-dbg-event-time" title={formatTime(
                      job.timestamp ||
                        job.createdAt ||
                        (jobAny.processedAt as string | number) ||
                        (jobAny.created_at as string | number),
                    )}>
                    {timeAgo(
                      job.timestamp ||
                        job.createdAt ||
                        (jobAny.processedAt as string | number) ||
                        (jobAny.created_at as string | number),
                    )}
                  </td>
                  <td>
                    {job.status === "failed" && (
                      <button
                        type="button"
                        className="ss-dbg-retry-btn"
                        onClick={() => handleRetry(job.id)}
                        disabled={retrying === job.id}
                      >
                        {retrying === job.id ? "..." : "Retry"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default JobsTab;
