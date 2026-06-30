import { Copy, Save } from "lucide-react";
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
  return (
    <ModalOverlay onCancel={onCancel} labelledBy="save-dialog-title">
      <ModalIcon tone="accent">
        <Save size={20} strokeWidth={1.8} />
      </ModalIcon>
      <ModalTitle id="save-dialog-title">Save changes</ModalTitle>
      <ModalText>
        <ModalName>{title}</ModalName> already exists. Overwrite it, or keep it and save a copy?
      </ModalText>
      <ModalActions>
        <ModalButton variant="ghost" onClick={onCancel}>
          Cancel
        </ModalButton>
        <ModalButton variant="ghost" onClick={onSaveCopy}>
          <Copy size={15} strokeWidth={1.8} />
          Save copy
        </ModalButton>
        <ModalButton variant="primary" onClick={onOverwrite}>
          <Save size={15} strokeWidth={1.8} />
          Overwrite
        </ModalButton>
      </ModalActions>
    </ModalOverlay>
  );
}
