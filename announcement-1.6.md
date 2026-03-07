# adonisjs-server-stats v1.6 — Announcement

---

## Twitter / X

adonisjs-server-stats v1.6 is out — the biggest update yet.

Thank you for almost 3k downloads and all the positive feedback. It really keeps me going.

What's new:
- React & Vue (Inertia) support — full component libraries
- Zero-config setup — collectors auto-detect Lucid, Redis, BullMQ
- New diagnostics page — internals, config viewer, route map
- Deferred debug panel loading — tiny main bundle
- Resizable tables, badge filtering, simplified config API
- Smaller JS & CSS bundles across the board

More framework integrations and support for more AdonisJS packages are planned.

https://github.com/simulieren/adonisjs-server-stats

---

## Discord

**adonisjs-server-stats v1.6 is here — the biggest release yet**

First off — thank you for almost 3,000 downloads and all the positive feedback. It means a lot and keeps me motivated to push this forward.

v1.6 is a major rework under the hood and brings a ton of new features:

**Multi-Framework Support**
- Full **React (Inertia)** component library — StatsBar, DebugPanel, DashboardPage
- Complete **Vue 3 (Inertia)** port with composables
- **Edge/Preact** and **Edge/Vue** IIFE bundles for Edge templates
- Shared framework-agnostic core — consistent behavior everywhere

**DX Improvements**
- **Zero-config setup** — collectors auto-detect your installed packages (Lucid, Redis, BullMQ) and enable themselves
- **Simplified config API** — `toolbar`, `dashboard`, `authorize` as clean top-level keys
- **Deferred debug panel loading** — main bundle stays tiny, heavy UI loads on demand
- **Resizable table columns** across all data tables
- **Badge-based filtering** in logs, events, and queries

**New Diagnostics & Internals Page**
- See package info, active renderer, registered collectors, and full route map
- Config viewer with search, expand/collapse, redacted value reveal, and one-click copy

**Performance**
- Significantly smaller JS & CSS bundles through shared core extraction and deduplication
- New CSS architecture with design tokens, component styles, and utility classes

**Under the Hood**
- Unified API layer — single `ApiController` + `DataAccess` replaces scattered route handlers
- `registerAllRoutes()` — one call sets up everything
- Separate Vite configs and tsconfigs per build target
- Zero TypeScript errors, zero lint warnings

There are more cool features and support for more AdonisJS packages planned — stay tuned.

https://github.com/simulieren/adonisjs-server-stats

---

## Reddit (r/adonisjs)

**Title: adonisjs-server-stats v1.6 — Multi-framework support, zero-config setup, and a major rework**

**Body:**

Thank you all for almost 3,000 downloads and the positive feedback — it really keeps me going.

v1.6 is the biggest update to adonisjs-server-stats yet. It's a major rework that adds multi-framework support and a bunch of DX improvements.

### What's new

**React & Vue (Inertia) Support**
You can now use adonisjs-server-stats with React or Vue via Inertia — full component libraries for StatsBar, DebugPanel, and DashboardPage. Edge templates still work out of the box with Preact or Vue-powered IIFE bundles. All frontends share a common core, so behavior is consistent everywhere.

**Zero-Config Setup**
Collectors now auto-detect your installed packages. If you have Lucid, Redis, or BullMQ installed, the corresponding collectors enable themselves automatically. The config API has been simplified too — `toolbar`, `dashboard`, and `authorize` are now clean top-level keys.

```ts
import { defineConfig } from 'adonisjs-server-stats'

export default defineConfig({})
// That's it. Everything is auto-detected.
```

**New Diagnostics Page**
A new Internals tab shows package info, the active renderer, registered collectors, and a full route map. The config viewer lets you search, expand/collapse sections, reveal redacted values, and copy with one click.

**Performance & DX**
- Deferred debug panel loading — the main bundle stays tiny
- Significantly smaller JS & CSS bundles via shared core extraction
- Resizable table columns across all data tables
- Badge-based filtering in logs, events, and queries
- New CSS architecture with design tokens and utility classes

**Under the Hood**
- Unified API layer with a single `ApiController` + `DataAccess`
- `registerAllRoutes()` — one call registers stats, debug, and dashboard routes
- Separate Vite configs and tsconfigs per build target
- Zero TypeScript errors, zero lint warnings

There are more features and support for more AdonisJS packages planned. Feedback and ideas are always welcome.

GitHub: https://github.com/simulieren/adonisjs-server-stats
