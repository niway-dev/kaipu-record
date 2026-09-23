/**
 * Moves keyboard focus into the inspector column after a timeline selection.
 *
 * Why: clicking a zoom's block on the timeline leaves focus on the clicked lane
 * `<button>`, but the user's next action is in the inspector (Level, Smoothness, ...) —
 * the lane button holding focus is what made the editor look like it "lost focus"
 * (backlog/video-editor-camera-box-ux § 2, candidate cause B).
 *
 * Plain DOM, no React: this must run AFTER React has committed the inspector for the
 * new selection, which is a caller concern (e.g. wrap the call in
 * `requestAnimationFrame` from the event handler). Keeping this function itself
 * synchronous keeps it trivially unit-testable.
 */
const FOCUSABLE_SELECTOR = 'input, button, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Finds the inspector column and focuses its first enabled focusable control. */
export function focusInspectorFirstControl(): boolean {
  const inspector = document.querySelector<HTMLElement>('[data-testid="editor-inspector"]');
  if (!inspector) return false;
  const candidates = inspector.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
  for (const candidate of candidates) {
    if (candidate.hasAttribute("disabled")) continue;
    candidate.focus();
    return true;
  }
  return false;
}
