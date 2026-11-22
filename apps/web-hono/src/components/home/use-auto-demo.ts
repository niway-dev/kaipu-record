import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import { AUTO_STEP_MS, nextMode, type HeroMode } from "./hero-modes";

/** The countdown's resolution. Coarse enough to be cheap, fine enough for a smooth ring. */
export const AUTO_TICK_MS = 100;

/**
 * - `running`: counting down to the next step.
 * - `paused`: the visitor pressed pause, or the browser asked for reduced motion.
 * - `holding`: the visitor is using the demo (pointer down, hovering the screen,
 *   keyboard focus in it) or has work on it (marks drawn, a clip playing, an export).
 * - `away`: the tab is hidden or the hero is scrolled out of view.
 */
export type AutoStatus = "running" | "paused" | "holding" | "away";

type Zone = {
  onPointerEnter?: (e: React.PointerEvent) => void;
  onPointerLeave?: (e: React.PointerEvent) => void;
  onPointerDown: () => void;
  onFocus: (e: React.FocusEvent) => void;
  onBlur: (e: React.FocusEvent) => void;
};

/** Keyboard focus only: a mouse click leaves focus on a button, and that must not freeze the demo. */
function isKeyboardFocus(target: EventTarget): boolean {
  try {
    return (target as Element).matches(":focus-visible");
  } catch {
    return true;
  }
}

/**
 * The hero's auto demo: after AUTO_STEP_MS on a step it asks for the next one,
 * Overview → Record → Screenshot → Edit → Export → Overview. It only ever counts
 * while nothing is in the visitor's way, and it never changes the screen under
 * someone who is using it.
 *
 * Holds are named reasons not to advance. The stage's steps report their own
 * (`hold("edit-marks", true)`), and the zone props below report pointer and
 * keyboard use. A hold that ends restarts the full countdown, so the visitor
 * always gets a whole interval after they stop.
 */
export function useAutoDemo({
  mode,
  onAdvance,
  rootRef,
}: {
  mode: HeroMode;
  onAdvance: (next: HeroMode) => void;
  /** The hero's section: the demo pauses while it is scrolled out of view. */
  rootRef: RefObject<Element | null>;
}) {
  const [userPaused, setUserPaused] = useState(false);
  const [holders, setHolders] = useState<ReadonlySet<string>>(() => new Set());
  const [hidden, setHidden] = useState(false);
  const [offscreen, setOffscreen] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const advance = useRef(onAdvance);
  useEffect(() => {
    advance.current = onAdvance;
  });

  // Reduced motion starts paused (and pauses if it is turned on later). The visitor can still press play.
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (query.matches) setUserPaused(true);
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setUserPaused(true);
    };
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);

  useEffect(() => {
    const sync = () => setHidden(document.visibilityState === "hidden");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const last = entries[entries.length - 1];
        if (last) setOffscreen(last.intersectionRatio < 0.15);
      },
      { threshold: [0, 0.15] },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [rootRef]);

  const hold = useCallback((id: string, active: boolean) => {
    setHolders((prev) => {
      if (prev.has(id) === active) return prev;
      const next = new Set(prev);
      if (active) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const status: AutoStatus = userPaused
    ? "paused"
    : holders.size > 0
      ? "holding"
      : hidden || offscreen
        ? "away"
        : "running";

  useEffect(() => {
    if (status !== "running") return;
    const id = setInterval(() => setElapsed((e) => e + AUTO_TICK_MS), AUTO_TICK_MS);
    return () => clearInterval(id);
  }, [status]);

  useEffect(() => {
    if (elapsed < AUTO_STEP_MS) return;
    setElapsed(0);
    advance.current(nextMode(mode));
  }, [elapsed, mode]);

  // A different step (picked or advanced) and the end of a hold both start a full interval.
  useEffect(() => setElapsed(0), [mode]);
  const holding = holders.size > 0;
  useEffect(() => {
    if (!holding) setElapsed(0);
  }, [holding]);

  // Releasing the pointer anywhere ends the "press" hold, even if it left the demo mid-drag.
  useEffect(() => {
    const release = () => hold("press", false);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, [hold]);

  const zone = (hover: boolean): Zone => ({
    ...(hover && {
      onPointerEnter: (e: React.PointerEvent) => e.pointerType === "mouse" && hold("hover", true),
      onPointerLeave: () => hold("hover", false),
    }),
    onPointerDown: () => hold("press", true),
    onFocus: (e) => hold("focus", isKeyboardFocus(e.target)),
    onBlur: (e) => {
      if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) {
        hold("focus", false);
      }
    },
  });

  return {
    status,
    playing: !userPaused,
    next: nextMode(mode),
    progress: Math.min(1, elapsed / AUTO_STEP_MS),
    secondsLeft: Math.max(1, Math.ceil((AUTO_STEP_MS - elapsed) / 1000)),
    toggle: () => setUserPaused((p) => !p),
    restart: () => setElapsed(0),
    hold,
    /** For the screen: hovering with a mouse, pressing and keyboard focus all hold. */
    stageProps: zone(true),
    /** For the picker and the pause control: pressing and keyboard focus hold. */
    barProps: zone(false),
  };
}

/** Reports a hold for as long as `active` is true, and releases it when the step unmounts. */
export function useHold(hold: (id: string, active: boolean) => void, id: string, active: boolean) {
  useEffect(() => {
    hold(id, active);
    return () => hold(id, false);
  }, [hold, id, active]);
}
