import { useTranslations } from "@kaipu/i18n";
import {
  recordingCaptureLabel,
  type RecordingCapture,
  type RecordingCaptureTranslate,
} from "@shared/recording-capture";
import { cx } from "@renderer/ui/cx";
import styles from "./recording-capture-tag.module.css";

/** The capture label as text ("FRAME · 16:9", "SCREEN"), or null without capture data. */
export function useRecordingCaptureLabel(
  capture: RecordingCapture | null | undefined,
): string | null {
  const t = useTranslations("library");
  return recordingCaptureLabel(capture, t as RecordingCaptureTranslate);
}

interface RecordingCaptureTagProps {
  capture: RecordingCapture | null | undefined;
  className?: string;
}

/**
 * A small translucent mono pill naming how a recording was captured. Renders nothing for
 * an item without capture metadata (older recordings, screenshots, cloud-only items).
 * Reusable outside the library (the Record page's recent grid).
 */
export function RecordingCaptureTag({
  capture,
  className,
}: RecordingCaptureTagProps): React.JSX.Element | null {
  const label = useRecordingCaptureLabel(capture);
  if (!label) return null;
  return (
    <span className={cx(styles.tag, className)} data-mode={capture?.mode}>
      {label}
    </span>
  );
}
