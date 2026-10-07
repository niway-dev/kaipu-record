import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "@kaipu/i18n";
import type { LibraryVideo } from "@renderer/features/library/types";
import { reportError } from "@renderer/features/analytics";
import { toLibraryVideo } from "@renderer/features/library/map-item";
import type { CatalogRefreshResult, RemoveLocalCopyResult } from "@shared/types/library-item";
import { useOrphanHeal } from "./use-orphan-heal";

export interface LocalLibrary {
  videos: LibraryVideo[];
  isLoading: boolean;
  /** True when the vault couldn't be read — distinct from "vault is empty". Cloud
   *  items from the cached catalog still show, so this drives a banner, not a
   *  blank page (see the Library page). */
  hasError: boolean;
  /** When the cloud catalog was last confirmed (epoch ms), 0 if never, or null
   *  when signed out. */
  catalogVerifiedAt: number | null;
  refresh(): Promise<void>;
  /** Ask main to re-confirm the cloud catalog against the server now. */
  refreshCloud(): Promise<CatalogRefreshResult>;
  rename(id: string, title: string): Promise<void>;
  /** Replace a local item's tags (normalized again in main before the sidecar write). */
  setTags(id: string, tags: readonly string[]): Promise<void>;
  remove(id: string): Promise<void>;
  reveal(id: string): void;
  /** Delete only the local bytes of an asset that also has a verified cloud
   *  copy. Resolves `{ ok: false, reason }` instead of throwing when main
   *  refuses (e.g. a local editing project still needs the file). */
  removeLocalCopy(id: string): Promise<RemoveLocalCopyResult>;
}

/** Loads + manages the combined local/cloud library via the main process. */
export function useLocalLibrary(): LocalLibrary {
  const t = useTranslations("library");
  const [videos, setVideos] = useState<LibraryVideo[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [catalogVerifiedAt, setCatalogVerifiedAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.electronAPI.listLibraryItems();
      // Do NOT blank the list to [] on a vault error — cloud items from the
      // cached catalog are still real data, and blanking would render as the
      // "No recordings yet" empty state, indistinguishable from real data loss.
      setVideos(result.items.map(toLibraryVideo));
      setCatalogVerifiedAt(result.catalogVerifiedAt);
      setHasError(result.vaultError !== null);
      if (result.vaultError !== null) {
        reportError(t("errorRead"), new Error(result.vaultError), {
          context: { phase: "library-list" },
          retry: () => void refresh(),
        });
      }
    } catch (error) {
      setHasError(true);
      reportError(t("errorRead"), error, {
        context: { phase: "library-list" },
        retry: () => void refresh(),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const rename = useCallback(async (id: string, title: string) => {
    try {
      await window.electronAPI.renameLocalRecording(id, title);
      setVideos((prev) => prev.map((video) => (video.id === id ? { ...video, title } : video)));
    } catch (error) {
      reportError(t("errorRename"), error, { context: { id } });
    }
  }, []);

  const setTags = useCallback(async (id: string, tags: readonly string[]) => {
    try {
      // Main re-normalizes; show what it actually stored.
      const stored = await window.electronAPI.setTags(id, tags);
      setVideos((prev) =>
        prev.map((video) => (video.id === id ? { ...video, tags: stored } : video)),
      );
    } catch (error) {
      reportError(t("errorTags"), error, { context: { id } });
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    try {
      await window.electronAPI.deleteLocalRecording(id);
      setVideos((prev) => prev.filter((video) => video.id !== id));
    } catch (error) {
      reportError(t("errorDelete"), error, { context: { id } });
    }
  }, []);

  const reveal = useCallback((id: string) => {
    void window.electronAPI.revealLocalRecording(id);
  }, []);

  const refreshCloud = useCallback(() => window.electronAPI.refreshCloudCatalog(), []);

  const removeLocalCopy = useCallback(
    async (id: string): Promise<RemoveLocalCopyResult> => {
      const result = await window.electronAPI.removeLocalCopy(id);
      if (result.ok) await refresh();
      return result;
    },
    [refresh],
  );

  // Self-heal recordings whose metadata was never derived from the file (hand-
  // imported, or an interrupted finalize): decode duration + poster and patch the
  // item in place, so a `0:00`, un-editable card fixes itself without a reload.
  const patchHealed = useCallback((healed: LibraryVideo) => {
    setVideos((prev) => prev.map((video) => (video.id === healed.id ? healed : video)));
  }, []);
  const localVideos = useMemo(
    () => videos.filter((v): v is LibraryVideo & { id: string } => v.id !== null),
    [videos],
  );
  useOrphanHeal(localVideos, patchHealed);

  useEffect(() => {
    void refresh();
    // Fire-and-forget: re-confirm the cloud catalog against the server on mount, so
    // signing in (or reopening the app) doesn't leave a stale/empty cached catalog
    // showing until the user manually refreshes. On success main broadcasts
    // `library:changed`, which the listener below turns into a re-list.
    void window.electronAPI.refreshCloudCatalog();
    // Re-list when the vault folder changes (Settings → Files), so an open
    // Library page doesn't keep showing the old folder's contents.
    return window.electronAPI.onLibraryChanged(() => void refresh());
  }, [refresh]);

  return {
    videos,
    isLoading,
    hasError,
    catalogVerifiedAt,
    refresh,
    refreshCloud,
    rename,
    setTags,
    remove,
    reveal,
    removeLocalCopy,
  };
}
