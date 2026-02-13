export interface ServerStats {
  // Process
  nodeVersion: string;
  uptime: number;
  memHeapUsed: number;
  memHeapTotal: number;
  memRss: number;
  cpuPercent: number;
  eventLoopLag: number;
  timestamp: number;

  // HTTP
  requestsPerSecond: number;
  avgResponseTimeMs: number;
  errorRate: number;
  activeHttpConnections: number;

  // DB Pool
  dbPoolUsed: number;
  dbPoolFree: number;
  dbPoolPending: number;
  dbPoolMax: number;

  // Redis
  redisOk: boolean;
  redisMemoryUsedMb: number;
  redisConnectedClients: number;
  redisKeysCount: number;
  redisHitRate: number;

  // Queue
  queueActive: number;
  queueWaiting: number;
  queueDelayed: number;
  queueFailed: number;
  queueWorkerCount: number;

  // System
  systemLoadAvg1m: number;
  systemLoadAvg5m: number;
  systemLoadAvg15m: number;
  systemMemoryTotalMb: number;
  systemMemoryFreeMb: number;
  systemUptime: number;

  // App
  onlineUsers: number;
  pendingWebhooks: number;
  pendingEmails: number;

  // Logs
  logErrorsLast5m: number;
  logWarningsLast5m: number;
  logEntriesLast5m: number;
  logEntriesPerMinute: number;
}

export interface LogStats {
  errorsLast5m: number;
  warningsLast5m: number;
  entriesLast5m: number;
  entriesPerMinute: number;
}

export interface ServerStatsConfig {
  intervalMs: number;
  transport: "transmit" | "none";
  channelName: string;
  endpoint: string | false;
  collectors: import("./collectors/collector.js").MetricCollector[];
  skipInTest?: boolean;
  onStats?: (stats: Partial<ServerStats>) => void;
  devToolbar?: {
    enabled: boolean;
    maxQueries?: number;
    maxEvents?: number;
    slowQueryThresholdMs?: number;
    panes?: import('./debug/types.js').DebugPane[];
  };

  /**
   * Per-request callback to decide if the stats bar should render.
   * Receives the HTTP context and returns true to show the bar.
   *
   * When not set, `@serverStats()` always renders.
   *
   * @example
   * ```ts
   * shouldShow: (ctx) => !!ctx.auth.user?.isAdmin
   * ```
   */
  shouldShow?: (ctx: any) => boolean;
}
