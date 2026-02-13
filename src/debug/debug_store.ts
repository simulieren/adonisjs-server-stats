import { QueryCollector } from "./query_collector.js";
import { EventCollector } from "./event_collector.js";
import { RouteInspector } from "./route_inspector.js";
import type { DevToolbarConfig } from "./types.js";

/**
 * Singleton store holding all debug data collectors.
 * Bound to the AdonisJS container as `debug.store`.
 */
export class DebugStore {
  readonly queries: QueryCollector;
  readonly events: EventCollector;
  readonly routes: RouteInspector;

  constructor(config: DevToolbarConfig) {
    this.queries = new QueryCollector(
      config.maxQueries,
      config.slowQueryThresholdMs,
    );
    this.events = new EventCollector(config.maxEvents);
    this.routes = new RouteInspector();
  }

  async start(emitter: any, router: any): Promise<void> {
    await this.queries.start(emitter);
    this.events.start(emitter);
    this.routes.inspect(router);
  }

  stop(): void {
    this.queries.stop();
    this.events.stop();
  }
}
