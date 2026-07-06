import { Copy, Save } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import {
  ModalActions,
  ModalButton,
  ModalIcon,
  ModalName,
  ModalOverlay,
  ModalText,
  ModalTitle,
} from "@renderer/ui/modal";

interface SaveOptionsDialogProps {
  title: string;
  onOverwrite(): void;
  onSaveCopy(): void;
  onCancel(): void;
}

/** Shown when saving a screenshot that already exists in the vault: overwrite it
 *  in place, or keep the original and store a new copy. */
export function SaveOptionsDialog({
  title,
  onOverwrite,
  onSaveCopy,
  onCancel,
}: SaveOptionsDialogProps): React.JSX.Element {
  const t = useTranslations("screenshots");
  return (
    <ModalOverlay onCancel={onCancel} labelledBy="save-dialog-title">
      <ModalIcon tone="accent">
        <Save size={20} strokeWidth={1.8} />
      </ModalIcon>
      <ModalTitle id="save-dialog-title">{t("saveChangesTitle")}</ModalTitle>
      <ModalText>
        <ModalName>{title}</ModalName> {t("saveOptionsBody")}
      </ModalText>
      <ModalActions>
        <ModalButton variant="ghost" onClick={onCancel}>
          {t("cancel")}
        </ModalButton>
        <ModalButton variant="ghost" onClick={onSaveCopy}>
          <Copy size={15} strokeWidth={1.8} />
          {t("saveCopy")}
        </ModalButton>
        <ModalButton variant="primary" onClick={onOverwrite}>
          <Save size={15} strokeWidth={1.8} />
          {t("overwrite")}
        </ModalButton>
      </ModalActions>
    </ModalOverlay>
  );
}
