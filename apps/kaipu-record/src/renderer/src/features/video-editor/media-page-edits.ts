/**
 * Scene-level edits for floating images (NIW2-771): what the editor page and the media panel
 * call, so each action is one pure `scene -> scene` step the page hands to `controller.commit`
 * (or `updateLive` during a drag). Every function only composes the model in media.ts; none
 * re-implements it. A function that changes nothing returns the SAME scene, which `commit`
 * treats as a no-op (no empty undo step).
 */
import {
  addImageMedia,
  boxFitted,
  boxInCorner,
  moveMedia,
  placeMedia,
  removeMedia,
  reorderMedia,
  resizeMediaEdge,
  setMediaBox,
  setMediaFades,
  type PictureSize,
} from "./media";
import type { ImageMediaItem, MediaBox, VideoScene } from "./scene";
import { toLayout } from "./timeline";

/** The scene with `next` as its media, or the same scene when nothing differs. */
function withMedia(scene: VideoScene, next: ImageMediaItem[]): VideoScene {
  if (scene.media === undefined && next.length === 0) return scene;
  if (scene.media && JSON.stringify(scene.media) === JSON.stringify(next)) return scene;
  return { ...scene, media: next };
}

function find(scene: VideoScene, id: string): ImageMediaItem | undefined {
  return scene.media?.find((item) => item.id === id);
}

/**
 * Add to timeline with the levels flag on: a floating image at the playhead, 10 s, fitted, in
 * front. The sequence (`scene.items`) is untouched, so `toLayout(items)` does not change.
 */
export function addFloatingImage(
  scene: VideoScene,
  args: {
    id: string;
    assetId: string;
    naturalWidth: number;
    naturalHeight: number;
    playhead: number;
    picture: PictureSize;
  },
): VideoScene {
  return withMedia(scene, addImageMedia(scene.media, toLayout(scene.items), args));
}

/**
 * Loading a saved session: drop floating items whose asset was not restored (the file is gone),
 * so nothing refers to an image the preview and the export cannot draw. A scene with no `media`
 * is returned as it is: the key is not added.
 */
export function dropMediaWithoutAsset(
  scene: VideoScene,
  loadedAssetIds: ReadonlySet<string>,
): VideoScene {
  if (!scene.media) return scene;
  const kept = scene.media.filter((item) => loadedAssetIds.has(item.assetId));
  return kept.length === scene.media.length ? scene : { ...scene, media: kept };
}

/** Whether the item still sits on the timeline: false once the footage under its start is gone. */
export function isMediaPlaced(scene: VideoScene, id: string): boolean {
  return placeMedia(scene.media, toLayout(scene.items)).some((p) => p.item.id === id);
}

/** Live while dragging the body in the timeline: the item should start at `time`. */
export function moveMediaTo(scene: VideoScene, id: string, time: number): VideoScene {
  return withMedia(scene, moveMedia(scene.media, toLayout(scene.items), id, time));
}

/** Live while dragging an edge in the timeline. */
export function resizeMediaEdgeTo(
  scene: VideoScene,
  id: string,
  edge: "start" | "end",
  time: number,
): VideoScene {
  return withMedia(scene, resizeMediaEdge(scene.media, toLayout(scene.items), id, edge, time));
}

/** Live while dragging the box in the preview, and the building block of Full and Box. */
export function setMediaBoxOf(scene: VideoScene, id: string, box: MediaBox): VideoScene {
  return withMedia(scene, setMediaBox(scene.media, id, box));
}

/** Full: the largest box with the image's aspect inside the picture, centred. */
export function fillPicture(scene: VideoScene, id: string, picture: PictureSize): VideoScene {
  const item = find(scene, id);
  if (!item) return scene;
  return setMediaBoxOf(scene, id, boxFitted(item.naturalWidth, item.naturalHeight, picture));
}

/** Box: 40 % of the picture width at the bottom right. */
export function putInCorner(scene: VideoScene, id: string, picture: PictureSize): VideoScene {
  const item = find(scene, id);
  if (!item) return scene;
  return setMediaBoxOf(scene, id, boxInCorner(item.naturalWidth, item.naturalHeight, picture));
}

/** Bring forward / Send backward. The same scene when there is nothing to pass. */
export function reorderMediaItem(
  scene: VideoScene,
  id: string,
  direction: "forward" | "backward",
): VideoScene {
  const next = reorderMedia(scene.media, toLayout(scene.items), id, direction);
  return next === scene.media ? scene : withMedia(scene, next);
}

export function setMediaFadesOf(
  scene: VideoScene,
  id: string,
  fades: { fadeInMs?: number; fadeOutMs?: number },
): VideoScene {
  return withMedia(scene, setMediaFades(scene.media, id, fades));
}

export function deleteMediaItem(scene: VideoScene, id: string): VideoScene {
  if (!find(scene, id)) return scene;
  return withMedia(scene, removeMedia(scene.media, id));
}

/**
 * The duration field: the item's END edge goes to `start + seconds` through `resizeMediaEdge`,
 * so the minimum (0.5 s) and the end of the timeline clamp it exactly as dragging the edge does.
 */
export function setMediaDurationSeconds(
  scene: VideoScene,
  id: string,
  seconds: number,
): VideoScene {
  if (!Number.isFinite(seconds)) return scene;
  const placed = placeMedia(scene.media, toLayout(scene.items)).find((p) => p.item.id === id);
  if (!placed) return scene;
  return resizeMediaEdgeTo(scene, id, "end", placed.start + seconds);
}
