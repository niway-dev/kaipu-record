import React from "react";
import { useTranslations } from "@kaipu/i18n";
import { RecordButton as RecordButtonView } from "@kaipu/ui";

interface RecordButtonProps {
  isRecording: boolean;
  disabled?: boolean;
  shortcut?: string;
  variant?: "full" | "compact";
  onClick: () => void;
}

/** Dumb start/stop button. Recording state comes from `useRecordingSetup`;
 *  this wrapper only supplies the translated label. */
export function RecordButton({ isRecording, ...props }: RecordButtonProps): React.JSX.Element {
  const t = useTranslations("record");
  return (
    <RecordButtonView isRecording={isRecording} {...props}>
      {isRecording ? t("stopRecordingBtn") : t("startRecordingBtn")}
    </RecordButtonView>
  );
}
