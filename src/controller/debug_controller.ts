import type { HttpContext } from "@adonisjs/core/http";
import type { DebugStore } from "../debug/debug_store.js";

export default class DebugController {
  constructor(private store: DebugStore) {}

  async queries({ response }: HttpContext) {
    const queries = this.store.queries.getLatest(500);
    const summary = this.store.queries.getSummary();
    return response.json({ queries, summary });
  }

  async events({ response }: HttpContext) {
    const events = this.store.events.getLatest(200);
    return response.json({ events, total: this.store.events.getTotalCount() });
  }

  async routes({ response }: HttpContext) {
    const routes = this.store.routes.getRoutes();
    return response.json({ routes, total: this.store.routes.getRouteCount() });
  }
}
