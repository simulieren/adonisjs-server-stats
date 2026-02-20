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

  async emails({ response }: HttpContext) {
    const emails = this.store.emails.getLatest(100);
    // Strip html/text from list response to keep it lightweight
    const stripped = emails.map(({ html, text, ...rest }) => rest);
    return response.json({ emails: stripped, total: this.store.emails.getTotalCount() });
  }

  async emailPreview({ params, response }: HttpContext) {
    const id = Number(params.id);
    const html = this.store.emails.getEmailHtml(id);
    if (!html) {
      return response.notFound({ error: 'Email not found' });
    }
    return response.header('Content-Type', 'text/html; charset=utf-8').send(html);
  }

  async traces({ response }: HttpContext) {
    if (!this.store.traces) {
      return response.json({ traces: [], total: 0 });
    }
    const traces = this.store.traces.getLatest(100);
    // Strip spans from list view to keep it lightweight
    const list = traces.map(({ spans, warnings, ...rest }) => ({
      ...rest,
      warningCount: warnings.length,
    }));
    return response.json({ traces: list, total: this.store.traces.getTotalCount() });
  }

  async traceDetail({ params, response }: HttpContext) {
    if (!this.store.traces) {
      return response.notFound({ error: 'Tracing not enabled' });
    }
    const id = Number(params.id);
    const trace = this.store.traces.getTrace(id);
    if (!trace) {
      return response.notFound({ error: 'Trace not found' });
    }
    return response.json(trace);
  }
}
