/**
 * Pure updater state machine shared by both processes. No electron, no node, no
 * DOM — same idiom as `shared/version-gate.ts`.
 *
 * This file exists because the logic used to live inside `main/updater/auto-updater.ts`,
 * where the only way to exercise it was to package the app. That is how four of the six
 * events electron-updater emits came to be dropped without anyone noticing. Here the
 * rules are unit-testable, and the adapter in main stays dumb.
 */

import type { UpdateStatus } from "./types";

/**
 * 30 minutes between focus-triggered checks. Longer than the version gate's 10 min
 * (`VERSION_GATE_THROTTLE_MS`) on purpose: a check here can pull a ~125 MB download,
 * where the gate only fetches a small config.
 */
export const UPDATE_FOCUS_THROTTLE_MS = 30 * 60 * 1000;

/** What the adapter feeds in. One per electron-updater event, plus the manual trigger. */
export type UpdaterEvent =
  | { type: "check-started" }
  | { type: "available"; version: string; at: number }
  | { type: "not-available"; at: number }
  | { type: "progress"; version: string; percent: number }
  | { type: "downloaded"; version: string }
  | { type: "error"; message: string; at: number };

/** A downloaded build is on disk and installable — nothing may hide it. */
function isReady(status: UpdateStatus): boolean {
  return status.state === "ready";
}

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, Math.round(percent)));
}

/**
 * Fold one updater event into the current status.
 *
 * Three rules do the real work:
 *
 * 1. **A downloaded build outranks everything.** Once `ready`, a later failed or empty
 *    check must not mask it — the user has a working update waiting.
 * 2. **Progress only advances a download.** A stray `download-progress` against a resting
 *    status is ignored rather than inventing a download nobody started.
 * 3. **A completed check stamps `checkedAt`.** In-flight states carry no timestamp, so
 *    the UI can never render a stale one.
 */
export function nextUpdateStatus(current: UpdateStatus, event: UpdaterEvent): UpdateStatus {
  // Rule 1. `downloaded` itself is handled below; everything else leaves `ready` alone.
  if (isReady(current) && event.type !== "downloaded") return current;

  switch (event.type) {
    case "check-started":
      return { state: "checking" };

    case "not-available":
      return { state: "up-to-date", checkedAt: event.at };

    case "available":
      return { state: "available", version: event.version, checkedAt: event.at };

    case "progress": {
      // Rule 2: only a check that already found something can become a download.
      if (current.state !== "available" && current.state !== "downloading") return current;
      return {
        state: "downloading",
        version: event.version,
        percent: clampPercent(event.percent),
      };
    }

    case "downloaded":
      return { state: "ready", version: event.version };

    case "error":
      return { state: "error", message: event.message, checkedAt: event.at };
  }
}

/**
 * Whether a check may start now. `electron-updater` is not re-entrant while a download
 * is in flight, and the manual button is the first thing that makes a second call
 * reachable. `ready` also refuses: the build is already on disk, so there is nothing
 * left to look for until it is installed.
 */
export function canStartCheck(status: UpdateStatus): boolean {
  return status.state !== "checking" && status.state !== "downloading" && status.state !== "ready";
}

/**
 * Whether a window regaining focus should trigger a check. Kaipu is a menu-bar resident
 * app that can stay open for days, so focus — not launch — is the trigger that actually
 * fires. A backwards clock jump allows the check rather than locking it out.
 */
export function shouldCheckOnFocus(lastCheckStartedAt: number | null, now: number): boolean {
  if (lastCheckStartedAt === null) return true;
  const elapsed = now - lastCheckStartedAt;
  if (elapsed < 0) return true;
  return elapsed >= UPDATE_FOCUS_THROTTLE_MS;
}
