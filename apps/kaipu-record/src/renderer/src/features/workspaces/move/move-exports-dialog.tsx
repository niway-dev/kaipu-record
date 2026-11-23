import React from "react";
import { FolderInput } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import {
  ModalActions,
  ModalButton,
  ModalIcon,
  ModalOverlay,
  ModalText,
  ModalTitle,
} from "@kaipu/ui";
import { uiArea } from "@renderer/lib/ui-area";
import { useMoveUi } from "./move-store";

/**
 * Owns both prompts of a move and shows one at a time (the synced confirmation first), mounted
 * once beside the workspaces provider:
 * - "This recording has 2 exports in Work. Move them too?" (ADR 0033, decision 15): Move all 3
 *   (primary) or Move only the recording.
 * - The confirmation before a move out of a synced workspace (decision 15), which says the
 *   copy is checked before the original goes.
 */
export function MoveExportsDialogHost(): React.JSX.Element | null {
  const t = useTranslations("move");
  const { prompt, syncedPrompt } = useMoveUi();
  if (syncedPrompt) {
    return (
      <ModalOverlay onCancel={() => syncedPrompt.answer(false)} labelledBy="move-synced-title">
        <div {...uiArea("shell.moveSyncedDialog")}>
          <ModalIcon tone="danger">
            <FolderInput size={20} strokeWidth={1.8} />
          </ModalIcon>
          <ModalTitle id="move-synced-title">{t("syncedTitle")}</ModalTitle>
          <ModalText>{t("syncedBody", { name: syncedPrompt.source })}</ModalText>
          <ModalActions>
            <ModalButton variant="ghost" onClick={() => syncedPrompt.answer(false)}>
              {t("syncedCancel")}
            </ModalButton>
            <ModalButton variant="danger" onClick={() => syncedPrompt.answer(true)}>
              {t("syncedConfirm")}
            </ModalButton>
          </ModalActions>
        </div>
      </ModalOverlay>
    );
  }
  if (!prompt) return null;
  const many = prompt.selected > 1;
  return (
    <ModalOverlay onCancel={() => prompt.answer(null)} labelledBy="move-exports-title">
      <ModalIcon tone="accent">
        <FolderInput size={20} strokeWidth={1.8} />
      </ModalIcon>
      <ModalTitle id="move-exports-title">{t("exportsTitle")}</ModalTitle>
      <ModalText>
        {t(many ? "exportsBodyMany" : "exportsBody", { count: prompt.count, name: prompt.source })}
      </ModalText>
      <ModalActions>
        <ModalButton variant="ghost" onClick={() => prompt.answer("only")}>
          {t(many ? "moveOnlySelection" : "moveOnlyRecording")}
        </ModalButton>
        <ModalButton variant="primary" onClick={() => prompt.answer("all")}>
          {t("moveAll", { count: prompt.count + prompt.selected })}
        </ModalButton>
      </ModalActions>
    </ModalOverlay>
  );
}
