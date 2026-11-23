/**
 * "Save this text where I choose" (NIW2-818 M3: the transcript as SRT, VTT or TXT). Every
 * argument comes from the renderer, so it is checked here before a dialog opens: main decides
 * which formats and how many bytes reach the user's disk. Like PDF exports, the file goes where
 * the user says, outside the vault.
 */
import { join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { createMainTranslator } from "@kaipu/i18n/main";
import { IPC_CHANNELS } from "@shared/types/ipc";
import {
  MAX_SAVE_TEXT_BYTES,
  SAVE_TEXT_EXTENSIONS,
  type SaveTextExtension,
  type SaveTextFileRequest,
  type SaveTextFileResult,
} from "@shared/types/save-text-file";
import { atomicWriteFile } from "./library/atomic-write";
import { getAppSettings } from "./infrastructure/settings-store";
import { exportFileName } from "./screenshots/export-file-name";

const MAX_NAME_LENGTH = 512;

/** A video title carries dates and colons: every character a file name refuses becomes a dash. */
export function saveTextFileName(title: string, extension: SaveTextExtension): string {
  return exportFileName(title, extension, "transcript");
}

/** Throws on anything the renderer should never send. Pure; exported for tests. */
export function parseSaveTextRequest(value: unknown): SaveTextFileRequest {
  const request = value as Partial<Record<keyof SaveTextFileRequest, unknown>> | null;
  if (typeof request !== "object" || request === null)
    throw new Error("save-text: invalid request");
  const { suggestedName, extension, text } = request;
  if (typeof suggestedName !== "string" || suggestedName.length > MAX_NAME_LENGTH) {
    throw new Error("save-text: invalid name");
  }
  if (!SAVE_TEXT_EXTENSIONS.includes(extension as SaveTextExtension)) {
    throw new Error(`save-text: format "${String(extension)}" is not allowed`);
  }
  if (typeof text !== "string" || text.length === 0) throw new Error("save-text: text is empty");
  if (Buffer.byteLength(text, "utf8") > MAX_SAVE_TEXT_BYTES) {
    throw new Error("save-text: text is too large");
  }
  return { suggestedName, extension: extension as SaveTextExtension, text };
}

export function registerSaveTextFileIpc(): void {
  ipcMain.handle(
    IPC_CHANNELS.saveTextFile,
    async (event, raw: unknown): Promise<SaveTextFileResult> => {
      const request = parseSaveTextRequest(raw);
      const window = BrowserWindow.fromWebContents(event.sender);
      const t = createMainTranslator(getAppSettings().locale);
      const options: Electron.SaveDialogOptions = {
        title: t("dialogs.saveTranscriptTitle"),
        defaultPath: join(
          app.getPath("downloads"),
          saveTextFileName(request.suggestedName, request.extension),
        ),
        filters: [
          {
            name: t(`dialogs.fileType_${request.extension}`),
            extensions: [request.extension],
          },
        ],
      };
      const result = window
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return { status: "cancelled" };
      try {
        await atomicWriteFile(result.filePath, request.text);
      } catch (error) {
        console.error("save-text: write failed", error);
        return { status: "failed" };
      }
      return { status: "saved", path: result.filePath };
    },
  );
}
