import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, screen } from "electron";
import { createMainTranslator } from "@kaipu/i18n/main";
import { buildScreenshotCapturedProperties, SCREENSHOT_CAPTURED_EVENT } from "@shared/analytics";
import { IPC_CHANNELS } from "@shared/types/ipc";
import type { LocalRecording } from "@shared/types/library-storage";
import type { CaptureMode } from "@shared/types/screenshot-capture";
import { assertExportPayload, exportFileName } from "./export-file-name";
import { createCaptureHandler, type CaptureWindowHooks } from "./capture-handler";
import { CaptureOverlayWindows } from "./capture-overlay-windows";
import type { OverlayPort } from "./overlay-port";
import { createScreenshotProvider } from "./screenshot-capture";
import { captureMainEvent } from "../services/analytics.service";
import { getAppSettings, updateAppSettings } from "../infrastructure/settings-store";
import { currentVault, screenshotFilePath } from "../library";

/** Stable, sortable id; mirrors the recording writer's timestamp scheme. */
function screenshotId(): string {
  return `screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

let overlayWindows: CaptureOverlayWindows | null = null;

/**
 * The overlay windows, created on first use: `BrowserWindow` and `screen` need a ready
 * app, and most sessions never open an overlay. Before `ready` a pick answers `cancelled`.
 */
const overlay: OverlayPort = {
  pick: async (ui, displays) => {
    if (!app.isReady()) return { kind: "cancelled" };
    // The real window listers (macOS JXA, Windows PowerShell) plug in here as
    // `new CaptureOverlayWindows({ windowLister })`; until then Window lists nothing.
    overlayWindows ??= new CaptureOverlayWindows();
    return overlayWindows.pick(ui, displays);
  },
  hideAll: async () => overlayWindows?.hideAll(),
  destroyAll: () => overlayWindows?.destroyAll(),
  setWindows: (list) => overlayWindows?.setWindows(list),
};

/** What the rest of main needs from the screenshot backend once it is registered. */
export interface ScreenshotHandlers {
  /** The modes this platform's provider can serve (the capture shortcuts fall back on it). */
  supportedModes(): CaptureMode[];
}

export function registerScreenshotHandlers(windows: CaptureWindowHooks): ScreenshotHandlers {
  const provider = createScreenshotProvider(process.platform);
  const handleCapture = createCaptureHandler({
    platform: process.platform,
    provider,
    overlay,
    windows,
    measure: (png) => nativeImage.createFromBuffer(png).getSize(),
    displayCount: () => screen.getAllDisplays().length,
    track: (event) =>
      captureMainEvent(SCREENSHOT_CAPTURED_EVENT, buildScreenshotCapturedProperties(event)),
    // Persisted and broadcast to every window, so the page and the tray follow.
    rememberMode: (mode) => {
      if (getAppSettings().screenshotMode !== mode) updateAppSettings({ screenshotMode: mode });
    },
  });
  ipcMain.handle(IPC_CHANNELS.screenshotCapture, (_event, request) => handleCapture(request));
  ipcMain.handle(IPC_CHANNELS.screenshotSupportedModes, () => provider.supportedModes());

  ipcMain.on(IPC_CHANNELS.screenshotReveal, () => windows.reveal());

  ipcMain.handle(IPC_CHANNELS.screenshotCopy, async (_e, png: ArrayBuffer) => {
    clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(png)));
  });

  ipcMain.handle(IPC_CHANNELS.screenshotCopyById, async (_e, id: string) => {
    const buf = await readFile(await screenshotFilePath(id));
    clipboard.writeImage(nativeImage.createFromBuffer(buf));
  });

  ipcMain.handle(IPC_CHANNELS.clipboardPeekImage, () => {
    const img = clipboard.readImage();
    return img.isEmpty() ? null : img.getSize();
  });

  ipcMain.handle(IPC_CHANNELS.clipboardReadImage, () => {
    const img = clipboard.readImage();
    if (img.isEmpty()) return null;
    const png = img.toPNG();
    const { width, height } = img.getSize();
    return {
      png: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
      width,
      height,
    };
  });

  ipcMain.handle(IPC_CHANNELS.screenshotReadBytes, async (_e, id: string): Promise<ArrayBuffer> => {
    const buf = await readFile(await screenshotFilePath(id));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  });

  ipcMain.handle(
    IPC_CHANNELS.screenshotSave,
    async (
      _e,
      png: ArrayBuffer,
      meta: { title: string; overwriteId?: string; manual?: boolean },
    ): Promise<LocalRecording> => {
      const id = meta.overwriteId ?? screenshotId();
      const vault = currentVault();
      await vault.writeImage(id, Buffer.from(png));
      const now = Date.now();
      // Preserve the original createdAt when overwriting; stamp it for a new item.
      // A save the user asked for (not the capture's auto-save) is editor work, so
      // it puts the shot on the Editor home's Continue list.
      await vault.writeMeta(id, {
        title: meta.title,
        ...(meta.overwriteId ? {} : { createdAt: now }),
        ...(meta.manual ? { editorSavedAt: now } : {}),
      });
      const saved = await vault.describe(id);
      if (!saved) throw new Error(`screenshot save: could not describe ${id} after writing`);
      return saved;
    },
  );

  // Exports (PDF) are files to hand to someone, not library items: they go where
  // the user says, outside the vault, so the library never has to understand them.
  ipcMain.handle(
    IPC_CHANNELS.screenshotExportFile,
    async (
      event,
      bytes: unknown,
      meta: { suggestedName: string; extension: string },
    ): Promise<{ path: string } | null> => {
      // Validate before any dialog: main decides which bytes reach the user's disk.
      assertExportPayload(bytes, meta?.extension);
      const window = BrowserWindow.fromWebContents(event.sender);
      const t = createMainTranslator(getAppSettings().locale);
      const options: Electron.SaveDialogOptions = {
        title: t("dialogs.exportPdfTitle"),
        defaultPath: join(
          app.getPath("downloads"),
          exportFileName(String(meta.suggestedName ?? ""), meta.extension),
        ),
        filters: [{ name: t("dialogs.pdfFileType"), extensions: [meta.extension] }],
      };
      const result = window
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return null;
      await writeFile(result.filePath, Buffer.from(bytes));
      return { path: result.filePath };
    },
  );

  return { supportedModes: () => provider.supportedModes() };
}
