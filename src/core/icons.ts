/**
 * Shared SVG icon definitions used across debug panel tabs, dashboard
 * sidebar navigation, stats bar, and other UI components.
 *
 * Framework-agnostic: stores raw SVG element strings that can be
 * rendered via `v-html` (Vue) or `dangerouslySetInnerHTML` (React).
 * All icons use a `0 0 24 24` viewBox.
 */

export interface TabIconDef {
  /** The viewBox attribute value for the SVG element. */
  viewBox: string
  /**
   * Array of SVG child-element strings (e.g. `<path d="..."/>`).
   * Join with `''` to get the full inner SVG markup.
   */
  elements: string[]
}

/**
 * SVG icon definitions keyed by id.
 *
 * Includes icons for debug-panel tabs, dashboard sidebar sections,
 * toolbar buttons, and other shared UI elements.
 *
 * Usage (Vue):
 * ```html
 * <svg :viewBox="icon.viewBox" v-html="icon.elements.join('')"></svg>
 * ```
 *
 * Usage (React):
 * ```tsx
 * <svg viewBox={icon.viewBox}
 *      dangerouslySetInnerHTML={{ __html: icon.elements.join('') }} />
 * ```
 */
export const TAB_ICONS: Record<string, TabIconDef> = {
  // ---------------------------------------------------------------------------
  // Debug-panel tabs / Dashboard sidebar sections (shared)
  // ---------------------------------------------------------------------------
  queries: {
    viewBox: '0 0 24 24',
    elements: [
      '<ellipse cx="12" cy="5" rx="9" ry="3"/>',
      '<path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>',
      '<path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
    ],
  },
  events: {
    viewBox: '0 0 24 24',
    elements: ['<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'],
  },
  emails: {
    viewBox: '0 0 24 24',
    elements: [
      '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>',
      '<polyline points="22,6 12,13 2,6"/>',
    ],
  },
  routes: {
    viewBox: '0 0 24 24',
    elements: [
      '<circle cx="12" cy="12" r="10"/>',
      '<line x1="2" y1="12" x2="22" y2="12"/>',
      '<path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    ],
  },
  logs: {
    viewBox: '0 0 24 24',
    elements: [
      '<line x1="8" y1="6" x2="21" y2="6"/>',
      '<line x1="8" y1="12" x2="21" y2="12"/>',
      '<line x1="8" y1="18" x2="21" y2="18"/>',
      '<line x1="3" y1="6" x2="3.01" y2="6"/>',
      '<line x1="3" y1="12" x2="3.01" y2="12"/>',
      '<line x1="3" y1="18" x2="3.01" y2="18"/>',
    ],
  },
  timeline: {
    viewBox: '0 0 24 24',
    elements: ['<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>'],
  },
  cache: {
    viewBox: '0 0 24 24',
    elements: [
      '<rect x="2" y="2" width="20" height="8" rx="2" ry="2"/>',
      '<rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>',
      '<line x1="6" y1="6" x2="6.01" y2="6"/>',
      '<line x1="6" y1="18" x2="6.01" y2="18"/>',
    ],
  },
  jobs: {
    viewBox: '0 0 24 24',
    elements: [
      '<rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>',
      '<path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    ],
  },
  config: {
    viewBox: '0 0 24 24',
    elements: [
      '<circle cx="12" cy="12" r="3"/>',
      '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    ],
  },
  internals: {
    viewBox: '0 0 24 24',
    elements: [
      '<rect x="4" y="4" width="16" height="16" rx="2"/>',
      '<rect x="9" y="9" width="6" height="6"/>',
      '<line x1="9" y1="1" x2="9" y2="4"/>',
      '<line x1="15" y1="1" x2="15" y2="4"/>',
      '<line x1="9" y1="20" x2="9" y2="23"/>',
      '<line x1="15" y1="20" x2="15" y2="23"/>',
      '<line x1="20" y1="9" x2="23" y2="9"/>',
      '<line x1="20" y1="14" x2="23" y2="14"/>',
      '<line x1="1" y1="9" x2="4" y2="9"/>',
      '<line x1="1" y1="14" x2="4" y2="14"/>',
    ],
  },

  // ---------------------------------------------------------------------------
  // Dashboard-only sidebar sections
  // ---------------------------------------------------------------------------

  /** Overview grid (4 equal squares). */
  overview: {
    viewBox: '0 0 24 24',
    elements: [
      '<rect x="3" y="3" width="7" height="7"/>',
      '<rect x="14" y="3" width="7" height="7"/>',
      '<rect x="14" y="14" width="7" height="7"/>',
      '<rect x="3" y="14" width="7" height="7"/>',
    ],
  },

  /** Requests activity line (same shape as debug-panel timeline). */
  requests: {
    viewBox: '0 0 24 24',
    elements: ['<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>'],
  },

  /**
   * Dashboard timeline -- clock face variant used in the sidebar.
   * Distinct from the debug-panel `timeline` (activity line).
   */
  'dashboard-timeline': {
    viewBox: '0 0 24 24',
    elements: ['<circle cx="12" cy="12" r="10"/>', '<polyline points="12 6 12 12 16 14"/>'],
  },

  /** Custom pane placeholder (sidebar layout). */
  'custom-pane': {
    viewBox: '0 0 24 24',
    elements: ['<rect x="3" y="3" width="18" height="18" rx="2"/>', '<path d="M9 3v18"/>'],
  },

  // ---------------------------------------------------------------------------
  // Toolbar / utility icons
  // ---------------------------------------------------------------------------

  /** Wrench icon for debug panel toggle. */
  wrench: {
    viewBox: '0 0 24 24',
    elements: [
      '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    ],
  },

  /** External link (open in new window). */
  'external-link': {
    viewBox: '0 0 24 24',
    elements: [
      '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
      '<polyline points="15 3 21 3 21 9"/>',
      '<line x1="10" y1="14" x2="21" y2="3"/>',
    ],
  },

  /** Sun icon (light theme indicator). */
  sun: {
    viewBox: '0 0 24 24',
    elements: [
      '<circle cx="12" cy="12" r="5"/>',
      '<line x1="12" y1="1" x2="12" y2="3"/>',
      '<line x1="12" y1="21" x2="12" y2="23"/>',
      '<line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>',
      '<line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>',
      '<line x1="1" y1="12" x2="3" y2="12"/>',
      '<line x1="21" y1="12" x2="23" y2="12"/>',
      '<line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>',
      '<line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
    ],
  },

  /** Moon icon (dark theme indicator). */
  moon: {
    viewBox: '0 0 24 24',
    elements: ['<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'],
  },

  /** Search / magnifying glass. */
  search: {
    viewBox: '0 0 24 24',
    elements: ['<circle cx="11" cy="11" r="8"/>', '<line x1="21" y1="21" x2="16.65" y2="16.65"/>'],
  },

  /** Eye icon (reveal / show). */
  eye: {
    viewBox: '0 0 24 24',
    elements: [
      '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>',
      '<circle cx="12" cy="12" r="3"/>',
    ],
  },

  /** Eye-off icon (hide / conceal). */
  'eye-off': {
    viewBox: '0 0 24 24',
    elements: [
      '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>',
      '<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>',
      '<line x1="1" y1="1" x2="23" y2="23"/>',
      '<path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>',
    ],
  },

  /** Chevron right (expand / next). */
  'chevron-right': {
    viewBox: '0 0 24 24',
    elements: ['<path d="M9 18l6-6-6-6"/>'],
  },

  /** Chevron left (collapse / previous). */
  'chevron-left': {
    viewBox: '0 0 24 24',
    elements: ['<path d="M15 18l-6-6 6-6"/>'],
  },

  /** Small external link for debug-panel "view in dashboard" links. */
  'open-external': {
    viewBox: '0 0 16 16',
    elements: ['<path d="M6 3H3v10h10v-3M9 1h6v6M7 9L15 1"/>'],
  },
}
