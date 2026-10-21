import { Trash2, TriangleAlert } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import {
  ModalActions,
  ModalButton,
  ModalIcon,
  ModalOverlay,
  ModalText,
  ModalTitle,
} from "@kaipu/ui";

interface DiscardChangesDialogProps {
  /** Copy tuned to whether the shot was ever saved — a fresh capture is lost entirely. */
  neverSaved: boolean;
  onDiscard(): void;
  onCancel(): void;
}

/** Shown when leaving the editor with unsaved changes (in-app navigation blocked by
 *  useBlocker). A fresh capture that was never saved is gone for good if discarded. */
export function DiscardChangesDialog({
  neverSaved,
  onDiscard,
  onCancel,
}: DiscardChangesDialogProps): React.JSX.Element {
  const t = useTranslations("screenshots");
  return (
    <ModalOverlay onCancel={onCancel} labelledBy="discard-dialog-title">
      <ModalIcon tone="danger">
        <TriangleAlert size={20} strokeWidth={1.8} />
      </ModalIcon>
      <ModalTitle id="discard-dialog-title">{t("discardTitle")}</ModalTitle>
      <ModalText>{neverSaved ? t("discardBodyNeverSaved") : t("discardBody")}</ModalText>
      <ModalActions>
        <ModalButton variant="ghost" onClick={onCancel}>
          {t("keepEditing")}
        </ModalButton>
        <ModalButton variant="danger" onClick={onDiscard}>
          <Trash2 size={15} strokeWidth={1.8} />
          {t("discard")}
        </ModalButton>
      </ModalActions>
    </ModalOverlay>
  );
}
