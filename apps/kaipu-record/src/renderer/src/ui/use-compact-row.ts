import { useLayoutEffect, type RefObject } from "react";

/**
 * Collapse a toolbar row to its compact form only when its content does not fit.
 *
 * The row is a flex container whose children are the groups it lays out (in the
 * screenshot editor: the annotation tools, then the actions). While the groups
 * fit side by side the row is left alone. Once their natural widths plus the
 * row's gap exceed its content box, the hook sets `data-compact="true"` on the
 * row and the stylesheet decides what gives (the action labels, in the editor).
 *
 * The decision comes from the row's real content — this locale's words, the
 * buttons present right now — rather than from a viewport breakpoint. A fixed
 * breakpoint has to be retuned for a longer translation or one more button, and
 * either fires while the row still has room or not until it has already
 * overflowed; measuring sidesteps both.
 *
 * Measures with the compact form switched off, so a collapsed row expands again
 * when the window grows. Re-measures when the row resizes and whenever
 * `revision` changes: content changes (a label flipping to its "done" wording, a
 * button appearing) do not resize the row, so the caller names them.
 */
export function useCompactRow(row: RefObject<HTMLElement | null>, revision: unknown): void {
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const measure = (): void => {
      el.dataset.compact = "false";
      const style = getComputedStyle(el);
      const available =
        el.clientWidth -
        (parseFloat(style.paddingLeft) || 0) -
        (parseFloat(style.paddingRight) || 0);
      const gap = parseFloat(style.columnGap) || 0;
      const groups = Array.from(el.children) as HTMLElement[];
      const needed =
        groups.reduce((sum, group) => sum + group.offsetWidth, 0) +
        gap * Math.max(0, groups.length - 1);
      el.dataset.compact = String(needed > available);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [row, revision]);
}
