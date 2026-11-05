import { app, desktopCapturer, ipcMain, screen, type WebContents } from "electron";
import {
  NATIVE_CAPTURE_CHANNELS as channels,
  type NativeCaptureReader,
  type NativeOpenRequest,
  type NativeVideoRequest,
} from "../../../shared/native-capture";
import type { RecordingArea } from "@shared/types/ipc";
import { sanitizeArea } from "../area-geometry";
import { onPageGone } from "../../renderer-lifetime";
import { nativeHelperPath, spawnNativeVideo, validateNativeHelper } from "./session";

/** Explicit developer transport only. No file path or process arguments come from IPC. */
export function registerNativeCaptureTransport(
  owner: () => WebContents | undefined,
  hubArea: () => RecordingArea | null | undefined = () => undefined,
): void {
  let reader: NativeCaptureReader | null = null;
  let opening = false;
  let generation = 0;
  let detach: (() => void) | undefined;
  const path = nativeHelperPath(
    process.resourcesPath,
    app.isPackaged ? undefined : app.getAppPath(),
  );
  // Set by the renderer's `native-cursor-capture` flag on each capability check, so a
  // flag turned off stops the next take from opening the helper.
  let requestedByFlag = false;
  const capability = async () => {
    const experimentalRequested =
      requestedByFlag || process.argv.includes("--experimental-native-recording");
    const reason =
      "Experimental whole-display capture; duplicated Chromium acquisition for audio/thumbnail; signing/TCC and motion unvalidated";
    if (process.platform !== "darwin" || !experimentalRequested)
      return {
        transportAvailable: false,
        recordingReady: false as const,
        reason,
        experimentalRequested,
      };
    try {
      await validateNativeHelper(path);
      return {
        transportAvailable: true,
        recordingReady: false as const,
        reason,
        experimentalRequested,
      };
    } catch {
      return {
        transportAvailable: false,
        recordingReady: false as const,
        reason: "Native helper missing or incompatible",
        experimentalRequested,
      };
    }
  };
  const cancel = async () => {
    generation++;
    detach?.();
    detach = undefined;
    const active = reader;
    reader = null;
    await active?.cancel();
  };
  for (const [method, channel] of Object.entries(channels)) {
    ipcMain.handle(channel, async (event, request?: NativeOpenRequest | number | boolean) => {
      const contents = owner();
      if (!contents || event.sender !== contents || event.senderFrame !== contents.mainFrame)
        throw new Error("Unauthorized native capture caller");
      if (method === "capability") {
        requestedByFlag = request === true;
        return capability();
      }
      if (method === "cancel") return cancel();
      if (method === "open") {
        if (reader || opening) throw new Error("Native capture already open");
        opening = true;
        const openedGeneration = generation;
        // A reload during the awaits below neither destroys the contents nor reaches
        // the page-gone listener attached after spawn; invalidate this open instead.
        const detachEarly = onPageGone(contents, () => {
          generation++;
        });
        try {
          if (
            !(await capability()).transportAvailable ||
            !request ||
            contents.isDestroyed() ||
            openedGeneration !== generation
          )
            throw new Error("Native transport unavailable");
          if (typeof request !== "object") throw new Error("Invalid request");
          // `displayId` and `sourceRect` are main's to set; whatever the renderer sent is dropped.
          const {
            sourceId,
            area,
            displayId: _d,
            sourceRect: _r,
            ...rest
          } = request as NativeOpenRequest & {
            displayId?: unknown;
            sourceRect?: unknown;
          };
          const videoRequest = rest as NativeVideoRequest;
          if (sourceId) {
            if (!sourceId.startsWith("screen:")) throw new Error("Native requires whole display");
            const sources = await desktopCapturer.getSources({
              types: ["screen"],
              thumbnailSize: { width: 0, height: 0 },
            });
            videoRequest.displayId = Number(
              sources.find((source) => source.id === sourceId)?.display_id,
            );
            if (area) {
              // Same validation the hub applies to a recording start: the area must name
              // this display and is clamped to its bounds. Display points with the origin
              // at the display's top-left is what the helper's --source-rect takes.
              const display = screen
                .getAllDisplays()
                .find((candidate) => candidate.id === videoRequest.displayId);
              // The hub's area is the source of truth: the cursor track is normalized to it.
              // A renderer copy that differs would draw the cursor offset, so refuse and let
              // the take fall back to Chromium.
              const chosen = hubArea();
              if (
                !chosen ||
                chosen.displayId !== area.displayId ||
                JSON.stringify(chosen.rect) !== JSON.stringify(area.rect)
              )
                throw new Error("Native area differs from the recording area");
              const safe = display ? sanitizeArea(chosen, display) : null;
              if (!safe) throw new Error("Native area is not on the captured display");
              videoRequest.sourceRect = safe.rect;
            }
          } else if (area) throw new Error("Native area needs a display source");
          if (openedGeneration !== generation || contents.isDestroyed())
            throw new Error("Native open cancelled");
          reader = spawnNativeVideo(path, videoRequest);
          detach = onPageGone(contents, () => {
            void cancel();
          });
          try {
            await reader.ready?.();
          } catch (error) {
            await cancel();
            throw error;
          }
          if (openedGeneration !== generation || contents.isDestroyed()) {
            await cancel();
            throw new Error("Native open cancelled");
          }
          return;
        } finally {
          detachEarly();
          opening = false;
        }
      }
      if (!reader) throw new Error("No native capture session");
      if (["begin", "pause", "resume", "stop"].includes(method)) {
        if (typeof request !== "number" || !Number.isFinite(request))
          throw new Error("Missing command clock");
        if (method === "stop") return reader.stop(request);
        if (method === "begin") return reader.begin?.(request);
        if (method === "pause") return reader.pause?.(request);
        return reader.resume?.(request);
      }
      const active = reader;
      let frame;
      try {
        frame = await active.next();
      } catch (error) {
        if (reader === active) await cancel();
        throw error;
      }
      if (frame === null && reader === active) {
        reader = null;
        detach?.();
        detach = undefined;
      }
      return frame;
    });
  }
  app.on("before-quit", () => {
    void cancel();
  });
}
