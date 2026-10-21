import { useEffect, useState } from "react";

import { CHAPTERS, type ChapterId } from "./chapters";

/**
 * Which chapter the rail should show as active.
 *
 * The rule from the design system: the active section is the last one whose top
 * edge has passed the middle of the viewport. That is deliberately not
 * IntersectionObserver's "most visible" — with sections this tall, two of them
 * are on screen at once for most of a scroll, and "most visible" flickers
 * between them at the boundary. A single midpoint threshold cannot flicker.
 *
 * Reads layout on a rAF-throttled scroll listener rather than per event, so a
 * trackpad firing 120 scroll events a second still costs one measurement a frame.
 */
export function useActiveChapter(): ChapterId {
  const [active, setActive] = useState<ChapterId>("hero");

  useEffect(() => {
    let frame = 0;

    const measure = (): void => {
      frame = 0;
      const midpoint = window.innerHeight / 2;
      let current: ChapterId = CHAPTERS[0]!.id;
      for (const chapter of CHAPTERS) {
        const el = document.getElementById(chapter.slug);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= midpoint) current = chapter.id;
      }
      setActive(current);
    };

    const onScroll = (): void => {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    };

    measure(); // the page can load already scrolled (a refresh, or a #hash)
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return active;
}
