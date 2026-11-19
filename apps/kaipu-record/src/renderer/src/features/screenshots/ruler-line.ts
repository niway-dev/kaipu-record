/**
 * The ruler line, one look for both places that draw it: Inspect's hover measurement and a
 * pinned Measure annotation. A thin accent line with a soft white outline and short end caps,
 * in display (screen) px. The layers draw in screen px, so the line keeps its width at any
 * zoom; the export multiplies these by its scale.
 */
/** Half-length of the caps across each end, in display px. */
export const RULER_TICK_PX = 5;
/** Line and cap stroke, in display px. */
export const RULER_STROKE_PX = 1.5;
/** The white outline under the line and caps, in display px. */
export const RULER_HALO_PX = 3.5;
/**
 * The outline's opacity (0.9) and colour (white) are literals in three places: inspect.module.css,
 * annotation-layer.module.css and the export in compositor.ts. Change them together.
 */
