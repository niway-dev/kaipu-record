import { useCallback, useEffect, useRef, useState } from "react";
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

  // Cache the FIRST byte read for the whole editor session. Export composites the
  // live scene ONTO these bytes, so they must stay the immutable *original*: a
  // `local` source re-reads the vault file each call, so after a Save→Overwrite
  // (which writes the composited PNG back to the same id) a re-read would return
  // the already-flattened image and the next Copy/Overwrite would double the
  // frame + annotations. Reset when the source changes; drop a failed read so a
  // retry re-fetches.
  const bytesRef = useRef<Promise<ArrayBuffer> | null>(null);
  useEffect(() => {
    bytesRef.current = null;
  }, [source]);

  const getBytes = useCallback(async (): Promise<ArrayBuffer> => {
    if (!source) throw new Error("useImageSource: no source");
    if (!bytesRef.current) {
      bytesRef.current = readerFor(source)
        .getBytes(source)
        .catch((error: unknown) => {
          bytesRef.current = null;
          throw error;
        });
    }
    return bytesRef.current;
  }, [source]);

  if (!source || !displayUrl) return null;
  return { displayUrl, getBytes };
}
