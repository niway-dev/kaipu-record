import { useEffect, useState } from "react";

/**
 * Whether the page has scrolled past `threshold` pixels.
 *
 * The server renders `false` (the top of the page). The first check runs on
 * mount, so a reload that restores the scroll position mid-page picks up the
 * right answer straight away instead of waiting for the next scroll event.
 */
export function useScrolled(threshold = 8): boolean {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > threshold);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [threshold]);

  return scrolled;
}
