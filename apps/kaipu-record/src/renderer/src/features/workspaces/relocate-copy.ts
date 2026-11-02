import type { useTranslations } from "@kaipu/i18n";
import type { WorkspaceRelocateResult } from "@shared/types/workspaces";

type Refused = Extract<WorkspaceRelocateResult, { ok: false }>;

/**
 * The sentence for a refused "Change folder…", or null when there is nothing to say (the user
 * closed the picker, or a window answered Cancel to an unsaved editor).
 */
export function relocateRefusalMessage(
  result: Refused,
  workspaceName: string,
  t: ReturnType<typeof useTranslations<"workspaces">>,
): string | null {
  const other = result.workspaceName ?? "";
  switch (result.reason) {
    case "cancelled":
      return null;
    case "not-a-workspace":
      return t("relocateNotWorkspace");
    case "has-items-no-identity":
      return t("relocateItemsNoWorkspace");
    case "different":
      return t("relocateDifferent", { other, name: workspaceName });
    case "already-registered":
      return t("relocateAlreadyRegistered", { other });
    case "unreadable":
      return t("relocateUnreadable");
    case "not-a-folder":
      return t("relocateNotAFolder");
    case "recording":
      return t("relocateRecording");
    case "exporting":
      return t("relocateExporting");
    case "moving":
      return t("relocateMoving");
    case "read-only":
      return t("readOnly");
    case "unknown":
      return t("removeRefusedUnknown");
    case "not-writable":
      return t("relocateNotWritable");
    default:
      return t("relocateFailed");
  }
}
