import { useEffect, useRef } from "react";
import type { LibraryVideo } from "@renderer/features/library/types";
import { composeWebcamThumbnail } from "@renderer/features/library/media/compose-webcam-thumbnail";

/** A library video with a local copy, the only kind with files to compose from. */
type LocalLibraryVideo = LibraryVideo & { id: string };

/**
 * A recording that used the webcam whose thumbnail is still the bare screen frame
 * (`thumbnailNeedsWebcam`, from the vault). Excluded: items whose sidecar cannot be read
 * (main refuses the write) and anything without a webcam track, whose files and thumbnail
 * stay as they are.
 */
function needsComposite(video: LocalLibraryVideo): boolean {
  if (video.metadataIssue) return false;
  return video.kind === "recording" && !!video.webcam && video.thumbnailNeedsWebcam === true;
}

/**
 * NIW2-845: puts the webcam bubble on the thumbnail of every recording that used the webcam,
 * new ones and those recorded before this existed, in the background. Each is composed in the
 * renderer (decoding needs WebCodecs), written back through main (JPEG and marker together)
 * and reported through `onUpdated` so its card changes in place.
 *
 * One recording at a time: every item decodes a webcam file, and the Library must stay
 * responsive. A failure is logged once and the item keeps its plain thumbnail for the rest of
 * the session (`attempted` is never cleared), so a broken file is not decoded again on every
 * list refresh; the next launch tries again.
 */
export function useWebcamThumbnail(
  videos: LocalLibraryVideo[],
  onUpdated: (video: LibraryVideo) => void,
): void {
  const attempted = useRef<Set<string>>(new Set());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(true);
  const onUpdatedRef = useRef(onUpdated);
  onUpdatedRef.current = onUpdated;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    for (const v of videos) {
      if (!needsComposite(v) || attempted.current.has(v.id)) continue;
      attempted.current.add(v.id);
      // Chained, not started here: a later list refresh queues behind the work in flight.
      queue.current = queue.current.then(async () => {
        try {
          const jpeg = await composeWebcamThumbnail({
            id: v.id,
            screenUrl: v.thumbnailUrl ?? null,
            webcam: v.webcam!,
          });
          const updated = await window.electronAPI.writeWebcamThumbnail(v.id, jpeg);
          if (updated && mounted.current) {
            onUpdatedRef.current({
              ...v,
              thumbnailUrl: updated.thumbnailUrl ?? null,
              thumbnailNeedsWebcam: updated.thumbnailNeedsWebcam ?? false,
            });
          }
        } catch (error) {
          console.error(`webcam thumbnail: left "${v.id}" as it is`, error);
        }
      });
    }
  }, [videos]);
}
