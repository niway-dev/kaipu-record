import { Trash2, TriangleAlert } from "lucide-react";
import {
  ModalActions,
  ModalButton,
  ModalIcon,
  ModalOverlay,
  ModalText,
  ModalTitle,
} from "@renderer/ui/modal";

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
  return (
    <ModalOverlay onCancel={onCancel} labelledBy="discard-dialog-title">
      <ModalIcon tone="danger">
        <TriangleAlert size={20} strokeWidth={1.8} />
      </ModalIcon>
      <ModalTitle id="discard-dialog-title">Descartar cambios sin guardar</ModalTitle>
      <ModalText>
        {neverSaved
          ? "Esta captura no está guardada en tu biblioteca. Si sales ahora, se pierde."
          : "Tienes ediciones sin guardar. Si sales ahora, se pierden."}
      </ModalText>
      <ModalActions>
        <ModalButton variant="ghost" onClick={onCancel}>
          Seguir editando
        </ModalButton>
        <ModalButton variant="danger" onClick={onDiscard}>
          <Trash2 size={15} strokeWidth={1.8} />
          Descartar
        </ModalButton>
      </ModalActions>
    </ModalOverlay>
  );
}
