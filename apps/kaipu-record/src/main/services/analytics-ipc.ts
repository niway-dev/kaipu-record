import { ipcMain } from "electron";
import { IPC_CHANNELS } from "@shared/types";
import { type SerializedError } from "@shared/analytics";
import { captureSerializedException } from "./analytics.service";

/** Register the IPC sink that captures exceptions forwarded from secondary windows. */
export function registerAnalyticsIpc(): void {
  ipcMain.on(
    IPC_CHANNELS.analyticsCaptureException,
    (_e, payload: SerializedError, origin: string, context?: Record<string, unknown>) => {
      captureSerializedException(payload, origin, context);
    },
  );
}
