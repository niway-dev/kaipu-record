import { useEffect, useRef, useState } from "react";

/**
 * Reveal an element the first time it reaches the lower part of the viewport.
 *
 * The design system's rule is 82% of the viewport height: the mockup starts
 * shifted down and transparent, and lifts into place as the section arrives.
 * Expressed as a negative bottom root margin, which is what "the element has
 * crossed 82% down the screen" means to IntersectionObserver.
 *
 * It unobserves after the first hit on purpose. A reveal that replayed every
 * time you scrolled back up would turn a nice arrival into a flicker, and it
 * would keep an observer alive for the life of the page for no reason.
 *
 * Falls back to visible when IntersectionObserver is missing and during the
 * server render, so the content is never hidden by a script that did not run.
 */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setShown(true);
        observer.disconnect();
      },
      { rootMargin: "0px 0px -18% 0px" },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, shown };
}
