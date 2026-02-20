import { StatsEngine } from "../engine/stats_engine.js";
import { DebugStore } from "../debug/debug_store.js";
import { setShouldShow, setTraceCollector } from "../middleware/request_tracking_middleware.js";

import type { ApplicationService } from "@adonisjs/core/types";
import type { ServerStatsConfig } from "../types.js";
import type { DevToolbarConfig } from "../debug/types.js";

export default class ServerStatsProvider {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private engine: StatsEngine | null = null;
  private debugStore: DebugStore | null = null;
  private persistPath: string | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(protected app: ApplicationService) {}

  async boot() {
    const config = this.app.config.get<ServerStatsConfig>("server_stats");
    if (!config) return;

    // Wire up the per-request shouldShow callback
    if (config.shouldShow) {
      setShouldShow(config.shouldShow);
    }

    if (!this.app.usingEdgeJS) return;

    try {
      const edge = await import("edge.js");
      const { edgePluginServerStats } = await import("../edge/plugin.js");
      edge.default.use(edgePluginServerStats(config));
    } catch {
      // Edge not available — skip tag registration
    }
  }

  async ready() {
    const config = this.app.config.get<ServerStatsConfig>("server_stats");
    if (!config) return;

    if (this.app.inTest && config.skipInTest !== false) return;

    this.engine = new StatsEngine(config.collectors);

    // Bind engine to container so the controller can access it
    (this.app.container as any).singleton(
      "server_stats.engine",
      () => this.engine!,
    );

    await this.engine.start();

    // Dev toolbar setup
    const toolbarConfig = config.devToolbar;
    if (toolbarConfig?.enabled && !this.app.inProduction) {
      await this.setupDevToolbar({
        enabled: true,
        maxQueries: toolbarConfig.maxQueries ?? 500,
        maxEvents: toolbarConfig.maxEvents ?? 200,
        maxEmails: toolbarConfig.maxEmails ?? 100,
        slowQueryThresholdMs: toolbarConfig.slowQueryThresholdMs ?? 100,
        persistDebugData: toolbarConfig.persistDebugData ?? false,
        tracing: toolbarConfig.tracing ?? false,
        maxTraces: toolbarConfig.maxTraces ?? 200,
      });
    }

    let transmit: any = null;
    if (config.transport === "transmit") {
      try {
        transmit = await this.app.container.make("transmit");
      } catch {
        // Transmit not installed — skip broadcasting
      }
    }

    let prometheusCollector: any = null;
    try {
      const mod = await import("../prometheus/prometheus_collector.js");
      prometheusCollector = mod.ServerStatsCollector.instance;
    } catch {
      // Prometheus not installed — skip
    }

    this.intervalId = setInterval(async () => {
      try {
        const stats = await this.engine!.collect();

        if (transmit && config.channelName) {
          transmit.broadcast(
            config.channelName,
            JSON.parse(JSON.stringify(stats)),
          );
        }

        if (prometheusCollector) {
          prometheusCollector.update(stats);
        }

        config.onStats?.(stats as any);
      } catch {
        // Silently ignore collection errors
      }
    }, config.intervalMs);
  }

  private async setupDevToolbar(toolbarConfig: DevToolbarConfig) {
    this.debugStore = new DebugStore(toolbarConfig);

    // Bind debug store to container
    (this.app.container as any).singleton(
      "debug.store",
      () => this.debugStore!,
    );

    // Load persisted data before starting collectors
    if (toolbarConfig.persistDebugData) {
      this.persistPath = typeof toolbarConfig.persistDebugData === 'string'
        ? this.app.makePath(toolbarConfig.persistDebugData)
        : this.app.makePath('.adonisjs', 'server-stats', 'debug-data.json');
      await this.debugStore.loadFromDisk(this.persistPath);
    }

    // Get the emitter
    let emitter: any = null;
    try {
      emitter = await this.app.container.make("emitter");
    } catch {
      // Emitter not available
    }

    // Get the router
    let router: any = null;
    try {
      router = await this.app.container.make("router");
    } catch {
      // Router not available
    }

    await this.debugStore.start(emitter, router);

    // Wire trace collector into the request tracking middleware
    if (this.debugStore.traces) {
      setTraceCollector(this.debugStore.traces);
    }

    // Periodic flush every 30 seconds (handles crashes)
    if (this.persistPath) {
      this.flushTimer = setInterval(async () => {
        try {
          await this.debugStore?.saveToDisk(this.persistPath!);
        } catch {
          // Silently ignore flush errors
        }
      }, 30_000);
    }
  }

  async shutdown() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Save debug data before stopping collectors
    if (this.persistPath && this.debugStore) {
      try {
        await this.debugStore.saveToDisk(this.persistPath);
      } catch {
        // Silently ignore save errors during shutdown
      }
    }

    this.debugStore?.stop();
    await this.engine?.stop();
  }
}
