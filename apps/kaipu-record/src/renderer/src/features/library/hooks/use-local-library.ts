import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { notifyVaultRefusal } from "@renderer/features/library/vault-errors";
import { useTranslations } from "@kaipu/i18n";
import type { LibraryVideo } from "@renderer/features/library/types";
import { reportError } from "@renderer/features/analytics";
import { toLibraryVideo } from "@renderer/features/library/map-item";
import type { CatalogRefreshResult, RemoveLocalCopyResult } from "@shared/types/library-item";
import {
  isAmbiguousIdentityError,
  isItemNotFoundError,
  notifyAmbiguousIdentity,
  notifyRenameOutcome,
} from "@renderer/features/library/rename-outcome";
import { useOrphanHeal } from "./use-orphan-heal";
import { useWebcamThumbnail } from "./use-webcam-thumbnail";

/** The fewest ms between two re-lists started by the window regaining focus (see `anyEvicted`). */
export const FOCUS_RELIST_MIN_INTERVAL_MS = 10_000;

export interface LocalLibrary {
  videos: LibraryVideo[];
  /** True only until the first list lands; a later re-list never sets it again. */
  isLoading: boolean;
  /** True while a re-list is in flight after the first one; the current list stays visible. */
  isRefreshing: boolean;
  /** True when the vault couldn't be read — distinct from "vault is empty". Cloud
   *  items from the cached catalog still show, so this drives a banner, not a
   *  blank page (see the Library page). */
  hasError: boolean;
  /** When the cloud catalog was last confirmed (epoch ms), 0 if never, or null
   *  when signed out. */
  catalogVerifiedAt: number | null;
  refresh(): Promise<void>;
  /**
   * Ask main to re-confirm the cloud catalog. Never rejects: a failure resolves as
   * `{ ok: false }`. Main skips a fetch made less than 30 s ago unless `force` is set.
   */
  refreshCloud(force?: boolean): Promise<CatalogRefreshResult>;
  /** The Sync button: a forced cloud check plus a local re-list. */
  sync(): Promise<void>;
  /** Rename by id **and** identity: main follows the item if it moved, never renames another. */
  rename(id: string, assetId: string, title: string): Promise<void>;
  /** Replace a local item's tags by id (main drops unknown ids before writing). */
  setTags(id: string, tagIds: readonly string[]): Promise<void>;
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
  const tCommon = useTranslations("common");
  const [videos, setVideos] = useState<LibraryVideo[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [isRefreshing, setRefreshing] = useState(false);
  const inFlight = useRef(0);
  // Request order: a re-list that started later always read newer state, so only the
  // latest started refresh may write results (an older one resolving last would
  // overwrite a fresh list with a stale one).
  const latest = useRef(0);
  // The latest started re-list. A superseded call awaits it, so `await refresh()` still
  // means "a list at least as new as my call is on screen" (the detail page's retry and
  // the editor routes' re-list rely on that).
  const latestRun = useRef<Promise<void>>(Promise.resolve());
  const [hasError, setHasError] = useState(false);
  const [catalogVerifiedAt, setCatalogVerifiedAt] = useState<number | null>(null);

  // `quiet`: a re-list the user did not ask for (the window regained focus). It still replaces
  // the list when it succeeds, but a failure is not an error toast: a provider that is offline
  // would otherwise raise one on every focus, and it does not turn the page into an error page.
  const runRefresh = useCallback((quiet: boolean): Promise<void> => {
    const seq = ++latest.current;
    const run = relist(seq);
    latestRun.current = run;
    return run;

    async function relist(seq: number): Promise<void> {
      // Stale-while-revalidate: only the first list shows "loading"; a re-list keeps the
      // current videos on screen so open pages (detail, editor home) do not blank.
      inFlight.current += 1;
      setRefreshing(true);
      let applied = false;
      try {
        const result = await window.electronAPI.listLibraryItems();
        if (seq !== latest.current) return await latestRun.current; // superseded: wait for the newer list
        applied = true;
        // A quiet re-list that hit a vault error read no local items: keep what is on screen
        // (and keep the focus listener attached) instead of replacing it with a partial list.
        if (quiet && result.vaultError !== null) return;
        // Do NOT blank the list to [] on a vault error — cloud items from the
        // cached catalog are still real data, and blanking would render as the
        // "No recordings yet" empty state, indistinguishable from real data loss.
        setVideos(result.items.map(toLibraryVideo));
        setCatalogVerifiedAt(result.catalogVerifiedAt);
        // A quiet re-list can clear the page error (it read fine now) but never raise one.
        if (!quiet || result.vaultError === null) setHasError(result.vaultError !== null);
        if (result.vaultError !== null && !quiet) {
          reportError(t("errorRead"), new Error(result.vaultError), {
            context: { phase: "library-list" },
            retry: () => void runRefresh(false),
          });
        }
      } catch (error) {
        if (seq !== latest.current) return await latestRun.current;
        applied = true;
        if (!quiet) {
          setHasError(true);
          reportError(t("errorRead"), error, {
            context: { phase: "library-list" },
            retry: () => void runRefresh(false),
          });
        }
      } finally {
        inFlight.current -= 1;
        if (inFlight.current === 0) setRefreshing(false);
        // A dropped result must not end "loading": the newer request is still in flight and
        // will, so the first paint is never an empty list read as "no recordings".
        if (applied) setLoading(false);
      }
    }
  }, []);
  const refresh = useCallback((): Promise<void> => runRefresh(false), [runRefresh]);

  // NIW2-560: the file follows the title, so the item's id can change. Patched by
  // assetId (the identity), not by the old id; main also broadcasts `library:changed`.
  const rename = useCallback(
    async (id: string, assetId: string, title: string): Promise<void> => {
      try {
        const result = await window.electronAPI.renameLocalRecording(id, assetId, title);
        const { recording } = result;
        setVideos((prev) =>
          prev.map((video) =>
            video.assetId === recording.assetId
              ? {
                  ...video,
                  id: recording.id,
                  title: recording.title,
                  thumbnailUrl: recording.thumbnailUrl ?? null,
                }
              : video,
          ),
        );
        // Retry goes straight to main with the same title: it is already saved, so the
        // "title changed" check of the rename field would skip it.
        notifyRenameOutcome(result, { library: t, common: tCommon }, () => {
          void rename(recording.id, recording.assetId, recording.title);
        });
      } catch (error) {
        // A double commit, or the item vanished: the list is stale, not the user's action.
        if (isItemNotFoundError(error)) {
          void refresh();
          return;
        }
        if (isAmbiguousIdentityError(error)) {
          notifyAmbiguousIdentity(t);
          return;
        }
        if (notifyVaultRefusal(error, t)) return;
        reportError(t("errorRename"), error, { context: { id } });
      }
    },
    [refresh, t, tCommon],
  );

  const setTags = useCallback(async (id: string, tagIds: readonly string[]) => {
    try {
      const stored = await window.electronAPI.setItemTags(id, tagIds);
      setVideos((prev) =>
        prev.map((video) => (video.id === id ? { ...video, tagIds: stored } : video)),
      );
    } catch (error) {
      if (notifyVaultRefusal(error, t)) return;
      reportError(t("errorTags"), error, { context: { id } });
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    try {
      await window.electronAPI.deleteLocalRecording(id);
      setVideos((prev) => prev.filter((video) => video.id !== id));
    } catch (error) {
      if (notifyVaultRefusal(error, t)) return;
      reportError(t("errorDelete"), error, { context: { id } });
    }
  }, []);

  const reveal = useCallback((id: string) => {
    void window.electronAPI.revealLocalRecording(id);
  }, []);

  // The cloud is optional (not enabled for users yet): a rejected call must never reach an
  // unhandled-rejection handler, and the local list never waits on it.
  const refreshCloud = useCallback(async (force = false): Promise<CatalogRefreshResult> => {
    try {
      return await window.electronAPI.refreshCloudCatalog(force);
    } catch {
      return { ok: false, reason: "network" };
    }
  }, []);

  const sync = useCallback(async () => {
    await Promise.all([refreshCloud(true), refresh()]);
  }, [refreshCloud, refresh]);

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
  // NIW2-845: the poster of a webcam recording, composed with the bubble. Only the poster
  // fields change, on the item as it is now: the compose ran for a while, and the item may
  // have been renamed or re-listed meanwhile.
  const patchThumbnail = useCallback((updated: LibraryVideo) => {
    setVideos((prev) =>
      prev.map((video) =>
        video.id === updated.id
          ? {
              ...video,
              thumbnailUrl: updated.thumbnailUrl,
              thumbnailNeedsWebcam: updated.thumbnailNeedsWebcam,
            }
          : video,
      ),
    );
  }, []);
  useWebcamThumbnail(localVideos, patchThumbnail);

  useEffect(() => {
    void refresh();
    // Fire-and-forget: re-confirm the cloud catalog against the server on mount, so
    // signing in (or reopening the app) doesn't leave a stale/empty cached catalog
    // showing until the user manually refreshes. Main throttles it (30 s) and, when the
    // catalog really changed, broadcasts `library:changed`, which the listener below turns into a re-list.
    void refreshCloud(false);
    // Re-list when the vault folder changes (Settings → Files), so an open
    // Library page doesn't keep showing the old folder's contents.
    return window.electronAPI.onLibraryChanged(() => void refresh());
  }, [refresh, refreshCloud]);

  // Synced folders: the provider downloads a file on its own, outside the app, and nothing in
  // main watches the folder. While some item still reads "Not downloaded", coming back to the
  // window re-lists, so the page does not stay on a state the file has already left. Nothing is
  // listened to when no item is offloaded, so a plain workspace pays nothing.
  //
  // Each re-list lists the provider's folder in main, which can hang for minutes on a stalled
  // provider, so a focus does not start one while another is running or within
  // `FOCUS_RELIST_MIN_INTERVAL_MS` of the last, and a focus re-list that fails stays quiet.
  const anyEvicted = useMemo(() => videos.some((v) => v.evicted !== undefined), [videos]);
  const lastFocusRelist = useRef(0);
  useEffect(() => {
    if (!anyEvicted) return;
    const onFocus = (): void => {
      const now = Date.now();
      if (inFlight.current > 0) return;
      if (now - lastFocusRelist.current < FOCUS_RELIST_MIN_INTERVAL_MS) return;
      lastFocusRelist.current = now;
      void runRefresh(true);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [anyEvicted, runRefresh]);

  return {
    videos,
    isLoading,
    isRefreshing,
    hasError,
    catalogVerifiedAt,
    refresh,
    refreshCloud,
    sync,
    rename,
    setTags,
    remove,
    reveal,
    removeLocalCopy,
  };
}
