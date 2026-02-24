import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Template } from "edge.js";

import type { ServerStatsConfig } from "../types.js";

const DIR = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(DIR, rel), "utf-8");

/**
 * Try to locate and read the @adonisjs/transmit-client build file.
 * Returns the file contents wrapped to expose `window.Transmit`, or
 * an empty string if the package is not installed.
 */
function loadTransmitClient(): string {
  try {
    const req = createRequire(join(process.cwd(), "package.json"));
    const clientPath = req.resolve(
      "@adonisjs/transmit-client/build/index.js",
    );
    const src = readFileSync(clientPath, "utf-8");
    return `(function(){var __exports={};(function(){${src.replace(
      /^export\s*\{[^}]*\}\s*;?\s*$/m,
      "",
    )}\n__exports.Transmit=Transmit;})();window.Transmit=__exports.Transmit;})()`;
  } catch {
    return "";
  }
}

/**
 * Edge plugin that registers the `@serverStats()` tag.
 *
 * - Mounts `views/` as the `ss` Edge disk for partials
 * - Reads CSS/JS client assets from `client/`
 * - Pre-renders the stats-bar template once at boot (via `Template` directly
 *   to avoid the `#executePlugins` recursion from `edge.renderSync`)
 * - Registers `@serverStats()` tag that outputs the pre-rendered HTML
 *
 * Usage in the provider's `boot()` method:
 * ```ts
 * edge.use(edgePluginServerStats(config))
 * ```
 *
 * Usage in Edge templates:
 * ```edge
 * @serverStats()
 * ```
 */
export function edgePluginServerStats(config: ServerStatsConfig) {
  return (edge: any) => {
    // Mount Edge views under the `ss` disk (needed for @include resolution)
    edge.mount("ss", join(DIR, "views"));

    // Read client assets once at boot
    const css = read("client/stats-bar.css");
    const js = read("client/stats-bar.js");

    const endpoint =
      typeof config.endpoint === "string"
        ? config.endpoint
        : "/admin/api/server-stats";
    const intervalMs = config.intervalMs || 3000;
    const showDebug = !!config.devToolbar?.enabled;

    // Badge groups for the Edge template
    const groups = [
      // Process
      [
        { id: "node", label: "NODE" },
        { id: "up", label: "UP" },
        { id: "cpu", label: "CPU" },
        { id: "evt", label: "EVT" },
      ],
      // Memory
      [
        { id: "mem", label: "HEAP" },
        { id: "rss", label: "RSS" },
        { id: "sys", label: "SYS" },
      ],
      // HTTP
      [
        { id: "rps", label: "REQ/s" },
        { id: "avg", label: "AVG" },
        { id: "err", label: "ERR" },
        { id: "conn", label: "CONN" },
      ],
      // DB
      [{ id: "db", label: "DB" }],
      // Redis
      [
        { id: "redis", label: "REDIS" },
        { id: "rmem", label: "MEM" },
        { id: "rkeys", label: "KEYS" },
        { id: "rhit", label: "HIT" },
      ],
      // Queue
      [
        { id: "q", label: "Q" },
        { id: "workers", label: "WORKERS" },
      ],
      // App
      [
        { id: "users", label: "USERS" },
        { id: "hooks", label: "HOOKS" },
        { id: "mail", label: "MAIL" },
      ],
      // Logs
      [
        { id: "logerr", label: "LOG ERR" },
        { id: "lograte", label: "LOG/m" },
      ],
      // Debug (conditional)
      ...(showDebug ? [[{ id: "dbg-queries", label: "QRY" }]] : []),
    ];

    const state: Record<string, any> = {
      css,
      js,
      endpoint,
      intervalMs,
      showDebug,
      groups,
    };

    if (showDebug) {
      state.debugCss = read("client/debug-panel.css");
      state.debugJs = read("client/debug-panel.js");
      state.logsEndpoint = "/admin/api/debug/logs";
      state.customPanes = config.devToolbar?.panes || [];
      state.showTracing = !!config.devToolbar?.tracing;
      state.dashboardPath = config.devToolbar?.dashboard
        ? (config.devToolbar.dashboardPath || '/__stats')
        : null;
      state.transmitClient = loadTransmitClient();
    }

    // Pre-render via Template directly — bypasses edge.createRenderer() which
    // would re-run #executePlugins and cause infinite recursion.
    const template = new Template(
      edge.compiler,
      edge.globals,
      {},
      edge.processor,
    );
    const html = template.render<string>("ss::stats-bar", state);
    const escaped = JSON.stringify(html);

    // Track whether shouldShow is configured (controls render-time guard)
    const hasShouldShow = !!config.shouldShow;

    edge.registerTag({
      tagName: "serverStats",
      block: false,
      seekable: true,
      compile(_parser: any, buffer: any, token: any) {
        if (hasShouldShow) {
          // Guard: call the lazy __ssShowFn at render time (after auth middleware has run)
          buffer.writeStatement(
            `if (typeof state.__ssShowFn === 'function' ? state.__ssShowFn() : false) {`,
            token.filename,
            token.loc.start.line,
          );
          buffer.outputExpression(
            escaped,
            token.filename,
            token.loc.start.line,
            false,
          );
          buffer.writeStatement(`}`, token.filename, -1);
        } else {
          // No shouldShow configured — always render
          buffer.outputExpression(
            escaped,
            token.filename,
            token.loc.start.line,
            false,
          );
        }
      },
    });
  };
}
