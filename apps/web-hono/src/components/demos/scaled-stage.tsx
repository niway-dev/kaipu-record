import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";

/**
 * Shrinks a fixed-size stage to the width of its card.
 *
 * The desktop demos draw a 660 x 330 stage in absolute pixels, which would force a
 * horizontal scroll on a phone. This measures the available width and scales the stage
 * down with a transform (never up), reserving the scaled height so the layout below does
 * not jump. Server render and first paint use scale 1, clipped by `overflow: hidden`, so
 * nothing ever widens the page.
 */
export function ScaledStage({
  width,
  height,
  children,
}: {
  width: number;
  height: number;
  children: ReactNode;
}): ReactElement {
  const outer = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const el = outer.current;
    if (!el) return;
    const measure = (): void => {
      const available = el.clientWidth;
      if (available <= 0) return;
      const next = Math.min(1, available / width);
      setScale(next);
      setOffset(Math.max(0, (available - width * next) / 2));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [width]);

  return (
    <div
      ref={outer}
      data-demo-scaled=""
      style={{ position: "relative", width: "100%", height: height * scale, overflow: "hidden" }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width,
          height,
          transform: `translateX(${offset}px) scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {children}
      </div>
    </div>
  );
}
