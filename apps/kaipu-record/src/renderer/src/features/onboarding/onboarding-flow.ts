import type { ShortcutAction } from "@shared/types";
import type { TranscriptionModelInfo, TranscriptionStatus } from "@shared/types/transcription";

/**
 * The onboarding's navigation rules, free of React so they are unit-tested on their own.
 * One rule shapes all of them: only Permissions blocks (screen + microphone).
 */

export type StepId =
  | "welcome"
  | "permissions"
  | "shortcuts"
  | "transcription"
  | "privacy"
  | "done";

export interface StepsOptions {
  /** Whether the local transcription model is on offer (see `transcriptionOfferModel`). */
  offerTranscription: boolean;
}

/**
 * The steps in order. Transcription sits between Shortcuts and Privacy and exists only when the
 * model is on offer; without it the flow is exactly the five steps it had before.
 */
export function stepsFor({ offerTranscription }: StepsOptions): readonly StepId[] {
  return offerTranscription
    ? ["welcome", "permissions", "shortcuts", "transcription", "privacy", "done"]
    : ["welcome", "permissions", "shortcuts", "privacy", "done"];
}

/** Permissions is the second step whichever steps are on offer: only later ones come and go. */
const PERMISSIONS_INDEX = stepsFor({ offerTranscription: false }).indexOf("permissions");

/**
 * The model the Transcription step offers, or `null` when there is nothing to offer: the
 * engine cannot run here, the default model is missing from the catalog, or it is already
 * installed or downloading. Only `missing` and `failed` (a download that did not finish) are
 * offered. The `transcription` flag is checked by the caller.
 */
export function transcriptionOfferModel(
  status: TranscriptionStatus | null,
): TranscriptionModelInfo | null {
  if (!status || status.availability.status !== "available") return null;
  const model = status.models.find((m) => m.id === status.defaultModelId);
  if (!model) return null;
  return model.status.state === "missing" || model.status.state === "failed" ? model : null;
}

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
