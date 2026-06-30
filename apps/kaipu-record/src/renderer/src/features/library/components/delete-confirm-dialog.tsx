import { Trash2 } from "lucide-react";
import {
  ModalActions,
  ModalButton,
  ModalIcon,
  ModalName,
  ModalOverlay,
  ModalText,
  ModalTitle,
} from "@renderer/ui/modal";

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
  return (
    <ModalOverlay onCancel={onCancel} labelledBy="delete-dialog-title">
      <ModalIcon tone="danger">
        <Trash2 size={20} strokeWidth={1.8} />
      </ModalIcon>
      <ModalTitle id="delete-dialog-title">Delete recording?</ModalTitle>
      <ModalText>
        <ModalName>{title || "Untitled recording"}</ModalName> will be permanently removed from your
        vault. This can&apos;t be undone.
      </ModalText>
      <ModalActions>
        <ModalButton variant="ghost" onClick={onCancel}>
          Cancel
        </ModalButton>
        <ModalButton variant="danger" onClick={onConfirm} disabled={isDeleting}>
          {isDeleting ? "Deleting…" : "Delete"}
        </ModalButton>
      </ModalActions>
    </ModalOverlay>
  );
}
