export interface QueryRecord {
  id: number;
  sql: string;
  bindings: any[];
  duration: number;
  method: string;
  model: string | null;
  connection: string;
  inTransaction: boolean;
  timestamp: number;
}

export interface EventRecord {
  id: number;
  event: string;
  data: string | null;
  timestamp: number;
}

export interface RouteRecord {
  method: string;
  pattern: string;
  name: string | null;
  handler: string;
  middleware: string[];
}

export interface DevToolbarConfig {
  enabled: boolean;
  maxQueries: number;
  maxEvents: number;
  slowQueryThresholdMs: number;
}

export type DebugPaneFormatType =
  | 'text'
  | 'time'
  | 'timeAgo'
  | 'duration'
  | 'method'
  | 'json'
  | 'badge'

export interface DebugPaneColumn {
  key: string;
  label: string;
  width?: string;
  format?: DebugPaneFormatType;
  searchable?: boolean;
  filterable?: boolean;
  badgeColorMap?: Record<string, string>;
}

export interface DebugPane {
  id: string;
  label: string;
  endpoint: string;
  columns: DebugPaneColumn[];
  search?: { placeholder: string };
  dataKey?: string;
  fetchOnce?: boolean;
  clearable?: boolean;
}
