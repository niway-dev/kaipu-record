import { readFile } from "node:fs/promises";
import { clipboard, ipcMain, nativeImage } from "electron";
import { IPC_CHANNELS } from "@shared/types/ipc";
import type { LocalRecording } from "@shared/types/library-storage";
import { createScreenshotProvider } from "./screenshot-capture";
import { currentVault, screenshotFilePath } from "../library";

const provider = createScreenshotProvider();

/** Stable, sortable id; mirrors the recording writer's timestamp scheme. */
function screenshotId(): string {
  return `screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

/**
 * Window orchestration around a capture, owned by main (which holds the windows).
 * The native `screencapture` overlay floats above everything, so the app must get
 * OUT of the way during a capture instead of coming to the front.
 */
export interface CaptureWindowHooks {
  /** Hide the app so it isn't in the shot. Remembers prior visibility. */
  beforeCapture(): void;
  /** After the overlay closes: restore prior visibility if the user cancelled. */
  afterCapture(captured: boolean): void;
  /** Bring the app to the front (the renderer calls this once it shows the editor). */
  reveal(): void;
}

export function registerScreenshotHandlers(windows: CaptureWindowHooks): void {
  // Re-entrancy guard: a second capture while one is in flight would stack native
  // overlays and clobber the saved window-visibility state (leaving the app stuck
  // hidden on cancel). Ignore captures until the current one settles.
  let capturing = false;

  ipcMain.handle(IPC_CHANNELS.screenshotCapture, async () => {
    if (process.platform !== "darwin" || capturing) return null;
    capturing = true;
    windows.beforeCapture();
    let png: Buffer | null = null;
    try {
      png = await provider.captureInteractive();
    } finally {
      capturing = false;
      windows.afterCapture(Boolean(png));
    }
    if (!png) return null;
    const img = nativeImage.createFromBuffer(png);
    const { width, height } = img.getSize();
    // Buffer → ArrayBuffer slice for structured-clone across IPC.
    return {
      png: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
      width,
      height,
    };
  });

  ipcMain.on(IPC_CHANNELS.screenshotReveal, () => windows.reveal());

  ipcMain.handle(IPC_CHANNELS.screenshotCopy, async (_e, png: ArrayBuffer) => {
    clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(png)));
  });

  ipcMain.handle(IPC_CHANNELS.screenshotCopyById, async (_e, id: string) => {
    const buf = await readFile(await screenshotFilePath(id));
    clipboard.writeImage(nativeImage.createFromBuffer(buf));
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
      meta: { title: string; overwriteId?: string },
    ): Promise<LocalRecording> => {
      const id = meta.overwriteId ?? screenshotId();
      const vault = currentVault();
      await vault.writeImage(id, Buffer.from(png));
      // Preserve the original createdAt when overwriting; stamp it for a new item.
      await vault.writeMeta(
        id,
        meta.overwriteId ? { title: meta.title } : { title: meta.title, createdAt: Date.now() },
      );
      const saved = await vault.describe(id);
      if (!saved) throw new Error(`screenshot save: could not describe ${id} after writing`);
      return saved;
    },
  );
}
