import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, screen } from "electron";
import { createMainTranslator } from "@kaipu/i18n/main";
import { buildScreenshotCapturedProperties, SCREENSHOT_CAPTURED_EVENT } from "@shared/analytics";
import { IPC_CHANNELS } from "@shared/types/ipc";
import type { LocalRecording } from "@shared/types/library-storage";
import {
  isEnabledCaptureMode,
  type CaptureIntent,
  type CaptureMode,
  type OverlayAnswer,
} from "@shared/types/screenshot-capture";
import { assertExportPayload, exportFileName } from "./export-file-name";
import {
  createCaptureHandler,
  type CaptureWindowHooks,
  type RecordTarget,
} from "./capture-handler";
import { CaptureOverlayWindows, type OverlayWarmup } from "./capture-overlay-windows";
import type { OverlayPort } from "./overlay-port";
import { type RecordingCaptureTarget, createScreenshotProvider } from "./screenshot-capture";
import { createWindowLister } from "./window-lister";
import { captureMainEvent } from "../services/analytics.service";
import {
  getAppSettings,
  onSettingsChanged,
  updateAppSettings,
} from "../infrastructure/settings-store";
import { currentVault, scopedAdmitted, screenshotFilePath } from "../library";
import { readCanvas, statCanvas } from "./screenshot-canvas";
import { recognizeScreenshotText } from "./screenshot-text";
import { getTextRecognitionService, reportImageTextFlag } from "./text-recognition-service";
import type {
  TextCacheSavePayload,
  TextRecognitionRequest,
  TextRecognitionResult,
} from "@shared/types/text-recognition";
import type { CanvasReadResult, CanvasSavePayload } from "@shared/types/screenshot-canvas";
import { activeWorkspace, refreshActiveWorkspaceSettings } from "../workspaces";
import {
  captureWhileRecordingEnabled,
  setReportedCaptureWhileRecording,
} from "./capture-while-recording";
import {
  parseScreenshotSource,
  saveCaptureToWorkspace,
  saveEditedScreenshot,
} from "./screenshot-save";
import { isPlainItemId } from "../library/library-vault";
import { vaultActivity } from "../library/vault-activity";
import type { CaptureToastShowRequest } from "./capture-toast-window";
import { deferToastUntilAfterCapture } from "./toast-after-capture";
import { PREVIEW_THUMBNAIL_MAX_SIDE } from "@shared/capture-preview-layout";

/** A copy as ArrayBuffer of IPC bytes (ArrayBuffer or Uint8Array). */
function toArrayBuffer(bytes: ArrayBuffer | Uint8Array): ArrayBuffer {
  const buf = Buffer.from(bytes as ArrayBuffer);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

let overlayWindows: CaptureOverlayWindows | null = null;
/** Whether something (a take) would rather the overlay windows did not load now. */
let overlayBusy: () => boolean = () => false;

/**
 * The next pick's guess: the intent of the last one (record before any), opened in that
 * intent's remembered mode. Nothing when that pick shows no overlay: a mode switched off
 * (Window, NIW2-469). Screen on a lone display opens the widget like any other pick.
 */
const overlayWarmup: OverlayWarmup = {
  next: (lastIntent) => {
    const intent = lastIntent ?? "record";
    const settings = getAppSettings();
    const ui = intent === "record" ? settings.recordingMode : settings.screenshotMode;
    if (!isEnabledCaptureMode(ui)) return null;
    return { ui, intent, displays: screen.getAllDisplays() };
  },
  canWarm: () => !overlayBusy(),
};

/** `disposeCaptureOverlay()` ran: an instance created afterwards is disposed on the spot. */
let overlayDisposed = false;

function overlayWindowsInstance(): CaptureOverlayWindows {
  // macOS lists through osascript JXA, Windows through PowerShell; other platforms find
  // nothing. Our own windows are dropped by pid (plus HWND on Windows).
  overlayWindows ??= new CaptureOverlayWindows({
    windowLister: createWindowLister(process.platform),
    warmup: overlayWarmup,
    // A selection made over a take must stay out of the video (NIW2-688).
    protectContent: () => duringTakeCapture(),
  });
  if (overlayDisposed) overlayWindows.dispose();
  return overlayWindows;
}

/**
 * Load the overlay windows of the next pick hidden, so "Start recording" shows them at once
 * instead of loading a renderer per display first. Call once the app has started (after the
 * main window); every pick that ends loads the next ones by itself. `busy` holds the loading
 * off while it would compete with a take.
 */
export function prewarmCaptureOverlay(busy: () => boolean): void {
  if (!app.isReady() || overlayDisposed) return;
  overlayBusy = busy;
  const windows = overlayWindowsInstance();
  windows.prewarm();
  // The mode and intent no longer shape a spare (they reach it as state), so a mode change only
  // makes sure spares exist (it may have turned a skipped pick into one that opens an overlay).
  // A language or theme change does need a reload: the loaded renderer painted with the old one.
  let { recordingMode, screenshotMode, locale, theme } = getAppSettings();
  onSettingsChanged((next) => {
    const reload = next.locale !== locale || next.theme !== theme;
    const modeChanged =
      next.recordingMode !== recordingMode || next.screenshotMode !== screenshotMode;
    ({ recordingMode, screenshotMode, locale, theme } = next);
    if (reload) windows.refreshSpares();
    else if (modeChanged) windows.prewarm();
  });
}
/** Whether a take is active or pending (`capture-while-recording`); main wires the hub in. */
let takeInProgress: () => boolean = () => false;

/** Told every overlay answer, so the toast lands on the display the shot came from. */
let observePick: (answer: OverlayAnswer) => void = () => {};

/**
 * The overlay windows, created on first use: `BrowserWindow` and `screen` need a ready
 * app, and most sessions never open an overlay. Before `ready` a pick answers `cancelled`.
 */
const overlay: OverlayPort = {
  pick: async (ui, displays, intent) => {
    if (!app.isReady()) return { kind: "cancelled" };
    const answer = await overlayWindowsInstance().pick(ui, displays, intent);
    observePick(answer);
    return answer;
  },
  hideAll: async () => overlayWindows?.hideAll(),
  destroyAll: () => overlayWindows?.destroyAll(),
};

/** Whether the capture selector is up waiting for the user to pick. */
export function isCaptureOverlayOpen(): boolean {
  return overlayWindows?.isPicking() ?? false;
}

/** The intent the open capture widget shows now (after any P / V switch); null with none up. */
export function captureOverlayIntent(): CaptureIntent | null {
  return overlayWindows?.currentIntent() ?? null;
}

/** Switch the open capture widget to `intent`, as P / V inside it do; nothing when none is up. */
export function switchCaptureOverlayIntent(intent: CaptureIntent): void {
  overlayWindows?.switchIntent(intent);
}

/** Close the open capture selector the way Esc does; nothing happens when none is up. */
export function cancelCaptureOverlay(): void {
  overlayWindows?.cancelPick();
}

/**
 * Quit: the overlay windows, spares included, are destroyed and never loaded again. Holds
 * even when no instance existed yet: the first pick after this gets a disposed instance,
 * which answers `cancelled` instead of opening windows.
 */
export function disposeCaptureOverlay(): void {
  overlayDisposed = true;
  overlayWindows?.dispose();
}

/**
 * A capture made now would land over a take AND the flag allows it: the overlay is protected
 * from the recording and the shot is saved quietly. False with the flag off, off macOS, or with
 * no take, so today's behaviour is untouched.
 */
function duringTakeCapture(): boolean {
  return takeInProgress() && captureWhileRecordingEnabled();
}

/** What the rest of main needs from the screenshot backend once it is registered. */
export interface ScreenshotHandlers {
  /** The modes this platform's provider can serve (the capture shortcuts fall back on it). */
  supportedModes(): CaptureMode[];
}

export function registerScreenshotHandlers(
  appWindows: CaptureWindowHooks,
  /**
   * The capture toast: called once per quiet capture, after `afterCapture` has put the
   * windows back, with the display the shot came from.
   */
  showToast?: (request: CaptureToastShowRequest) => void,
  /** The user chose what to record on the overlay (ADR 0030); main applies it. */
  onRecordTarget?: (target: RecordTarget) => void,
  /** Whether a take is active or pending, so a capture over it can be handled (NIW2-688). */
  isTakeInProgress?: () => boolean,
  recordingTarget?: () => Promise<RecordingCaptureTarget | null>,
): ScreenshotHandlers {
  if (isTakeInProgress) takeInProgress = isTakeInProgress;
  const provider = createScreenshotProvider(process.platform);
  const toastSeam = deferToastUntilAfterCapture(
    appWindows,
    (request) => showToast?.(request),
    // No overlay answered (the instant capture): the display under the pointer.
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
      const settings = getAppSettings();
      return { copy: settings.screenshotCopy, afterCapture: settings.screenshotAfterCapture };
    },
    saveToVault: async (png, title, workspaceId) => {
      const saved = await saveCaptureToWorkspace(workspaceId, png, { title, manual: false });
      return { id: saved.id, assetId: saved.assetId };
    },
    workspace: () => {
      const active = activeWorkspace();
      return { id: active.id, name: active.name };
    },
    copyToClipboard: (png) => clipboard.writeImage(nativeImage.createFromBuffer(png)),
    // Twice the card's largest image area on its longest side, so it is sharp on HiDPI.
    thumbnail: (png) => {
      const image = nativeImage.createFromBuffer(png);
      const { width, height } = image.getSize();
      if (Math.max(width, height) <= PREVIEW_THUMBNAIL_MAX_SIDE) return image.toDataURL();
      return image
        .resize(
          width >= height
            ? { width: PREVIEW_THUMBNAIL_MAX_SIDE, quality: "best" }
            : { height: PREVIEW_THUMBNAIL_MAX_SIDE, quality: "best" },
        )
        .toDataURL();
    },
    onQuietCapture: toastSeam.onQuietCapture,
    onRecordTarget,
    duringTake: duringTakeCapture,
    recordingTarget: async () => {
      const target = await recordingTarget?.();
      if (target)
        toastSeam.onPick({
          kind: "display",
          displayId: target.displayId,
          mode: "screen",
          action: "capture",
        });
      return target ?? null;
    },
  });
  // The whole capture is one admission (maintenance mode, NIW2-561): taken before the app
  // hides or any pixel is grabbed, held through the vault write. The hotkey goes through
  // this same channel (the renderer invokes it).
  ipcMain.handle(IPC_CHANNELS.screenshotCapture, (_event, request) =>
    vaultActivity.run("screenshot", async () => {
      // The folder's settings file is read again as the capture starts, so one a sync changed
      // since is not applied unasked (ADR 0034, decision 8). Never throws, never waits long.
      await refreshActiveWorkspaceSettings().catch(() => {});
      // A take is on and screenshots over it are not allowed (flag off, or not macOS): the
      // panel's button reaches here without passing the shortcut's refusal.
      if (takeInProgress() && !captureWhileRecordingEnabled()) {
        return { kind: "cancelled" } as const;
      }
      return handleCapture(request);
    }),
  );
  ipcMain.handle(IPC_CHANNELS.screenshotSupportedModes, () => provider.supportedModes());

  ipcMain.on(IPC_CHANNELS.screenshotReveal, () => windows.reveal());
  ipcMain.on(IPC_CHANNELS.screenshotImageTextFlag, (_event, enabled: unknown) =>
    reportImageTextFlag(enabled === true),
  );
  ipcMain.on(IPC_CHANNELS.screenshotCaptureWhileRecordingFlag, (_event, enabled: unknown) =>
    setReportedCaptureWhileRecording(enabled === true),
  );

  ipcMain.handle(IPC_CHANNELS.screenshotCopy, async (_e, png: ArrayBuffer) => {
    clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(png)));
  });

  ipcMain.handle(
    IPC_CHANNELS.screenshotCopyById,
    scopedAdmitted("library", async (id: string) => {
      const buf = await readFile(await screenshotFilePath(id));
      clipboard.writeImage(nativeImage.createFromBuffer(buf));
    }),
  );

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

  ipcMain.handle(
    IPC_CHANNELS.screenshotReadBytes,
    scopedAdmitted("library", async (id: string): Promise<ArrayBuffer> => {
      if (typeof id !== "string" || !isPlainItemId(id)) throw new Error("read: invalid id");
      const buf = await readFile(await screenshotFilePath(id));
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    }),
  );

  // The canvas document beside a shot, or null: null tells the editor to open the flat PNG.
  ipcMain.handle(
    IPC_CHANNELS.screenshotReadCanvas,
    scopedAdmitted("library", async (id: string): Promise<CanvasReadResult | null> => {
      // readCanvas refuses an id that is not a plain item id (no path out of the vault).
      return readCanvas(currentVault(), id);
    }),
  );

  // Whether a canvas document exists beside a shot, and when it was written. Null only when it
  // is missing; any other stat error rejects, so the renderer reports the document as unreadable.
  ipcMain.handle(
    IPC_CHANNELS.screenshotStatCanvas,
    scopedAdmitted("library", async (id: string): Promise<{ savedAt: number } | null> => {
      return statCanvas(currentVault(), id);
    }),
  );

  // Text recognition (ADR 0055): cached beside the item, never rejects to the renderer.
  ipcMain.handle(
    IPC_CHANNELS.screenshotRecognizeText,
    scopedAdmitted(
      "library",
      async (request: TextRecognitionRequest): Promise<TextRecognitionResult> => {
        try {
          return await recognizeScreenshotText(
            { vault: currentVault, recognizer: getTextRecognitionService().recognizer },
            request,
          );
        } catch (error) {
          console.warn("[screenshot-ipc] text recognition failed:", error);
          return { status: "unavailable" };
        }
      },
    ),
  );

  // The editor's Save (see `saveEditedScreenshot`: probed before the gate).
  ipcMain.handle(
    IPC_CHANNELS.screenshotSave,
    (
      _event,
      stamp: unknown,
      png: ArrayBuffer,
      meta: {
        title: string;
        overwriteId?: string;
        overwriteAssetId?: string;
        manual?: boolean;
        canvas?: CanvasSavePayload;
        text?: TextCacheSavePayload;
        source?: unknown;
      },
    ): Promise<LocalRecording> =>
      vaultActivity.run("screenshot", () =>
        saveEditedScreenshot(stamp, Buffer.from(png), {
          ...meta,
          // Validated here: an invalid source is dropped, the save still happens without a link.
          source: parseScreenshotSource(meta.source),
          // Binary arrives as ArrayBuffer or Uint8Array depending on the IPC path.
          ...(meta.canvas
            ? {
                canvas: {
                  docJson: meta.canvas.docJson,
                  assets: (meta.canvas.assets ?? []).map((a) => ({
                    assetId: a.assetId,
                    png: toArrayBuffer(a.png),
                  })),
                },
              }
            : {}),
        }),
      ),
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
