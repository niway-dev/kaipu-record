import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, screen } from "electron";
import { createMainTranslator } from "@kaipu/i18n/main";
import { buildScreenshotCapturedProperties, SCREENSHOT_CAPTURED_EVENT } from "@shared/analytics";
import { IPC_CHANNELS } from "@shared/types/ipc";
import type { LocalRecording } from "@shared/types/library-storage";
import type { CaptureMode, OverlayAnswer } from "@shared/types/screenshot-capture";
import { assertExportPayload, exportFileName } from "./export-file-name";
import { createCaptureHandler, type CaptureWindowHooks } from "./capture-handler";
import { CaptureOverlayWindows } from "./capture-overlay-windows";
import type { OverlayPort } from "./overlay-port";
import { createScreenshotProvider } from "./screenshot-capture";
import { createWindowLister } from "./window-lister";
import { captureMainEvent } from "../services/analytics.service";
import { getAppSettings, updateAppSettings } from "../infrastructure/settings-store";
import { screenshotFilePath } from "../library";
import { saveScreenshotToVault } from "./screenshot-save";
import type { CaptureToastShowRequest } from "./capture-toast-window";
import { deferToastUntilAfterCapture } from "./toast-after-capture";

let overlayWindows: CaptureOverlayWindows | null = null;
/** Told every overlay answer, so the toast lands on the display the shot came from. */
let observePick: (answer: OverlayAnswer) => void = () => {};

/**
 * The overlay windows, created on first use: `BrowserWindow` and `screen` need a ready
 * app, and most sessions never open an overlay. Before `ready` a pick answers `cancelled`.
 */
const overlay: OverlayPort = {
  pick: async (ui, displays) => {
    if (!app.isReady()) return { kind: "cancelled" };
    // macOS lists through osascript JXA, Windows through PowerShell; other platforms find
    // nothing. Our own windows are dropped by pid (plus HWND on Windows).
    overlayWindows ??= new CaptureOverlayWindows({
      windowLister: createWindowLister(process.platform),
    });
    const answer = await overlayWindows.pick(ui, displays);
    observePick(answer);
    return answer;
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

/** Longest side of the toast thumbnail, in px. */
const TOAST_THUMBNAIL_WIDTH = 160;

export function registerScreenshotHandlers(
  appWindows: CaptureWindowHooks,
  /**
   * The capture toast: called once per quiet capture, after `afterCapture` has put the
   * windows back, with the display the shot came from.
   */
  showToast?: (request: CaptureToastShowRequest) => void,
): ScreenshotHandlers {
  const provider = createScreenshotProvider(process.platform);
  const toastSeam = deferToastUntilAfterCapture(
    appWindows,
    (request) => showToast?.(request),
    // No overlay answered (Screen on a lone display): the display under the pointer.
    () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id,
  );
  observePick = toastSeam.onPick;
  const windows = toastSeam.windows;
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
    settings: () => {
      const { screenshotSave, screenshotCopy } = getAppSettings();
      return { save: screenshotSave, copy: screenshotCopy };
    },
    saveToVault: async (png, title) => {
      const saved = await saveScreenshotToVault(png, { title, manual: false });
      return { id: saved.id };
    },
    copyToClipboard: (png) => clipboard.writeImage(nativeImage.createFromBuffer(png)),
    thumbnail: (png) => {
      const image = nativeImage.createFromBuffer(png);
      const { width } = image.getSize();
      return (
        width > TOAST_THUMBNAIL_WIDTH ? image.resize({ width: TOAST_THUMBNAIL_WIDTH }) : image
      ).toDataURL();
    },
    onQuietCapture: toastSeam.onQuietCapture,
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
      return saveScreenshotToVault(Buffer.from(png), meta);
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
