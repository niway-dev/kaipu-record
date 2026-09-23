import { TriangleAlert } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import {
  ModalActions,
  ModalButton,
  ModalIcon,
  ModalOverlay,
  ModalText,
  ModalTitle,
} from "@renderer/ui/modal";
import styles from "./export-dialog.module.css";

export interface ExportDialogProps {
  status: "exporting" | "error";
  /** 0..1 — ignored while `status === "error"`. */
  fraction: number;
  error: string | null;
  onCancel(): void;
  onRetry(): void;
}

/**
 * Export progress / error modal. Reuses the app's `Modal.*` primitives (same
 * shell as the discard-changes dialog on this page) — while exporting it shows a
 * determinate progress bar; on failure it swaps to a message + Reintentar/Cerrar.
 * There is no "success" state: the hook resets to idle and the page navigates
 * away right after, which unmounts this dialog.
 */
export function ExportDialog({
  status,
  fraction,
  error,
  onCancel,
  onRetry,
}: ExportDialogProps): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const percent = Math.round(Math.min(1, Math.max(0, fraction)) * 100);

  if (status === "error") {
    return (
      <ModalOverlay onCancel={onCancel} labelledBy="export-dialog-title">
        <ModalIcon tone="danger">
          <TriangleAlert size={20} strokeWidth={1.8} />
        </ModalIcon>
        <ModalTitle id="export-dialog-title">{t("exportError")}</ModalTitle>
        <ModalText>{error}</ModalText>
        <ModalActions>
          <ModalButton variant="ghost" onClick={onCancel}>
            {t("close")}
          </ModalButton>
          <ModalButton variant="primary" onClick={onRetry}>
            {t("retry")}
          </ModalButton>
        </ModalActions>
      </ModalOverlay>
    );
  }

  return (
    <ModalOverlay onCancel={onCancel} labelledBy="export-dialog-title">
      <ModalTitle id="export-dialog-title">{t("exporting")}</ModalTitle>
      <div
        className={styles.progressTrack}
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={styles.progressFill} style={{ width: `${percent}%` }} />
      </div>
      {/* v2: the export burns zoom/blur/cover in; the original on disk keeps everything. */}
      <ModalText>{t("exportOriginalNote")}</ModalText>
      <ModalText>{percent}%</ModalText>
      <ModalActions>
        <ModalButton variant="ghost" onClick={onCancel}>
          {t("cancel")}
        </ModalButton>
      </ModalActions>
    </ModalOverlay>
  );
}
