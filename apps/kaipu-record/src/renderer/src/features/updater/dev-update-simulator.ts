/**
 * DEV-ONLY updater state simulator.
 *
 * `initAutoUpdater` returns early when the app is not packaged, so in `bun run dev`
 * the updater never produces anything but `idle` — which means the Updates UI cannot
 * be seen, let alone reviewed, without cutting two releases first. This lets the
 * Developer settings page force any state and watch the real components render it.
 *
 * Same guard idiom as `features/watermark/dev-override.ts`: every read is behind
 * `import.meta.env.DEV`, which the bundler replaces with a literal `false` in
 * production, so the whole branch is dead-code eliminated from a prod build. A user
 * cannot fake a "ready to install" banner by setting the localStorage key by hand.
 */

import { useSyncExternalStore } from "react";
import type { UpdateStatus } from "@shared/types";

const STORAGE_KEY = "kaipu:dev:update-status";

/** The states worth looking at, in the order a real update walks through them. */
export const DEV_UPDATE_SCENARIOS: ReadonlyArray<{ key: string; status: UpdateStatus }> = [
  { key: "off", status: { state: "idle" } },
  { key: "checking", status: { state: "checking" } },
  { key: "up-to-date", status: { state: "up-to-date", checkedAt: 0 } },
  { key: "available", status: { state: "available", version: "0.9.0", checkedAt: 0 } },
  { key: "downloading", status: { state: "downloading", version: "0.9.0", percent: 43 } },
  { key: "ready", status: { state: "ready", version: "0.9.0" } },
  {
    key: "error",
    status: { state: "error", message: "net::ERR_INTERNET_DISCONNECTED", checkedAt: 0 },
  },
];

const listeners = new Set<() => void>();

/** Subscribe to simulator changes. `useSyncExternalStore` contract. */
export function subscribeDevUpdateStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function buildStatus(key: string): UpdateStatus | null {
  if (key === "off") return null;
  const found = DEV_UPDATE_SCENARIOS.find((s) => s.key === key);
  if (!found) return null;
  // `checkedAt: 0` in the table is a placeholder; stamp it now so the
  // "last checked" line renders something a human recognises.
  if ("checkedAt" in found.status) return { ...found.status, checkedAt: Date.now() };
  return found.status;
}

/**
 * Cached because `useSyncExternalStore` requires a STABLE snapshot: stamping
 * `checkedAt` on every read would hand React a new object each time and spin it
 * forever. The cache is keyed by the selected scenario and invalidated on write.
 */
let snapshot: { key: string; status: UpdateStatus | null } | null = null;

/** The forced status, or `null` when the simulator is off. Always `null` in prod. */
export function readDevUpdateStatus(): UpdateStatus | null {
  if (!import.meta.env.DEV) return null;
  const key = readDevUpdateScenarioKey();
  if (snapshot?.key === key) return snapshot.status;
  snapshot = { key, status: buildStatus(key) };
  return snapshot.status;
}

/** Read the raw selected key, for the Developer page's own select. */
export function readDevUpdateScenarioKey(): string {
  if (!import.meta.env.DEV) return "off";
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "off";
  } catch {
    return "off";
  }
}

export function writeDevUpdateScenario(key: string): void {
  if (!import.meta.env.DEV) return;
  try {
    localStorage.setItem(STORAGE_KEY, key);
  } catch {
    /* localStorage unavailable — ignore */
  }
  snapshot = null;
  for (const listener of listeners) listener();
}

/**
 * The forced status, or `null` when the simulator is off. Always `null` in prod, where
 * the constant snapshot lets React bail out immediately.
 */
export function useDevUpdateStatus(): UpdateStatus | null {
  return useSyncExternalStore(subscribeDevUpdateStatus, readDevUpdateStatus, () => null);
}
