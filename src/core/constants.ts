// ---------------------------------------------------------------------------
// Shared refresh interval constants
// ---------------------------------------------------------------------------
//
// Centralizes the polling intervals used by both React and Vue dashboard
// hooks so the values stay in sync across frameworks.
// ---------------------------------------------------------------------------

/** Refresh interval for the overview section (ms). */
export const OVERVIEW_REFRESH_MS = 5000

/** Refresh interval for other dashboard sections (ms). */
export const SECTION_REFRESH_MS = 10000

/** Refresh interval for debug panel tabs (ms). */
export const DEBUG_REFRESH_MS = 3000
