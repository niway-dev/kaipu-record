import { useCallback } from "react";
import { useTranslations } from "@kaipu/i18n";
import {
  cancelVideoExport,
  startVideoExport,
  type StartExportArgs,
  useExportRunner,
  type VideoExportState,
} from "./export-runner";

export { exportTitle, type StartExportArgs, type VideoExportState } from "./export-runner";

export interface VideoExportController extends VideoExportState {
  /** Resolves false when another export is already running (one at a time). */
  start(args: StartExportArgs): Promise<boolean>;
  cancel(): void;
}

/**
 * The app-level export runner (`export-runner.ts`) seen from a component: its state, and
 * start/cancel with this component's translations. The export itself does not belong to
 * the component — it keeps running in the background after the component unmounts.
 */
export function useVideoExport(): VideoExportController {
  const t = useTranslations("videoEditor");
  const { status, fraction, error, shrinking } = useExportRunner();
  const start = useCallback((args: StartExportArgs) => startVideoExport(args, t), [t]);
  return { status, fraction, error, shrinking, start, cancel: cancelVideoExport };
}
