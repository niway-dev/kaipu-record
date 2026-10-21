import React, { useSyncExternalStore } from "react";
import { useTranslations } from "@kaipu/i18n";
import {
  getRecorderSnapshot,
  stopOrCancelRecording,
  subscribeRecorder,
} from "@renderer/features/recording/recorder-store";
import { useRecordingActivity } from "@renderer/features/recording/hooks/use-recording-activity";
import { useScreenshotCapture } from "@renderer/features/screenshots/use-screenshot-capture";
import { CaptureModeButtons } from "@renderer/features/screenshots/capture-mode-buttons";
import { RecentScreenshots } from "@renderer/features/screenshots/recent-screenshots";
import { useShortcutLabels } from "@renderer/features/shortcuts/use-shortcut-labels";
import styles from "./screenshots-page.module.css";

export function ScreenshotsPage(): React.JSX.Element {
  const t = useTranslations("screenshots");
  const { capture } = useScreenshotCapture();
  const labels = useShortcutLabels();
  // The recorder runs in this window, so its store says whether a take (or its countdown)
  // is under way; the hub's activity broadcast carries the elapsed time.
  const recorder = useSyncExternalStore(subscribeRecorder, getRecorderSnapshot);
  const activity = useRecordingActivity();
  const recording =
    recorder.status !== "idle" || activity.active
      ? { elapsedSeconds: activity.elapsedSeconds }
      : null;
  return (
    <div className={styles.page}>
      <p className={styles.overline}>{t("overline")}</p>
      <h1 className={styles.title}>{t("pageTitle")}</h1>
      <p className={styles.subtitle}>{t("pageSubtitle")}</p>
      <CaptureModeButtons
        variant="page"
        onCapture={(mode) => void capture(mode)}
        shortcuts={labels}
        recording={recording}
        onStopRecording={stopOrCancelRecording}
      />
      <RecentScreenshots />
    </div>
  );
}
