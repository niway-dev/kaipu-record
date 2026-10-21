import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Distance below the viewport at which a deferred section starts hydrating.
 * Generous on purpose: the section should be live well before it is on screen,
 * so deferring costs the visitor nothing they could notice.
 */
const ROOT_MARGIN = "400px 0px";

/** First-touch events that mean "someone is about to use this section". */
const INTERACTION_EVENTS = ["pointerover", "focusin", "touchstart"] as const;

/**
 * Defers the client work of a section until it approaches the viewport, while
 * keeping its server-rendered HTML in the document.
 *
 * The server renders `children` normally, so the text stays in the HTML that
 * crawlers and the first paint see. On the client the first render deliberately
 * produces an empty container with `dangerouslySetInnerHTML` and
 * `suppressHydrationWarning`: React then adopts the existing markup without
 * walking it or attaching anything to it. Once the section nears the viewport
 * (or the visitor touches it) `children` render for real.
 *
 * Be precise about what that last step is: React replaces the server markup
 * with an identical client render rather than hydrating it in place. Same
 * markup, same commit, so nothing moves.
 *
 * Two cases render immediately instead of waiting:
 * - no IntersectionObserver, so there is nothing to wait for;
 * - the container is empty after mount, which means this is a client-side
 *   navigation with no server markup to preserve.
 *
 * The wrapper is a plain block `div`: it adds no margin or padding, and
 * `display: contents` is unsafe next to the innerHTML trick.
 */
export function LazyHydrate({ children }: { children: ReactNode }) {
  // Server: render the children. Client: start dormant so hydration skips them.
  const [hydrated, setHydrated] = useState(() => typeof window === "undefined");
  const ref = useRef<HTMLDivElement>(null);

  // Layout effect so the client-navigation fallback lands before first paint.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && el.childElementCount === 0) setHydrated(true);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (hydrated || !el) return;

    if (typeof IntersectionObserver === "undefined") {
      setHydrated(true);
      return;
    }

    const wake = () => setHydrated(true);
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) wake();
      },
      { rootMargin: ROOT_MARGIN },
    );
    observer.observe(el);
    for (const type of INTERACTION_EVENTS) {
      el.addEventListener(type, wake, { once: true, passive: true });
    }

    return () => {
      observer.disconnect();
      for (const type of INTERACTION_EVENTS) el.removeEventListener(type, wake);
    };
  }, [hydrated]);

  if (hydrated) return <div ref={ref}>{children}</div>;
  return <div ref={ref} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: "" }} />;
}
