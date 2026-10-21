import { FINALIZE_ELSEWHERE_MARKER, FINALIZE_KEPT_MARKER } from "@shared/types/ipc";

export type FinalizeErrorKey =
  | "record.errorSave"
  | "record.errorSaveKept"
  | "record.errorSaveElsewhere";

/** Picks the toast key from the marker main put on the finalize rejection. */
export function finalizeErrorKey(error: unknown): FinalizeErrorKey {
  const text = error instanceof Error ? error.message : String(error);
  if (text.includes(FINALIZE_ELSEWHERE_MARKER)) return "record.errorSaveElsewhere";
  if (text.includes(FINALIZE_KEPT_MARKER)) return "record.errorSaveKept";
  return "record.errorSave";
}
