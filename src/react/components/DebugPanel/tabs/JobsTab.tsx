import React, {
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
} from "react";

import { timeAgo, formatDuration } from "../../../../core/formatters.js";
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
}

const JOB_STATUSES = [
  "all",
  "active",
  "waiting",
  "delayed",
  "completed",
  "failed",
] as const;

interface JobsData {
  stats: JobStats;
  jobs: JobRecord[];
}

export function JobsTab({ options }: JobsTabProps) {
  const { data, isLoading, error } = useDebugData<JobsData>("jobs", options);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [retrying, setRetrying] = useState<string | null>(null);

  const jobs = useMemo(() => {
    const items = data?.jobs || [];
    if (statusFilter === "all") return items;
    return items.filter((j) => j.status === statusFilter);
  }, [data, statusFilter]);

  const handleRetry = useCallback(
    async (jobId: string) => {
      setRetrying(jobId);
      try {
        const {
          baseUrl = "",
          debugEndpoint = "/admin/api/debug",
          authToken,
        } = options || {};
        const url = `${baseUrl}${debugEndpoint}/jobs/${jobId}/retry`;
        const headers: Record<string, string> = { Accept: "application/json" };
        if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
        await fetch(url, {
          method: "POST",
          headers,
          credentials: "same-origin",
        });
      } catch {
        // Silently fail
      }
      setRetrying(null);
    },
    [options],
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

  if (isLoading && !data) {
    return <div className="ss-dbg-empty">Loading jobs...</div>;
  }

  if (error) {
    return <div className="ss-dbg-empty">Error: {error.message}</div>;
  }

  if (!data) {
    return <div className="ss-dbg-empty">Queue inspector not available</div>;
  }

  const stats = data.stats || (data as any).overview;

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
            <span className="ss-dbg-job-stat-value">{stats?.failed ?? 0}</span>
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
            {jobs.map((job) => (
              <tr key={job.id}>
                <td style={{ color: "var(--ss-dim)" }}>{job.id}</td>
                <td style={{ color: "var(--ss-text)" }}>{job.name}</td>
                <td>
                  <span
                    className={`ss-dbg-badge ${statusColorMap[job.status] || "ss-dbg-badge-muted"}`}
                  >
                    {job.status}
                  </span>
                </td>
                <td>
                  <JsonViewer
                    data={(job as any).payload || job.data}
                    maxPreviewLength={60}
                  />
                </td>
                <td style={{ color: "var(--ss-muted)", textAlign: "center" }}>
                  {job.attempts}
                </td>
                <td className="ss-dbg-duration">
                  {job.duration !== null ? formatDuration(job.duration) : "-"}
                </td>
                <td className="ss-dbg-event-time">
                  {timeAgo(job.timestamp || job.createdAt)}
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
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default JobsTab;
