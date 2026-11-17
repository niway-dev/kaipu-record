import { app } from "electron";
import type { TextRecognizer } from "@kaipu/domain/schemas";
import { activeFlagOverrides } from "../flag-overrides";
import { createTextRecognizer, textRecognitionHelperPath } from "./text-recognition";
import { parseTextRecognitionOverride } from "./text-recognition/dev-override";
import {
  fileHelperPresent,
  TextRecognitionWarmUp,
  WARM_UP_IDLE_DELAY_MS,
  withWarmUpGate,
} from "./text-recognition/warm-up";

interface TextRecognitionService {
  /** What the editor's IPC uses: it waits for a running warm-up (never two cold helpers). */
  recognizer: TextRecognizer;
  warmUp: TextRecognitionWarmUp;
}

let service: TextRecognitionService | null = null;

/** One recognizer and one warm-up per process, so the gate sees every request. */
export function getTextRecognitionService(): TextRecognitionService {
  if (service) return service;
  const appPath = app.isPackaged ? undefined : app.getAppPath();
  const raw = createTextRecognizer({
    resourcesPath: process.resourcesPath,
    appPath,
    isPackaged: app.isPackaged,
  });
  const helperPath = textRecognitionHelperPath(process.resourcesPath, appPath);
  const warmUp = new TextRecognitionWarmUp({
    recognizer: raw,
    platform: process.platform,
    helperPresent: fileHelperPresent(helperPath),
    devOverrideActive:
      parseTextRecognitionOverride(process.env.KAIPU_TEXT_RECOGNITION, {
        isPackaged: app.isPackaged,
      }).override !== null,
    scheduleIdle: (run) => void setTimeout(run, WARM_UP_IDLE_DELAY_MS).unref(),
  });
  service = { recognizer: withWarmUpGate(raw, warmUp), warmUp };
  return service;
}

/**
 * Starts the background warm-up (call after `app.whenReady`). A local `KAIPU_FLAG_OVERRIDES`
 * pin for `image-text` decides straight away; otherwise it waits for the renderer's report.
 */
export function startTextRecognitionWarmUp(): void {
  const { warmUp } = getTextRecognitionService();
  warmUp.start();
  const override = activeFlagOverrides()["image-text"];
  if (override !== undefined) warmUp.setEnabled(override);
}

/** The renderer's resolved `image-text` flag; a local override wins over it. */
export function reportImageTextFlag(enabled: boolean): void {
  if (activeFlagOverrides()["image-text"] !== undefined) return;
  getTextRecognitionService().warmUp.setEnabled(enabled);
}

/**
 * The Developer page pinned `image-text` (`true`/`false`) or cleared it (`undefined`). A pin
 * starts or stops the warm-up now; a cleared pin leaves it to the renderer's next report.
 */
export function applyImageTextOverride(override: boolean | undefined): void {
  if (override !== undefined) getTextRecognitionService().warmUp.setEnabled(override);
}
