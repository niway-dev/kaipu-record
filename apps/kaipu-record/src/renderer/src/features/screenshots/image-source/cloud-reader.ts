import type { ImageSource, ImageSourceReader } from "./types";

type CloudSource = Extract<ImageSource, { kind: "cloud" }>;

/**
 * A screenshot uploaded to cloud storage — bytes live behind a remote URL.
 * (When cloud lands, the renderer CSP must allow the storage origin in
 * `img-src`/`connect-src`.)
 */
export const cloudReader: ImageSourceReader<CloudSource> = {
  resolve(source) {
    return { displayUrl: source.url };
  },
  async getBytes(source) {
    const res = await fetch(source.url);
    return res.arrayBuffer();
  },
};
