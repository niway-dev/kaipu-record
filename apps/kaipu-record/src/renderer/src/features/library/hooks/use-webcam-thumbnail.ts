import { useEffect, useRef } from "react";
import type { LibraryVideo } from "@renderer/features/library/types";
import { composeWebcamThumbnail } from "@renderer/features/library/media/compose-webcam-thumbnail";
import { isOrphan } from "./use-orphan-heal";

/** A library video with a local copy, the only kind with files to compose from. */
type LocalLibraryVideo = LibraryVideo & { id: string };

/**
 * A recording that used the webcam whose thumbnail is still the bare screen frame
 * (`thumbnailNeedsWebcam`, from the vault). Excluded: items whose sidecar cannot be read
 * (main refuses the write) and anything without a webcam track, whose files and thumbnail
 * stay as they are. An offloaded item (`evicted`) is never composed: its media would be decoded
 * (downloading it, or failing for good when it is not there) and a new poster would be written
 * over the offloaded one in the synced folder. An orphan waits for its heal (`useOrphanHeal`): the heal writes a plain
 * poster, which would replace a bubble composed before it; once it lands the item comes back
 * changed and is composed then.
 */
function needsComposite(video: LocalLibraryVideo): boolean {
  if (video.metadataIssue || video.evicted || isOrphan(video)) return false;
  return video.kind === "recording" && !!video.webcam && video.thumbnailNeedsWebcam === true;
}

/**
 * Window-wide, not per hook: `useLocalLibrary` is mounted by several pages at once (Library,
 * detail, export, editor), and each must not compose the same recording again or in parallel.
 * `attempted` is never cleared while the app runs, so a broken file is not decoded on every
 * list refresh; the next launch tries again. It is keyed by asset id, like the write, so a
 * different recording under the same file id (another workspace) is not skipped. Every mounted
 * hook hears each result, so a page opened after the one that queued the item still shows the
 * new poster.
 */
const attempted = new Set<string>();
let queue: Promise<void> = Promise.resolve();
const listeners = new Set<(video: LibraryVideo) => void>();

/** Tests only: forget what was attempted and drop the queue. */
export function resetWebcamThumbnailQueue(): void {
  attempted.clear();
  queue = Promise.resolve();
  listeners.clear();
}

/**
 * NIW2-845: puts the webcam bubble on the thumbnail of every recording that used the webcam,
 * new ones and those recorded before this existed, in the background. Each is composed in the
 * renderer (decoding needs WebCodecs), written back through main (JPEG and marker together)
 * and reported through `onUpdated` so its card changes in place.
 *
 * One recording at a time across the window: every item decodes a webcam frame, and the
 * Library must stay responsive. A failure is logged once and the item keeps its plain
 * thumbnail until the next launch.
 */
export function useWebcamThumbnail(
  videos: LocalLibraryVideo[],
  onUpdated: (video: LibraryVideo) => void,
): void {
  const onUpdatedRef = useRef(onUpdated);
  onUpdatedRef.current = onUpdated;

  useEffect(() => {
    const listener = (video: LibraryVideo): void => onUpdatedRef.current(video);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    for (const v of videos) {
      if (!needsComposite(v) || attempted.has(v.assetId)) continue;
      attempted.add(v.assetId);
      // Chained, not started here: a later list refresh queues behind the work in flight.
      queue = queue.then(async () => {
        try {
          const jpeg = await composeWebcamThumbnail({
            id: v.id,
            screenUrl: v.thumbnailUrl ?? null,
            webcam: v.webcam!,
          });
          // The asset id pins the write to this recording: across a workspace switch, or with
          // another file put back under the id, main refuses it.
          const updated = await window.electronAPI.writeWebcamThumbnail(v.id, v.assetId, jpeg);
          if (!updated) return;
          const patched: LibraryVideo = {
            ...v,
            thumbnailUrl: updated.thumbnailUrl ?? null,
            thumbnailNeedsWebcam: updated.thumbnailNeedsWebcam ?? false,
          };
          for (const listener of listeners) listener(patched);
        } catch (error) {
          console.error(`webcam thumbnail: left "${v.id}" as it is`, error);
        }
      });
    }
  }, [videos]);
}
