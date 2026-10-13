import React, { useRef } from "react";
import { generatePath, Navigate, useLocation, useParams } from "react-router-dom";
import { useTranslations } from "@kaipu/i18n";
import { ROUTES } from "@shared/routes";
import { useLocalLibrary } from "@renderer/features/library/hooks/use-local-library";
import type { LibraryVideo } from "@renderer/features/library/types";
import { imageSourceFor, videoSourceFor } from "@renderer/features/editor/open-in-editor";
import type { ImageSource } from "@renderer/features/screenshots/image-source";
import { VideoEditorLoader } from "@renderer/pages/video-editor/video-editor-page";
import { ScreenshotEditor } from "@renderer/pages/screenshot-editor/screenshot-editor-page";
import styles from "./editor-page.module.css";

/**
 * The Editor workspace's item routes. The editor is addressed by URL
 * (`/editor/video/:assetId`, `/editor/image/:assetId`), so a reload, back/forward
 * or a deep link reopens the same item: the page resolves it from the library
 * the way the library detail page does, instead of reading router state.
 */

/** Resolve the `:assetId` param against the local library. */
function useItemFromParams(): { item: LibraryVideo | undefined; isLoading: boolean } {
  const { assetId } = useParams<{ assetId: string }>();
  const { videos, isLoading } = useLocalLibrary();
  return { item: videos.find((v) => v.assetId === assetId), isLoading };
}

/**
 * Keep the first source resolved for an item for as long as that item is open.
 * The library list re-renders with fresh objects (a refresh, the orphan heal),
 * and both editors treat a new `source` object as a new input — the image
 * editor re-reads its bytes on every identity change. Router state, which the
 * editors used to read, was stable per navigation; this restores that.
 */
function useStableSource<T>(key: string | undefined, next: T | null): T | null {
  const ref = useRef<{ key: string | undefined; value: T | null }>({ key: undefined, value: null });
  if (next !== null && (ref.current.key !== key || ref.current.value === null)) {
    ref.current = { key, value: next };
  }
  return ref.current.key === key ? ref.current.value : null;
}

function Loading(): React.JSX.Element {
  const t = useTranslations("common");
  return (
    <div role="status" aria-live="polite" className={styles.loading}>
      {t("loading")}
    </div>
  );
}

/** `/editor/video/:assetId` — the video editor for one recording. */
export function EditorVideoPage(): React.JSX.Element {
  const { item, isLoading } = useItemFromParams();
  const source = useStableSource(item?.assetId, item ? videoSourceFor(item) : null);
  if (isLoading && !source) return <Loading />;
  // Unknown id, cloud-only item or a recording without a duration: back to the
  // Editor home rather than a dead end.
  if (!source) return <Navigate to={ROUTES.editor} replace />;
  // Keyed by asset id: switching items remounts, so one recording never inherits
  // another's editor state.
  return <VideoEditorLoader key={source.assetId} source={source} />;
}

/** `/editor/image/:assetId` — the image editor for one saved screenshot. */
export function EditorImagePage(): React.JSX.Element {
  const { item, isLoading } = useItemFromParams();
  const source = useStableSource(item?.assetId, item ? imageSourceFor(item) : null);
  if (isLoading && !source) return <Loading />;
  if (!item || !source) return <Navigate to={ROUTES.editor} replace />;
  return <ScreenshotEditor key={item.assetId} source={source} />;
}

/**
 * Legacy `/screenshot-editor`. A saved screenshot (`local` source) lands on its
 * `/editor/image/:assetId` URL — the old state carries the local id, so it is
 * mapped to the asset id through the library. Anything else (a fresh capture, a
 * cloud source, an item the library no longer lists) keeps its state and opens
 * on `/editor/capture`; a stateless navigation goes to the Editor home.
 */
export function LegacyScreenshotEditorRedirect(): React.JSX.Element {
  const location = useLocation();
  const source = location.state as ImageSource | null;
  const { videos, isLoading } = useLocalLibrary();
  if (!source) return <Navigate to={ROUTES.editor} replace />;
  if (source.kind === "local") {
    const item = videos.find((v) => v.id === source.id);
    if (item) {
      return <Navigate to={generatePath(ROUTES.editorImage, { assetId: item.assetId })} replace />;
    }
    if (isLoading) return <Loading />;
  }
  return <Navigate to={ROUTES.editorCapture} state={source} replace />;
}
