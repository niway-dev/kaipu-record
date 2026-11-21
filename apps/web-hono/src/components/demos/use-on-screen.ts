import { useEffect, useRef, useState } from "react";

/**
 * Whether the element is on screen right now, for pausing animation that nobody can see.
 *
 * Starts as `true` on purpose: a server-rendered or script-less page must never show a
 * paused scene (an animation at second 0 is often an invisible one). The first observer
 * callback corrects it. Without IntersectionObserver the element is treated as visible.
 */
export function useOnScreen<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [onScreen, setOnScreen] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry) setOnScreen(entry.isIntersecting);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, onScreen };
}
