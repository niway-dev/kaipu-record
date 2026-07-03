import { useEffect, useState } from "react";
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from "mediabunny";

export interface SourceThumbnail {
  sourceTime: number;
  url: string;
}

const THUMB_WIDTH = 160;
const THUMB_COUNT = 24;

/**
 * Decodes a fixed set of evenly spaced frames from the SOURCE recording, once.
 * Cuts never invalidate this cache — blocks pick the nearest thumbnails by source
 * time — so we never re-decode while editing.
 */
export function useSourceThumbnails(mediaUrl: string, durationSeconds: number): SourceThumbnail[] {
  const [thumbnails, setThumbnails] = useState<SourceThumbnail[]>([]);

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];

    void (async () => {
      try {
        // kaipu-media:// supports fetch (supportFetchAPI) — stream the file to a Blob.
        const blob = await (await fetch(mediaUrl)).blob();
        const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
        const track = await input.getPrimaryVideoTrack();
        if (!track || cancelled) return;
        const sink = new CanvasSink(track, { width: THUMB_WIDTH });
        const timestamps = Array.from(
          { length: THUMB_COUNT },
          (_, i) => ((i + 0.5) / THUMB_COUNT) * durationSeconds,
        );
        const out: SourceThumbnail[] = [];
        for await (const wrapped of sink.canvasesAtTimestamps(timestamps)) {
          if (cancelled) break; // cancelled mid-stream: stop decoding further frames
          if (!wrapped) continue;
          const canvas = wrapped.canvas as HTMLCanvasElement;
          const url = await new Promise<string | null>((resolve) =>
            canvas.toBlob((b) => resolve(b ? URL.createObjectURL(b) : null), "image/jpeg", 0.6),
          );
          if (!url) continue;
          if (cancelled) {
            // Cancelled while toBlob was pending — this URL was never handed to
            // the cleanup effect's `urls` list, so revoke it here to avoid a leak.
            URL.revokeObjectURL(url);
            break;
          }
          urls.push(url);
          out.push({ sourceTime: wrapped.timestamp, url });
        }
        if (!cancelled) setThumbnails(out);
      } catch {
        // Thumbnails are cosmetic; a decode failure must never break the editor.
      }
    })();

    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [mediaUrl, durationSeconds]);

  return thumbnails;
}
