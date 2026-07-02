/**
 * The "hand-drawn" look — ported from the design. A seeded RNG jitters each path
 * point; drawing a shape as two offset strokes gives the sketchy double-line.
 * Pure + deterministic for a given seed (so shapes don't wiggle on re-render).
 */

function rseed(seed: number): () => number {
  let s = seed % 233280 || 1;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/** SVG path for a jittered rounded rect from (0,0) to (w,h). */
export function roughRect(w: number, h: number, rad: number, seed: number): string {
  const rnd = rseed(seed);
  const m = 1.7;
  const j = (): number => (rnd() * 2 - 1) * m;
  const r = Math.min(rad, w / 2, h / 2);
  return (
    `M ${r + j()} ${j()}` +
    ` L ${w - r + j()} ${j()}` +
    ` Q ${w + j()} ${j()} ${w + j()} ${r + j()}` +
    ` L ${w + j()} ${h - r + j()}` +
    ` Q ${w + j()} ${h + j()} ${w - r + j()} ${h + j()}` +
    ` L ${r + j()} ${h + j()}` +
    ` Q ${j()} ${h + j()} ${j()} ${h - r + j()}` +
    ` L ${j()} ${r + j()}` +
    ` Q ${j()} ${j()} ${r + j()} ${j()} Z`
  );
}

/**
 * SVG path for a curved arrow from (x1,y1) to (x2,y2), with an arrowhead.
 *
 * `scale` scales the intrinsic pixel constants (curve bow, jitter, arrowhead
 * length) so they stay proportional at the export's native resolution — the
 * coordinates are in native px there (2–3× on Retina) while these constants are
 * authored in display px, so without scaling the exported arrow had a tiny
 * arrowhead and an almost-flat curve vs the preview. Preview passes scale=1.
 */
export function roughArrow(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  seed: number,
  scale = 1,
): string {
  const rnd = rseed(seed);
  const j = (m: number): number => (rnd() * 2 - 1) * m * scale;
  const mx = (x1 + x2) / 2 + j(10);
  const my = (y1 + y2) / 2 - 16 * scale + j(6);
  const body = `M ${x1 + j(2)} ${y1 + j(2)} Q ${mx} ${my} ${x2 + j(1.5)} ${y2 + j(1.5)}`;
  const ang = Math.atan2(y2 - my, x2 - mx);
  const ah = 15 * scale;
  const a1x = x2 - ah * Math.cos(ang - 0.45);
  const a1y = y2 - ah * Math.sin(ang - 0.45);
  const a2x = x2 - ah * Math.cos(ang + 0.45);
  const a2y = y2 - ah * Math.sin(ang + 0.45);
  return `${body} M ${a1x} ${a1y} L ${x2} ${y2} L ${a2x} ${a2y}`;
}
