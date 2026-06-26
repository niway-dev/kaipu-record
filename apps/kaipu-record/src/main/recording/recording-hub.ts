import { BrowserWindow, ipcMain } from "electron";
import { IPC_CHANNELS } from "@shared/types";
import type {
  ControlCommand,
  RecordingFinalizeMeta,
  RecordingStartInfo,
  RecordingTick,
} from "@shared/types/ipc";
import { ControlBarWindow } from "./control-bar-window";
import { RecordingWriter, timestampId } from "./recording-writer";
import { vaultDirectory } from "../library/vault-location";

/**
 * The single stateful coordinator for a recording. Owns the control-bar window
 * and relays between the (hidden) recorder window and the bar:
 *   recorder → report-tick → hub → control:tick → bar
 *   bar → control:command → hub → recording:command → recorder
 * It also hides/restores the main window so only the bar is visible while
 * recording, and registers the disk-writer IPC handlers.
 */
export function registerRecordingHub(getMainWindow: () => BrowserWindow | null): void {
  const bar = new ControlBarWindow();
  const writer = new RecordingWriter({
    vaultDir: () => vaultDirectory().path,
    newId: () => timestampId(Date.now()),
  });

  // ── Disk writer ──────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.recordingCreate, (_e, sessionId: string) => writer.create(sessionId));
  ipcMain.on(
    IPC_CHANNELS.recordingWrite,
    (_e, sessionId: string, data: ArrayBuffer, position: number) => {
      void writer.write(sessionId, data, position).catch((error) => {
        console.error("recording write failed", error);
      });
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.recordingFinalize,
    (_e, sessionId: string, meta: RecordingFinalizeMeta) => writer.finalize(sessionId, meta),
  );
  ipcMain.handle(IPC_CHANNELS.recordingAbort, (_e, sessionId: string) => writer.abort(sessionId));

  // ── Window orchestration ────────────────────────────────────────────
  ipcMain.on(IPC_CHANNELS.recordingStart, (_e, _info: RecordingStartInfo) => {
    getMainWindow()?.hide();
    bar.show();
  });
  ipcMain.on(IPC_CHANNELS.recordingStop, () => {
    bar.hide();
    const main = getMainWindow();
    main?.show();
    main?.focus();
  });

  // ── Relay ────────────────────────────────────────────────────────────
  ipcMain.on(IPC_CHANNELS.recordingReportTick, (_e, tick: RecordingTick) => {
    bar.send(IPC_CHANNELS.controlTick, tick);
  });
  ipcMain.on(IPC_CHANNELS.controlCommand, (_e, command: ControlCommand) => {
    getMainWindow()?.webContents.send(IPC_CHANNELS.recordingCommand, command);
  });
}
