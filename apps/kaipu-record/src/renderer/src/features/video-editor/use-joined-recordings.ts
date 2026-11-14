import { useEffect, useMemo, useRef, useState } from "react";
import type { CursorTrack } from "@shared/cursor-track";
import type { RecordingCapture } from "@shared/recording-capture";
import type { WebcamTrackMeta } from "@shared/webcam-track";
import { loadCursorTrackBestEffort, readJoinedLibrary } from "./joined-library";
import type { SceneSource } from "./scene";

/** A recording joined into the sequence (ADR 0058), with the media data the editor reads. */
export interface JoinedRecording {
  source: SceneSource;
  /** `missing`: the asset is gone, cloud-only, or its hold was refused. The editor goes on. */
  status: "loading" | "ready" | "missing";
  /** The current vault file stem (changes on rename); null while loading or when missing. */
  id: string | null;
  cursorTrack: CursorTrack | null;
  webcam: WebcamTrackMeta | null;
  capture: RecordingCapture | null;
}

type Loaded = Omit<JoinedRecording, "source">;

const NONE: readonly SceneSource[] = [];
const MISSING: Loaded = {
  status: "missing",
  id: null,
  cursorTrack: null,
  webcam: null,
  capture: null,
};
const LOADING: Loaded = {
  status: "loading",
  id: null,
  cursorTrack: null,
  webcam: null,
  capture: null,
};

interface Started {
  cancelled: boolean;
  /** The id main acknowledged holding for this source, released when it goes away. */
  heldId: string | null;
}

/**
 * Loads every recording joined into the scene when the editor opens (and again when a new one
 * is joined), one entry per source in `sources` order. Each source's asset is resolved to its
 * CURRENT local id and held against renames the way the loader holds the opened recording
 * (`acquireEditorSession`, released with `closeEditorSession` when the source leaves the scene
 * or the editor unmounts); the webcam meta and capture come from the Library item, and the
 * cursor track is a best-effort read. It never throws and never blocks the editor: whatever
 * cannot be resolved is `missing`. A new source loads without reloading the others (keyed by
 * `source.id`).
 */
export function useJoinedRecordings(
  sources: readonly SceneSource[] | undefined,
): JoinedRecording[] {
  const list = sources ?? NONE;
  const [loaded, setLoaded] = useState<ReadonlyMap<string, Loaded>>(() => new Map());
  const started = useRef(new Map<string, Started>());

  useEffect(() => {
    const wanted = new Map(list.map((s) => [s.id, s]));

    // A source that left the scene (an undone join): stop its load and free its hold.
    const gone = [...started.current.keys()].filter((id) => !wanted.has(id));
    for (const id of gone) {
      const entry = started.current.get(id)!;
      entry.cancelled = true;
      if (entry.heldId !== null) window.electronAPI.closeEditorSession(entry.heldId);
      started.current.delete(id);
    }
    if (gone.length > 0) {
      setLoaded((prev) => {
        const next = new Map(prev);
        for (const id of gone) next.delete(id);
        return next;
      });
    }

    const fresh = [...wanted.values()].filter((s) => !started.current.has(s.id));
    if (fresh.length === 0) return;
    const entries = fresh.map((source): [SceneSource, Started] => {
      const entry: Started = { cancelled: false, heldId: null };
      started.current.set(source.id, entry);
      return [source, entry];
    });

    void (async () => {
      let library: Awaited<ReturnType<typeof readJoinedLibrary>> | null = null;
      try {
        library = await readJoinedLibrary(fresh.map((s) => s.assetId));
      } catch {
        // An unreadable library says nothing about the recordings: show them missing for now, but
        // forget that they were started so the next scene change reads again. The effect depends
        // on `list` only, so this cannot loop inside one pass.
        for (const [source, entry] of entries) {
          if (started.current.get(source.id) === entry) started.current.delete(source.id);
        }
      }
      await Promise.all(
        entries.map(async ([source, entry]) => {
          const result = await resolve(source, entry, library);
          if (entry.cancelled) return;
          setLoaded((prev) => new Map(prev).set(source.id, result));
        }),
      );
    })();
  }, [list]);

  // Unmount: release every hold still taken. Clearing `started` lets a strict-mode remount
  // (effect, cleanup, effect) load again instead of waiting for results that were cancelled.
  useEffect(() => {
    const map = started.current;
    return () => {
      for (const entry of map.values()) {
        entry.cancelled = true;
        if (entry.heldId !== null) window.electronAPI.closeEditorSession(entry.heldId);
      }
      map.clear();
    };
  }, []);

  return useMemo(
    () => list.map((source) => ({ source, ...(loaded.get(source.id) ?? LOADING) })),
    [list, loaded],
  );
}

async function resolve(
  source: SceneSource,
  entry: Started,
  library: Awaited<ReturnType<typeof readJoinedLibrary>> | null,
): Promise<Loaded> {
  const item = library?.get(source.assetId);
  if (!item) return MISSING;
  let heldId: string | null;
  try {
    heldId = await window.electronAPI.acquireEditorSession(source.assetId);
  } catch {
    return MISSING;
  }
  if (heldId === null) return MISSING;
  if (entry.cancelled) {
    window.electronAPI.closeEditorSession(heldId);
    return MISSING;
  }
  entry.heldId = heldId;
  const cursorTrack = await loadCursorTrackBestEffort(heldId);
  return { status: "ready", id: heldId, cursorTrack, webcam: item.webcam, capture: item.capture };
}
