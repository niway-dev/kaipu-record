import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "@kaipu/i18n";
import type { LibraryVideo } from "@renderer/features/library/types";
import { reportError } from "@renderer/features/analytics";
import { toLibraryVideo } from "@renderer/features/library/map-recording";
import { useOrphanHeal } from "./use-orphan-heal";

export interface LocalLibrary {
  videos: LibraryVideo[];
  isLoading: boolean;
  /** True when the vault couldn't be read — distinct from "vault is empty". */
  hasError: boolean;
  refresh(): Promise<void>;
  rename(id: string, title: string): Promise<void>;
  remove(id: string): Promise<void>;
  reveal(id: string): void;
}

/** Loads + manages the local recordings vault via the main process. */
export function useLocalLibrary(): LocalLibrary {
  const t = useTranslations("library");
  const [videos, setVideos] = useState<LibraryVideo[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const recordings = await window.electronAPI.listLocalRecordings();
      setVideos(recordings.map(toLibraryVideo));
      setHasError(false);
    } catch (error) {
      // Do NOT blank the list to [] — that renders as the "No recordings yet"
      // empty state, indistinguishable from real data loss. Flag the error so the
      // page can show a "couldn't read your folder — Retry" panel instead.
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

  // Self-heal recordings whose metadata was never derived from the file (hand-
  // imported, or an interrupted finalize): decode duration + poster and patch the
  // item in place, so a `0:00`, un-editable card fixes itself without a reload.
  const patchHealed = useCallback((healed: LibraryVideo) => {
    setVideos((prev) => prev.map((video) => (video.id === healed.id ? healed : video)));
  }, []);
  useOrphanHeal(videos, patchHealed);

  useEffect(() => {
    void refresh();
    // Re-list when the vault folder changes (Settings → Files), so an open
    // Library page doesn't keep showing the old folder's contents.
    return window.electronAPI.onLibraryChanged(() => void refresh());
  }, [refresh]);

  return { videos, isLoading, hasError, refresh, rename, remove, reveal };
}
