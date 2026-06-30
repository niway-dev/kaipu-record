import { useCallback, useEffect, useState } from "react";
import type { ImageSource, ImageSourceReader, ResolvedImage } from "./types";
import { blobReader } from "./blob-reader";
import { localReader } from "./local-reader";
import { cloudReader } from "./cloud-reader";

/** Reader registry, keyed by the source discriminator. Add a kind → add an entry. */
const READERS: {
  [K in ImageSource["kind"]]: ImageSourceReader<Extract<ImageSource, { kind: K }>>;
} = {
  blob: blobReader,
  local: localReader,
  cloud: cloudReader,
};

function readerFor(source: ImageSource): ImageSourceReader<ImageSource> {
  return READERS[source.kind] as ImageSourceReader<ImageSource>;
}

/**
 * Resolve any `ImageSource` to a `{ displayUrl, getBytes }` the editor consumes
 * without knowing the origin. The reader owns the lifecycle (e.g. a `blob:` URL
 * is revoked on unmount / source change). Accepts `null` so callers can run the
 * hook unconditionally before a source is available.
 */
export function useImageSource(source: ImageSource | null): ResolvedImage | null {
  const [displayUrl, setDisplayUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!source) {
      setDisplayUrl(null);
      return;
    }
    const resolved = readerFor(source).resolve(source);
    setDisplayUrl(resolved.displayUrl);
    return resolved.cleanup;
  }, [source]);

  const getBytes = useCallback(async (): Promise<ArrayBuffer> => {
    if (!source) throw new Error("useImageSource: no source");
    return readerFor(source).getBytes(source);
  }, [source]);

  if (!source || !displayUrl) return null;
  return { displayUrl, getBytes };
}
