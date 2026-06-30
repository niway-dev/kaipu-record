import { clipboard, ipcMain, nativeImage } from "electron";
import { IPC_CHANNELS } from "@shared/types/ipc";
import type { LocalRecording } from "@shared/types/library-storage";
import { createScreenshotProvider } from "./screenshot-capture";
import { currentVault } from "../library";

const provider = createScreenshotProvider();

/** Stable, sortable id; mirrors the recording writer's timestamp scheme. */
function screenshotId(): string {
  return `screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

export function registerScreenshotHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.screenshotCapture, async () => {
    if (process.platform !== "darwin") return null;
    const png = await provider.captureInteractive();
    if (!png) return null;
    const img = nativeImage.createFromBuffer(png);
    const { width, height } = img.getSize();
    // Buffer → ArrayBuffer slice for structured-clone across IPC.
    return { png: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength), width, height };
  });

  ipcMain.handle(IPC_CHANNELS.screenshotCopy, async (_e, png: ArrayBuffer) => {
    clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(png)));
  });

  ipcMain.handle(
    IPC_CHANNELS.screenshotSave,
    async (_e, png: ArrayBuffer, meta: { title: string }): Promise<LocalRecording> => {
      const id = screenshotId();
      const vault = currentVault();
      await vault.writeImage(id, Buffer.from(png));
      await vault.writeMeta(id, { title: meta.title, createdAt: Date.now() });
      return (await vault.describe(id))!;
    },
  );
}
