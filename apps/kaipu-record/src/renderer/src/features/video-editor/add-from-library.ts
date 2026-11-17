import type { LibraryVideo } from "@renderer/features/library/types";
import type { SlideItem, VideoScene } from "./scene";
import { MEDIA_DEFAULT_DURATION, MEDIA_MIN_DURATION } from "./media";
import { itemsIndexOfBoundary } from "./source-axis";
import {
  boundaryIndexAt,
  insertItemAt,
  MIN_ITEM_DURATION,
  toLayout,
  type LayoutEntry,
} from "./timeline";

/**
 * The recordings the Add from Library modal offers (NIW2-782, NIW2-790): the Library's own recordings, other
 * than the one being edited, that can become a clip. An export (derived from another recording),
 * a cloud-only item (no local file), a recording whose sidecar could not be read and one too
 * short for a clip are left out. A recording the scene already joined stays: joining it again
 * is a new copy by design (`joinRecording`). `query` is a case-insensitive match on the title
 * after trimming; a blank one lists everything. Newest first.
 */
export function joinableRecordings(
  videos: readonly LibraryVideo[],
  openedAssetId: string,
  query: string,
): LibraryVideo[] {
  const needle = query.trim().toLowerCase();
  return videos
    .filter(
      (video) =>
        video.kind === "recording" &&
        video.id !== null &&
        video.durationSeconds >= MIN_ITEM_DURATION &&
        video.derivedFromAssetId === null &&
        !video.metadataIssue &&
        video.assetId !== openedAssetId &&
        (needle === "" || video.title.toLowerCase().includes(needle)),
    )
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * The screenshots the Screenshots tab offers (NIW2-790): the Library's own screenshots that have
 * a local file (`readScreenshotBytes` reads it by id, so a cloud-only one cannot be added).
 * GIFs are left out on purpose: a GIF export is an animated MP4-sized file, not a still, and a
 * floating image is drawn from one PNG. `query` is a case-insensitive title match after
 * trimming; a blank one lists everything. Newest first.
 */
export function libraryScreenshots(videos: readonly LibraryVideo[], query: string): LibraryVideo[] {
  const needle = query.trim().toLowerCase();
  return videos
    .filter(
      (video) =>
        video.kind === "screenshot" &&
        video.id !== null &&
        (needle === "" || video.title.toLowerCase().includes(needle)),
    )
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** "1440 × 1080" from how the recording was captured; null when the size is unknown. */
export function resolutionLabel(video: Pick<LibraryVideo, "capture">): string | null {
  const width = video.capture?.width ?? 0;
  const height = video.capture?.height ?? 0;
  return width > 0 && height > 0 ? `${width} × ${height}` : null;
}

/**
 * The type a dragged Library row carries in `dataTransfer` (its value is the recording's
 * asset id). A drag of anything else, a file from Finder or text, never lights the timeline up.
 */
export const RECORDING_DRAG_MIME = "application/x-kaipu-recording";

/**
 * Where a recording dropped at timeline time `t` would land: `index` in the scene's items and
 * `time`, that boundary's second on the timeline, which is where the indicator is drawn. The
 * index is `boundaryIndexAt`'s, the rule the join itself applies to the time it is handed, so
 * dropping at `time` inserts exactly where the indicator was.
 */
export function insertBoundaryAt(
  layout: LayoutEntry[],
  t: number,
): { index: number; time: number } {
  const index = boundaryIndexAt(layout, t);
  return { index, time: index === 0 ? 0 : layout[index - 1].timelineEnd };
}

/**
 * Where clicking a Library recording lands when the playhead is at `t` (NIW2-788): after the
 * clip under the playhead, not at the nearest boundary. A playhead inside a clip, or exactly at
 * its end, means that clip, so one exactly at a clip's start means the clip before it; at 0 or
 * before, the first clip. At or past the end of the sequence it is the end; an empty sequence, 0.
 * Slides count as clips. Dropping keeps `insertBoundaryAt`'s nearest boundary.
 */
export function boundaryAfterClipAt(
  layout: LayoutEntry[],
  t: number,
): { index: number; time: number } {
  const found = layout.findIndex((entry) => t <= entry.timelineEnd);
  const index = found === -1 ? layout.length : found + 1;
  return { index, time: index === 0 ? 0 : layout[index - 1].timelineEnd };
}

/**
 * The mirror of `boundaryAfterClipAt` (NIW2-829): before the clip under the playhead, which is
 * the same clip that rule picks (inside it, or exactly at its end, so a playhead exactly on a
 * cut means the clip before the cut). Past the end of the sequence there is no clip under the
 * playhead, so it is the end, as for "after"; an empty sequence, 0.
 */
export function boundaryBeforeClipAt(
  layout: LayoutEntry[],
  t: number,
): { index: number; time: number } {
  const found = layout.findIndex((entry) => t <= entry.timelineEnd);
  const index = found === -1 ? layout.length : found;
  return { index, time: index === 0 ? 0 : layout[index - 1].timelineEnd };
}

/** Add at start: before the first clip. */
export function boundaryAtStart(): { index: number; time: number } {
  return { index: 0, time: 0 };
}

/** Add at end: after the last clip (`index` is the layout length); 0 for an empty sequence. */
export function boundaryAtEnd(layout: LayoutEntry[]): { index: number; time: number } {
  return {
    index: layout.length,
    time: layout.length === 0 ? 0 : layout[layout.length - 1].timelineEnd,
  };
}

/**
 * The boundary `at` names on `layout` (a time: the nearest one, for a drop; or a boundary already
 * chosen, for a click), pinned to the clip that FOLLOWS it (null: the end of the sequence), as a
 * function of the scene a join composes from. A join waits behind earlier ones,
 * and one that inserted a clip ahead of the boundary moves it: the anchor moves with it, so the
 * recording lands where the user dropped it. Following the clip, and the end, keeps two quick
 * adds at the end in the order they were made. If the anchor clip was removed meanwhile, the
 * original boundary time stands. The scene's layout is `joinRecording`'s own (`toLayout`).
 */
export function anchoredBoundary(
  layout: LayoutEntry[],
  at: number | { index: number; time: number },
): (scene: VideoScene) => number {
  const { index, time } = typeof at === "number" ? insertBoundaryAt(layout, at) : at;
  const anchor = layout[index]?.itemId ?? null;
  return (scene) => {
    const current = toLayout(scene.items);
    if (anchor === null) return current.length === 0 ? 0 : current[current.length - 1].timelineEnd;
    return current.find((entry) => entry.itemId === anchor)?.timelineStart ?? time;
  };
}

/** How long a screenshot added to the sequence is shown (the spec's decision 8; floating is 10 s). */
export const SEQUENCE_IMAGE_SECONDS = 5;

/**
 * The scene with `slide` inserted at the boundary `resolve` names for it (an `anchoredBoundary`
 * result: a timeline time). The index is read from the scene given, not from the one the
 * boundary was chosen on, because the image is decoded asynchronously and the sequence may have
 * changed meanwhile. The layout skips empty items, so the boundary is mapped back onto `items`
 * with `itemsIndexOfBoundary`, the same mapping `joinRecording` uses.
 */
export function insertSlideAtBoundary(
  scene: VideoScene,
  slide: SlideItem,
  resolve: (scene: VideoScene) => number,
): VideoScene {
  const index = itemsIndexOfBoundary(scene.items, toLayout(scene.items), resolve(scene));
  return { ...scene, items: insertItemAt(scene.items, index, slide) };
}

/** The two kinds of Library item the modal adds. */
export type LibraryItemKind = "recording" | "screenshot";

/** Where a Library item can go (NIW2-829): over the video, or at one of four sequence boundaries. */
export type LibraryDestination = "over" | "before-clip" | "after-clip" | "start" | "end";

/**
 * The destinations in the order the Add button's menu lists them (`add-destination-button.tsx`).
 * The menu relies on `over` being first: it draws its separator after index 0.
 */
export const LIBRARY_DESTINATIONS: readonly LibraryDestination[] = [
  "over",
  "before-clip",
  "after-clip",
  "start",
  "end",
];

/** What each kind of item selects before the user touches the Add button's menu. */
export function defaultDestination(kind: LibraryItemKind): LibraryDestination {
  return kind === "screenshot" ? "over" : "after-clip";
}

/** A recording cannot float over the video yet (floating videos are a later stage). */
export function destinationAllowed(
  kind: LibraryItemKind,
  destination: LibraryDestination,
): boolean {
  return !(kind === "recording" && destination === "over");
}

/**
 * The sequence boundary a destination means for the sequence and playhead as they are now; null
 * for "over", which has no boundary because it never touches the sequence.
 */
export function boundaryForDestination(
  destination: LibraryDestination,
  layout: LayoutEntry[],
  playhead: number,
): { index: number; time: number } | null {
  switch (destination) {
    case "over":
      return null;
    case "before-clip":
      return boundaryBeforeClipAt(layout, playhead);
    case "after-clip":
      return boundaryAfterClipAt(layout, playhead);
    case "start":
      return boundaryAtStart();
    case "end":
      return boundaryAtEnd(layout);
  }
}

/** How long a screenshot added Over the video floats: the floating image's own default. */
export const FLOATING_IMAGE_SECONDS = MEDIA_DEFAULT_DURATION;

/** One piece of the sequence in a `PlacementPreview`, in timeline seconds. */
export interface PlacementBlock {
  /** The layout entry's item id, or "new" for the item being added. */
  key: string;
  start: number;
  end: number;
  isNew: boolean;
  /** A clip the add pushes later (it sits after the new item). */
  moved: boolean;
}

/** What `placementPreview` draws: the sequence after the add, and where the playhead is in it. */
export interface PlacementPreview {
  blocks: PlacementBlock[];
  /** "Over the video": the floating item's span, drawn above the clips. Null otherwise. */
  floating: { start: number; end: number } | null;
  /** The playhead's place in the result; it follows the clip it is on if that clip moves. */
  playhead: number;
  /** The length the drawing spans: the sequence after the add, or the floating item's end if later. */
  total: number;
  /** How many clips the add pushes later. */
  moved: number;
}

/**
 * The sequence as it would be right after adding an item `newSeconds` long at `destination`:
 * the picture the placement strip draws. It asks `boundaryForDestination`, the rule the add
 * itself applies, so the drawing cannot disagree with where the item lands. For a sequence
 * place the new block sits at the boundary and every clip from there on is pushed by
 * `newSeconds`; the playhead marker stays on the clip it is on, so it moves with that clip.
 * "Over" changes nothing in the sequence: the item floats from the playhead for
 * `newSeconds`, cut at the end of the video exactly as `addImageMedia` does.
 */
export function placementPreview(
  layout: LayoutEntry[],
  playhead: number,
  destination: LibraryDestination,
  newSeconds: number,
): PlacementPreview {
  const sequenceEnd = layout.length === 0 ? 0 : layout[layout.length - 1].timelineEnd;
  const t = Math.max(0, playhead);
  const boundary = boundaryForDestination(destination, layout, t);
  const clipUnderPlayhead = layout.findIndex((entry) => t <= entry.timelineEnd);

  if (boundary === null) {
    const start =
      layout.length === 0 ? 0 : Math.max(0, Math.min(t, sequenceEnd - MEDIA_MIN_DURATION));
    const length =
      layout.length === 0
        ? newSeconds
        : Math.max(MEDIA_MIN_DURATION, Math.min(newSeconds, sequenceEnd - start));
    return {
      blocks: layout.map((entry) => ({
        key: entry.itemId,
        start: entry.timelineStart,
        end: entry.timelineEnd,
        isNew: false,
        moved: false,
      })),
      floating: { start, end: start + length },
      playhead: Math.min(t, sequenceEnd),
      total: Math.max(sequenceEnd, start + length),
      moved: 0,
    };
  }

  const blocks: PlacementBlock[] = [];
  layout.forEach((entry, i) => {
    if (i === boundary.index) {
      blocks.push({
        key: "new",
        start: boundary.time,
        end: boundary.time + newSeconds,
        isNew: true,
        moved: false,
      });
    }
    const moved = i >= boundary.index;
    const shift = moved ? newSeconds : 0;
    blocks.push({
      key: entry.itemId,
      start: entry.timelineStart + shift,
      end: entry.timelineEnd + shift,
      isNew: false,
      moved,
    });
  });
  if (boundary.index >= layout.length) {
    blocks.push({
      key: "new",
      start: boundary.time,
      end: boundary.time + newSeconds,
      isNew: true,
      moved: false,
    });
  }

  // On a clip: its offset into the clip is kept, so the marker rides along if the clip moves.
  // Past the end there is no clip: the marker waits at the old end of the sequence.
  const shifted = clipUnderPlayhead !== -1 && clipUnderPlayhead >= boundary.index;
  const marker = clipUnderPlayhead === -1 ? sequenceEnd : t + (shifted ? newSeconds : 0);
  return {
    blocks,
    floating: null,
    playhead: marker,
    total: sequenceEnd + newSeconds,
    moved: layout.length - Math.min(boundary.index, layout.length),
  };
}

/**
 * The fixed picture of each destination the menu's thumbnails draw (NIW2-829): the design's
 * schematic, not the user's sequence. Three clips of 8, 12 and 10 seconds, a new item of 7, and
 * the playhead 4 s into the second clip. Every thumbnail is the same whatever is being edited,
 * so the menu reads as a legend of the five places. "Over" floats the item from the playhead
 * and the sequence keeps its own length.
 */
const SCHEMATIC_CLIPS = [8, 12, 10] as const;
const SCHEMATIC_NEW = 7;
const SCHEMATIC_PLAYHEAD_CLIP = 1;
const SCHEMATIC_PLAYHEAD_OFFSET = 4;

export function schematicPlacement(destination: LibraryDestination): PlacementPreview {
  const clipKeys = SCHEMATIC_CLIPS.map((_, i) => `c${i}`);
  const sequenceEnd = SCHEMATIC_CLIPS.reduce((sum, length) => sum + length, 0);
  const playheadIn = (shift: number): number =>
    SCHEMATIC_CLIPS.slice(0, SCHEMATIC_PLAYHEAD_CLIP).reduce((sum, length) => sum + length, 0) +
    SCHEMATIC_PLAYHEAD_OFFSET +
    shift;

  if (destination === "over") {
    const start = playheadIn(0);
    let at = 0;
    return {
      blocks: SCHEMATIC_CLIPS.map((length, i) => {
        const block = { key: clipKeys[i], start: at, end: at + length, isNew: false, moved: false };
        at += length;
        return block;
      }),
      floating: { start, end: start + SCHEMATIC_NEW },
      playhead: start,
      total: sequenceEnd,
      moved: 0,
    };
  }

  // Where the new item goes among the three clips: its index in the order.
  const at = { start: 0, "before-clip": 1, "after-clip": 2, end: 3 }[destination];
  const blocks: PlacementBlock[] = [];
  let cursor = 0;
  const pushNew = (): void => {
    blocks.push({
      key: "new",
      start: cursor,
      end: cursor + SCHEMATIC_NEW,
      isNew: true,
      moved: false,
    });
    cursor += SCHEMATIC_NEW;
  };
  SCHEMATIC_CLIPS.forEach((length, i) => {
    if (i === at) pushNew();
    blocks.push({
      key: clipKeys[i],
      start: cursor,
      end: cursor + length,
      isNew: false,
      moved: i >= at,
    });
    cursor += length;
  });
  if (at >= SCHEMATIC_CLIPS.length) pushNew();
  return {
    blocks,
    floating: null,
    playhead: playheadIn(SCHEMATIC_PLAYHEAD_CLIP >= at ? SCHEMATIC_NEW : 0),
    total: sequenceEnd + SCHEMATIC_NEW,
    moved: SCHEMATIC_CLIPS.length - Math.min(at, SCHEMATIC_CLIPS.length),
  };
}

/**
 * When a destination lands exactly where another one does, the one it equals: "after this clip"
 * on the last clip (a one-clip video included) is "at the end", and "before this clip" on the
 * first is "at the start". Read from `boundaryForDestination`, the rule the add applies, so the
 * note cannot disagree with where the item goes. Null for everything else.
 */
export function sameAsDestination(
  destination: LibraryDestination,
  layout: LayoutEntry[],
  playhead: number,
): "start" | "end" | null {
  if (layout.length === 0) return null;
  const same = (
    a: { index: number; time: number } | null,
    b: { index: number; time: number } | null,
  ): boolean => a !== null && b !== null && a.index === b.index && a.time === b.time;
  const here = boundaryForDestination(destination, layout, playhead);
  if (destination === "after-clip" && same(here, boundaryAtEnd(layout))) return "end";
  if (destination === "before-clip" && same(here, boundaryAtStart())) return "start";
  return null;
}

/** One thing the large placement strip draws: a clip, the new item, or a run of hidden clips. */
export interface PlacementSlot {
  kind: "clip" | "new" | "group";
  /** The clip's item id, "new", or `group:<first clip id>`. */
  key: string;
  /** The span it covers in timeline seconds; for a group, from its first clip to its last. */
  start: number;
  end: number;
  /** How many clips it stands for: 1, except for a group (always 2 or more). */
  count: number;
  /** Every clip in it is pushed later by the add. */
  moved: boolean;
  /** It is the clip the playhead is on, in the result. */
  current: boolean;
  /** Where it is drawn, as a share of the strip's width. */
  x0: number;
  x1: number;
}

export interface CondensedPlacement {
  slots: PlacementSlot[];
  /** Timeline seconds to a share of the strip's width, piecewise: each slot is linear inside. */
  x(seconds: number): number;
  /** The "Over the video" bar as shares of the strip's width, null for a sequence place. */
  floating: { x0: number; x1: number } | null;
}

/** The narrowest a clip or the new item is drawn, as a share of the strip. */
export const MIN_SLOT_SHARE = 0.08;
/** The narrowest a group is drawn: its "5 clips" label has to fit. */
export const MIN_GROUP_SHARE = 0.16;

/**
 * Widths that sum to 1, proportional to `weights` but never under their `floors`: a slot that
 * would fall below its floor is pinned there and the rest share what is left.
 */
function shareWidths(weights: number[], floors: number[]): number[] {
  const pinned = new Set<number>();
  for (;;) {
    const left = 1 - [...pinned].reduce((sum, i) => sum + floors[i], 0);
    const free = weights.map((w, i) => (pinned.has(i) ? 0 : w));
    const freeSum = free.reduce((a, b) => a + b, 0);
    const widths = weights.map((_, i) =>
      pinned.has(i)
        ? floors[i]
        : freeSum > 0
          ? (free[i] / freeSum) * left
          : left / (weights.length - pinned.size),
    );
    const under = widths.findIndex((w, i) => !pinned.has(i) && w < floors[i]);
    if (under === -1) return widths;
    pinned.add(under);
  }
}

/**
 * The picture the large placement strip draws: the real sequence after the add, condensed so
 * it stays readable with many clips. What stays one-by-one: the clip the playhead is on, the
 * block before and after it, and the new item with the block before and after it. Every other
 * run of clips folds into one group (a run of a single clip stays a clip). Widths are the
 * duration share kept above a minimum, so a short clip beside a long one is still visible, and
 * the playhead and the floating bar go through the same `x`, so they stay aligned with blocks.
 */
export function condensePlacement(preview: PlacementPreview): CondensedPlacement {
  const eps = 1e-9;
  const { blocks } = preview;
  // The clip the playhead is on: the first clip that has not ended before it, as the layout
  // finds it. Past the end of everything, the last clip.
  let current = blocks.findIndex((b) => !b.isNew && preview.playhead <= b.end + eps);
  if (current === -1) {
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (!blocks[i].isNew) {
        current = i;
        break;
      }
    }
  }
  const fresh = blocks.findIndex((b) => b.isNew);

  const visible = new Set<number>();
  for (const anchor of [current, fresh]) {
    if (anchor === -1) continue;
    for (const i of [anchor - 1, anchor, anchor + 1]) {
      if (i >= 0 && i < blocks.length) visible.add(i);
    }
  }

  const raw: Array<Omit<PlacementSlot, "x0" | "x1">> = [];
  let i = 0;
  while (i < blocks.length) {
    if (visible.has(i)) {
      const b = blocks[i];
      raw.push({
        kind: b.isNew ? "new" : "clip",
        key: b.key,
        start: b.start,
        end: b.end,
        count: 1,
        moved: b.moved,
        current: i === current,
      });
      i++;
      continue;
    }
    // A run of hidden clips, cut where moved changes so a group never mixes the two.
    let j = i;
    while (
      j + 1 < blocks.length &&
      !visible.has(j + 1) &&
      blocks[j + 1].moved === blocks[i].moved
    ) {
      j++;
    }
    const count = j - i + 1;
    raw.push({
      kind: count === 1 ? "clip" : "group",
      key: count === 1 ? blocks[i].key : `group:${blocks[i].key}`,
      start: blocks[i].start,
      end: blocks[j].end,
      count,
      moved: blocks[i].moved,
      current: false,
    });
    i = j + 1;
  }

  const total = Math.max(preview.total, Number.EPSILON);
  const floors = raw.map((slot) => (slot.kind === "group" ? MIN_GROUP_SHARE : MIN_SLOT_SHARE));
  const shares = shareWidths(
    raw.map((slot) => (slot.end - slot.start) / total),
    floors,
  );
  let cursor = 0;
  const slots: PlacementSlot[] = raw.map((slot, index) => {
    const x0 = cursor;
    cursor += shares[index];
    return { ...slot, x0, x1: index === raw.length - 1 ? 1 : cursor };
  });

  const x = (seconds: number): number => {
    if (slots.length === 0) return Math.min(1, Math.max(0, seconds / total));
    if (seconds <= slots[0].start) return slots[0].x0;
    for (const slot of slots) {
      if (seconds <= slot.end) {
        const length = slot.end - slot.start;
        return length <= 0
          ? slot.x0
          : slot.x0 + ((seconds - slot.start) / length) * (slot.x1 - slot.x0);
      }
    }
    return slots[slots.length - 1].x1;
  };

  return {
    slots,
    x,
    floating: preview.floating
      ? { x0: x(preview.floating.start), x1: x(preview.floating.end) }
      : null,
  };
}
