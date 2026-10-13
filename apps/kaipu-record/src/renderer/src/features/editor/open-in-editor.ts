import { useCallback } from "react";
import { generatePath, useNavigate } from "react-router-dom";
import { ROUTES } from "@shared/routes";
import type { LibraryVideo } from "@renderer/features/library/types";
import type { ImageSource } from "@renderer/features/screenshots/image-source";
import type { VideoEditorSource } from "@renderer/pages/video-editor/video-editor-page";

/**
 * The one way into the Editor workspace. Every "Edit" in the app — the library
 * detail page, the library card and row, the ⌃⌘X capture — goes through here,
 * so the route an item lands on is decided in one place.
 */

/** The fields of a library item the editor routes need. */
export type EditableItem = Pick<
  LibraryVideo,
  "id" | "assetId" | "kind" | "title" | "durationSeconds" | "thumbnailUrl"
>;

/**
 * Whether an item can open in an editor: it needs a local copy, and a video
 * needs a duration (the editor builds its first scene from it — an older vault
 * item without one cannot be opened).
 */
export function canOpenInEditor(item: EditableItem): boolean {
  if (item.id === null) return false;
  return item.kind === "screenshot" || item.durationSeconds > 0;
}

/** The editor URL for an item, by kind. */
export function editorPathFor(item: Pick<EditableItem, "assetId" | "kind">): string {
  const route = item.kind === "screenshot" ? ROUTES.editorImage : ROUTES.editorVideo;
  return generatePath(route, { assetId: item.assetId });
}

/** The video editor's input for a recording, or null when it cannot be edited. */
export function videoSourceFor(item: EditableItem): VideoEditorSource | null {
  if (item.kind === "screenshot" || !canOpenInEditor(item) || item.id === null) return null;
  return {
    id: item.id,
    assetId: item.assetId,
    title: item.title,
    durationSeconds: item.durationSeconds,
  };
}

/**
 * The image editor's input for a saved screenshot. It's a flat PNG, so the editor
 * treats it as a new base image. The `?v=` token from the thumbnail URL is carried
 * so the editor loads the current bytes, not a cached older version.
 */
export function imageSourceFor(item: EditableItem): ImageSource | null {
  if (item.kind !== "screenshot" || item.id === null) return null;
  const v = item.thumbnailUrl ? Number(new URL(item.thumbnailUrl).searchParams.get("v")) : NaN;
  return {
    kind: "local",
    id: item.id,
    title: item.title,
    version: Number.isFinite(v) ? v : undefined,
  };
}

export interface OpenInEditor {
  /** Open a library item in its editor. No-op when the item cannot be edited. */
  openItem(item: EditableItem): void;
  /** Open an image that is not in the vault yet (a fresh capture). */
  openCapture(source: ImageSource): void;
}

export function useOpenInEditor(): OpenInEditor {
  const navigate = useNavigate();
  const openItem = useCallback(
    (item: EditableItem) => {
      if (canOpenInEditor(item)) navigate(editorPathFor(item));
    },
    [navigate],
  );
  const openCapture = useCallback(
    (source: ImageSource) => navigate(ROUTES.editorCapture, { state: source }),
    [navigate],
  );
  return { openItem, openCapture };
}
