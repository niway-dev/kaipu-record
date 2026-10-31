import type { Translator } from "@kaipu/i18n";
import { showToast } from "@renderer/ui/toast-store";
import {
  AMBIGUOUS_IDENTITY_MARKER,
  ITEM_NOT_FOUND_MARKER,
  type RenameResult,
} from "@shared/types/library-storage";

const KEPT_MESSAGE = {
  locked: "renameKeptLocked",
  busy: "renameKeptBusy",
  editing: "renameKeptEditing",
  taken: "renameKeptTaken",
  io: "renameKeptError",
} as const;

/**
 * NIW2-560: a rename whose file kept its old name (locked, export running, name taken, I/O
 * error) still saved the title, so it is not an error: a non-blocking toast says so and offers
 * Retry.
 * Nothing is shown when the file moved or did not need to.
 */
export function notifyRenameOutcome(
  result: RenameResult,
  t: { library: Translator<"library">; common: Translator<"common"> },
  retry: () => void,
): void {
  if (result.file !== "kept-old-name") return;
  showToast({
    message: t.library(KEPT_MESSAGE[result.reason ?? "io"]),
    action: { label: t.common("retry"), onClick: retry },
  });
}

/**
 * True for the rejection of a rename whose id no longer names a file — a double commit, or an
 * item deleted meanwhile. The caller refreshes quietly instead of reporting an error.
 */
export function isItemNotFoundError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(ITEM_NOT_FOUND_MARKER);
}

/**
 * True for the rejection of a vault operation that refused because two local files claim the
 * item's identity (a Finder copy made with its sidecar). Nothing changed; the caller shows
 * `notifyAmbiguousIdentity` instead of an error report — a retry would refuse again.
 */
export function isAmbiguousIdentityError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(AMBIGUOUS_IDENTITY_MARKER);
}

/** A plain toast, no Retry: the user has to remove the duplicate first. */
export function notifyAmbiguousIdentity(t: Translator<"library">): void {
  showToast({ message: t("itemAmbiguous") });
}
