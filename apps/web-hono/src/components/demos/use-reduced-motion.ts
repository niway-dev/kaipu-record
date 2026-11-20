/**
 * Ported from apps/kaipu-record/src/renderer/src/features/onboarding/demos/use-reduced-motion.ts
 * (the desktop onboarding demos). Copied, not shared: a shared package is a follow-up.
 * Keep the choreography in sync by hand until then.
 */
import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

const getSnapshot = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia(QUERY).matches;

/** True while the OS asks for reduced motion. Live: follows a change without a reload. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
