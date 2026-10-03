import { Trash2 } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import {
  ModalActions,
  ModalButton,
  ModalIcon,
  ModalName,
  ModalOverlay,
  ModalText,
  ModalTitle,
} from "@kaipu/ui";

interface DeleteConfirmDialogProps {
  title: string;
  isDeleting?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteConfirmDialog({
  title,
  isDeleting,
  onCancel,
  onConfirm,
}: DeleteConfirmDialogProps): React.JSX.Element {
  const t = useTranslations("library");
  return (
    <ModalOverlay onCancel={onCancel} labelledBy="delete-dialog-title">
      <ModalIcon tone="danger">
        <Trash2 size={20} strokeWidth={1.8} />
      </ModalIcon>
      <ModalTitle id="delete-dialog-title">{t("deleteTitle")}</ModalTitle>
      <ModalText>
        <ModalName>{title || t("untitled")}</ModalName> {t("deleteBody")}
      </ModalText>
      <ModalActions>
        <ModalButton variant="ghost" onClick={onCancel}>
          {t("cancel")}
        </ModalButton>
        <ModalButton variant="danger" onClick={onConfirm} disabled={isDeleting}>
          {isDeleting ? t("deleting") : t("delete")}
        </ModalButton>
      </ModalActions>
    </ModalOverlay>
  );
}
