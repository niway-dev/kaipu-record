import { desktopCapturer, ipcMain } from "electron";
import type { ScreenSource } from "@shared/types/electron-api";

/**
 * Registers `recording:get-screen-sources`: enumerates screens and windows via
 * desktopCapturer and returns base64 thumbnails the renderer can render directly.
 *
 * Thumbnails are the expensive part — macOS captures every screen and every open
 * window to produce them. The picker needs them; choosing a default screen does
 * not. `{ withThumbnails: false }` asks for screens only with a 0×0 thumbnail,
 * which Electron documents as skipping the capture entirely. That is what lets the
 * Capture Panel show "Screen 1" without waiting for a screenshot of every window.
 *
 * On macOS, thumbnails require the Screen Recording permission. Without it the
 * call still resolves but thumbnails come back blank until the user grants it
 * (System Settings → Privacy & Security → Screen Recording).
 */
export function registerRecordingSourceHandlers(): void {
  ipcMain.handle(
    "recording:get-screen-sources",
    async (_event, options?: { withThumbnails?: boolean }): Promise<ScreenSource[]> => {
      // Test isolation, the same idea as the throwaway `--user-data-dir` and seeded vault
      // the suite already launches with: the end-to-end tests never record anything, so
      // enumerating real screens and windows buys them nothing and costs a macOS
      // screen-recording prompt PER LAUNCH. Thirteen launches meant thirteen stacked system
      // dialogs, attributed to whichever terminal spawned the run, interrupting whoever was
      // working. Returning an empty list keeps the picker honest — it renders its empty
      // state — without asking the OS for anything.
      if (process.env.KAIPU_DISABLE_SCREEN_CAPTURE === "1") return [];

      const withThumbnails = options?.withThumbnails !== false;
      const sources = await desktopCapturer.getSources({
        types: withThumbnails ? ["screen", "window"] : ["screen"],
        thumbnailSize: withThumbnails ? { width: 320, height: 200 } : { width: 0, height: 0 },
        fetchWindowIcons: false,
      });

      return sources.map((source) => ({
        id: source.id,
        name: source.name,
        thumbnail: withThumbnails ? source.thumbnail.toDataURL() : "",
        type: source.id.startsWith("screen:") ? "screen" : "window",
      }));
    },
  );
}
