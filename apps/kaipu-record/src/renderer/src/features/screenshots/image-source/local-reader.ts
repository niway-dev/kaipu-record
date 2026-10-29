import type { ImageSource, ImageSourceReader } from "./types";
import { mediaUrl } from "@shared/media-url";

type LocalSource = Extract<ImageSource, { kind: "local" }>;

/** A screenshot saved in the vault, served via the bypass-CSP media protocol. */
export const localReader: ImageSourceReader<LocalSource> = {
  resolve(source) {
    // Carry the version token so a re-opened shot shows fresh bytes after an
    // in-place overwrite (same id) instead of the cached pre-overwrite image.
    return { displayUrl: mediaUrl("screenshot", source.id, source.version ?? undefined) };
  },
  async getBytes(source) {
    // Bytes come through main, not `fetch`: the kaipu-media:// scheme renders in an
    // <img> but doesn't hand a usable body to renderer fetch.
    return window.electronAPI.readScreenshotBytes(source.id);
  },
};
