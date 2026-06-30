import type { ImageSource, ImageSourceReader } from "./types";

type BlobSource = Extract<ImageSource, { kind: "blob" }>;

/** In-memory PNG (a fresh capture). Shown via a `blob:` object URL, revoked on cleanup. */
export const blobReader: ImageSourceReader<BlobSource> = {
  resolve(source) {
    const url = URL.createObjectURL(new Blob([source.bytes], { type: "image/png" }));
    return { displayUrl: url, cleanup: () => URL.revokeObjectURL(url) };
  },
  getBytes(source) {
    return Promise.resolve(source.bytes);
  },
};
