import type { ShortcutAction } from "@shared/types";

/**
 * The onboarding's navigation rules, free of React so they are unit-tested on their own.
 * One rule shapes all of them: only Permissions blocks (screen + microphone).
 */

export type StepId = "welcome" | "permissions" | "shortcuts" | "done";

export const STEPS: readonly StepId[] = ["welcome", "permissions", "shortcuts", "done"];

const PERMISSIONS_INDEX = STEPS.indexOf("permissions");

/** The four shortcuts the Shortcuts step teaches, in card order. Window capture is not one. */
export const ONBOARDING_SHORTCUTS: readonly ShortcutAction[] = [
  "captureScreenshot",
  "startRecording",
  "captureInstant",
  "bringToFront",
];

/** Whether the primary button can move on from `step`. */
export function canAdvanceFrom(step: StepId, requiredMet: boolean): boolean {
  return step !== "permissions" || requiredMet;
}

/**
 * Whether a footer dot may jump from `from` to `to`. Going back is always allowed; a
 * forward move is refused only when it would cross Permissions (from at or before it) while
 * the required permissions are missing. A user already past Permissions (say, on Shortcuts
 * after revoking the microphone in System Settings) can still move forward.
 */
export function canJumpTo(from: number, to: number, requiredMet: boolean): boolean {
  return to <= from || requiredMet || to <= PERMISSIONS_INDEX || from > PERMISSIONS_INDEX;
}

/**
 * What the small link under the primary button does on `step`:
 * - `toPermissions`: before permissions it is "Skip to permissions";
 * - `blocked`: on Permissions, until they are met, it only says why Continue is off;
 * - `close`: once they are met it is "Skip the tour" and closes the onboarding;
 * - `none`: the last step has no link.
 */
export type SkipAction = "toPermissions" | "blocked" | "close" | "none";

export function skipActionFor(step: StepId, requiredMet: boolean): SkipAction {
  if (step === "done") return "none";
  if (step === "welcome") return "toPermissions";
  if (step === "permissions" && !requiredMet) return "blocked";
  return "close";
}

/** How many of the four onboarding shortcuts were pressed. */
export function triedShortcutCount(tried: ReadonlySet<ShortcutAction>): number {
  return ONBOARDING_SHORTCUTS.filter((action) => tried.has(action)).length;
}
