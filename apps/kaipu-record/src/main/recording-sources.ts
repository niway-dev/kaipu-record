import { desktopCapturer, ipcMain } from "electron";
import type { ScreenSource } from "@shared/types/electron-api";

/**
 * Registers `recording:get-screen-sources`: enumerates screens and windows via
 * desktopCapturer and returns base64 thumbnails the renderer can render directly.
 *
 * On macOS, thumbnails require the Screen Recording permission. Without it the
 * call still resolves but thumbnails come back blank until the user grants it
 * (System Settings → Privacy & Security → Screen Recording).
 */
export function registerRecordingSourceHandlers(): void {
  ipcMain.handle("recording:get-screen-sources", async (): Promise<ScreenSource[]> => {
    // Test isolation, the same idea as the throwaway `--user-data-dir` and seeded vault
    // the suite already launches with: the end-to-end tests never record anything, so
    // enumerating real screens and windows buys them nothing and costs a macOS
    // screen-recording prompt PER LAUNCH. Thirteen launches meant thirteen stacked system
    // dialogs, attributed to whichever terminal spawned the run, interrupting whoever was
    // working. Returning an empty list keeps the picker honest — it renders its empty
    // state — without asking the OS for anything.
    if (process.env.KAIPU_DISABLE_SCREEN_CAPTURE === "1") return [];

    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 320, height: 200 },
      fetchWindowIcons: false,
    });

    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL(),
      type: source.id.startsWith("screen:") ? "screen" : "window",
    }));
  });
}
