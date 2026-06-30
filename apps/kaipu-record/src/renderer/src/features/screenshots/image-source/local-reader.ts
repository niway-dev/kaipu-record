import type { ImageSource, ImageSourceReader } from "./types";

type LocalSource = Extract<ImageSource, { kind: "local" }>;

const mediaUrl = (id: string): string => `kaipu-media://screenshot/${encodeURIComponent(id)}`;

/** A screenshot saved in the vault, served via the bypass-CSP media protocol. */
export const localReader: ImageSourceReader<LocalSource> = {
  resolve(source) {
    return { displayUrl: mediaUrl(source.id) };
  },
  async getBytes(source) {
    const res = await fetch(mediaUrl(source.id));
    return res.arrayBuffer();
  },
};
