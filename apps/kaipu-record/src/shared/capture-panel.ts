/**
 * The menu-bar capture panel's height ceiling. Main clamps the window to it; above it the
 * panel scrolls and the Record button slides out of view at the top. Shared so the E2E
 * check that every drawer fits measures against the same number main enforces.
 */
export const CAPTURE_PANEL_MAX_HEIGHT = 600;
