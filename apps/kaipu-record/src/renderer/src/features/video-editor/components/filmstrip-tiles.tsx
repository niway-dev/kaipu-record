/**
 * The tiles of a filmstrip with `zoom-filmstrip` on (ADR 0064, layer 3). Each tile is still an
 * `img`. What changes is where its frame comes from and when it swaps:
 *
 * - **Per file.** `FilmstripTiles` subscribes to ONE file's frames in the shared store, so a frame
 *   arriving for one recording re-renders only the blocks drawn from it (decision 8), never the
 *   whole strip.
 * - **Own time.** The frame is the one inside the tile's own span, else the nearest in the clip,
 *   else the nearest in the file ({@link frameForTile}); the 24 frames decoded at open take part.
 * - **Decoded before it swaps (AC12).** A tile keeps the image it shows until the new one is
 *   decoded, so a finer frame replaces a coarse one with no blank in between.
 *
 * With the flag off none of this renders: the callers keep today's `img` map.
 */
import { memo, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { CoveredRange } from "../use-source-thumbnails";
import type { StoredFrame } from "../filmstrip-store";
import { getFilmstripStore } from "../filmstrip-service";
import {
  frameForTile,
  legacyFrames,
  mergeTileFrames,
  type FilmstripBinding,
} from "../filmstrip-targets";
import type { LayoutEntry } from "../timeline";
import type { ThumbnailTile } from "./timeline-geometry";

const NO_FRAMES: readonly StoredFrame[] = Object.freeze([]);
const noSubscribe = (): (() => void) => () => {};
const noFrames = (): readonly StoredFrame[] => NO_FRAMES;

/** The published frames of one file; re-renders only when THIS file's frames change. */
export function useFileFrames(fileKey: string | null): readonly StoredFrame[] {
  const subscribe = useCallback(
    (listener: () => void) =>
      fileKey ? getFilmstripStore().subscribe(fileKey, listener) : noSubscribe(),
    [fileKey],
  );
  const snapshot = useCallback(
    () => (fileKey ? getFilmstripStore().frames(fileKey) : NO_FRAMES),
    [fileKey],
  );
  return useSyncExternalStore(subscribe, snapshot, noFrames);
}

/** One tile image that changes its `src` only once the new image is decoded (AC12). */
const FilmstripTileImage = memo(function FilmstripTileImage({
  url,
  timestamp,
  spanStart,
  spanEnd,
  className,
  left,
  width,
}: {
  url: string;
  timestamp: number;
  spanStart: number;
  spanEnd: number;
  className: string;
  left: number;
  width: number;
}): React.JSX.Element {
  const [shown, setShown] = useState({ url, timestamp });

  useEffect(() => {
    if (url === shown.url) {
      // Same image, maybe a different frame number after a re-pick: nothing to decode.
      return;
    }
    let cancelled = false;
    const next = new Image();
    next.src = url;
    const decoded = typeof next.decode === "function" ? next.decode() : Promise.resolve();
    decoded.then(
      () => {
        if (!cancelled) setShown({ url, timestamp });
      },
      () => {
        // The image could not be decoded (its URL was revoked): keep the one on screen.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [url, timestamp, shown.url]);

  return (
    <img
      src={shown.url}
      alt=""
      className={className}
      style={{ left: `${left * 100}%`, width: `${width * 100}%` }}
      draggable={false}
      data-filmstrip-frame={shown.timestamp.toFixed(3)}
      data-filmstrip-span={`${spanStart.toFixed(3)},${spanEnd.toFixed(3)}`}
      // AC1/AC2: the tile shows a frame of its own time. A verify scenario and the UI catalog read it.
      data-filmstrip-own={shown.timestamp >= spanStart && shown.timestamp <= spanEnd}
    />
  );
});

export interface FilmstripTilesProps {
  tiles: readonly ThumbnailTile[];
  entry: Pick<LayoutEntry, "sourceStart" | "sourceEnd">;
  binding: FilmstripBinding;
  /** The frames decoded at open, as the lane reports them. */
  legacy: readonly { sourceTime: number; url: string }[];
  /** A webcam's footage, in the time `legacy` is reported in; a tile outside it stays empty. */
  covered?: CoveredRange | null;
  className: string;
}

export function FilmstripTiles({
  tiles,
  entry,
  binding,
  legacy,
  covered,
  className,
}: FilmstripTilesProps): React.JSX.Element {
  const stored = useFileFrames(binding.fileKey);
  const opening = useMemo(
    () => legacyFrames(legacy, binding.legacyOffset),
    [legacy, binding.legacyOffset],
  );
  const frames = useMemo(() => mergeTileFrames(stored, opening), [stored, opening]);
  const coveredInFile = useMemo(
    () =>
      covered
        ? { start: covered.start - binding.legacyOffset, end: covered.end - binding.legacyOffset }
        : null,
    [covered, binding.legacyOffset],
  );
  return (
    <>
      {tiles.map((tile) => {
        const picked = frameForTile({
          frames,
          tile,
          entry,
          fileOffset: binding.fileOffset,
          covered: coveredInFile,
        });
        return picked ? (
          <FilmstripTileImage
            key={tile.index}
            url={picked.frame.url}
            timestamp={picked.frame.timestamp}
            spanStart={picked.span.start}
            spanEnd={picked.span.end}
            className={className}
            left={tile.left}
            width={tile.width}
          />
        ) : null;
      })}
    </>
  );
}
