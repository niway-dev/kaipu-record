/**
 * Debounced autosave of the video edit session.
 *
 * Before v2 the session was written only on export. `useBlocker` intercepts in-app
 * navigation and nothing else, so closing the window (⌘W, quit, a crash) silently threw
 * away every cut, every zoom and — the part that actually matters — every privacy
 * redaction the user had just drawn. See plans/video-editor-v2/07 and audit W11.
 *
 * Contract:
 *   - a write is scheduled AUTOSAVE_DEBOUNCE_MS after the scene changes, never while a
 *     drag owns the scene (`interacting`) — one write per gesture, not per pointermove;
 *   - the pending write is flushed on unmount and on `beforeunload`;
 *   - `pendingRef` is true from the moment the scene changes until the write resolves;
 *     the page's navigation blocker reads it, so the discard dialog now means "a write
 *     is still pending or failed", not "you have edits";
 *   - `cancel()` drops the pending write — that is what the dialog's Discard button
 *     does, and it is what makes the dialog honest;
 *   - the header chip says "Saving…" only while a write is in flight. Between an edit and
 *     its write (a whole drag, then the debounce) it shows nothing: the owner read a chip
 *     that lit up on the first pointer move as "every change is saved immediately".
 *
 * The scene the editor OPENED with is never written back: opening a recording and
 * leaving must not create a session file (and must not turn a pre-v2 recording into a
 * v2 one just because the detector proposed some zooms).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { captureException } from "@renderer/features/analytics";
import { editProjectRefusal, isMaintenanceError } from "@renderer/features/library/vault-errors";
import type { VideoScene } from "./scene";
import { serializeSession } from "./session";
import type { SlideAssetStore } from "./slide-assets";

export const AUTOSAVE_DEBOUNCE_MS = 800;

export type SaveState = "idle" | "saving" | "saved" | "failed";

export interface SessionAutosave {
  /** True while an edit has not reached the session file yet (or its write failed). */
  pendingRef: React.MutableRefObject<boolean>;
  /** Write now, skipping the debounce; resolves once the write settles. */
  flush(): Promise<void>;
  /** Drop the pending write (Discard, or an explicit save that supersedes it). */
  cancel(): void;
  /** For the header chip: "saving" while a write is in flight, "idle" while edits wait. */
  state: SaveState;
  /** Write now after a failure (the chip's click). No-op unless something is pending. */
  retry(): Promise<void>;
}

export function useSessionAutosave(
  sourceId: string,
  scene: VideoScene,
  interacting: boolean,
  assetStoreRef: React.MutableRefObject<SlideAssetStore>,
  options: {
    /**
     * Called once per run of refusals (until a save goes through) when a synced folder refused
     * the save and main kept the edits as a draft on this computer: the user is told where
     * their edits are, instead of a "Couldn't save" that retrying cannot fix.
     */
    onKeptOnThisComputer?: (reason: "cloud-only" | "folder-busy") => void;
  } = {},
): SessionAutosave {
  const openedWith = useRef(scene);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const touchedRef = useRef(false);
  const pendingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Writes can overlap (the debounce, retry() and the maintenance retry do not wait for
  // one in flight). Only the latest write may set the chip or clear the flag.
  const writeGenRef = useRef(0);
  const [state, setState] = useState<SaveState>("idle");
  const keptRef = useRef(options.onKeptOnThisComputer);
  keptRef.current = options.onKeptOnThisComputer;
  const keptToldRef = useRef(false);

  const write = useCallback(async (): Promise<void> => {
    const snapshot = sceneRef.current;
    const gen = ++writeGenRef.current;
    setState("saving");
    try {
      const assets = assetStoreRef.current
        .entries()
        .map((a) => ({ assetId: a.assetId, bytes: a.bytes }));
      await window.electronAPI.saveVideoEditSession(sourceId, serializeSession(snapshot), assets);
      // A newer write is in flight or already landed: it owns the chip and the flag.
      if (gen !== writeGenRef.current) return;
      keptToldRef.current = false;
      // An edit may have landed while the write was in flight; it owns the flag now, and
      // nothing is in flight any more, so the chip goes quiet until that edit's write.
      if (sceneRef.current === snapshot) {
        pendingRef.current = false;
        setState("saved");
      } else {
        setState("idle");
      }
    } catch (error) {
      // Non-fatal: keep `pendingRef` true so the discard dialog still warns on the way
      // out, and let the next edit retry. A refusal during "Check and fix files" is not
      // a fault: it is retried when maintenance ends (below).
      const refusal = editProjectRefusal(error);
      if (refusal !== null) {
        // Not a fault: the folder cannot answer now, and main kept the edits as a draft on this
        // computer. Said once, not on every edit.
        if (!keptToldRef.current) {
          keptToldRef.current = true;
          keptRef.current?.(refusal);
        }
      } else if (!isMaintenanceError(error)) {
        captureException(error, { context: "video-edit-session-autosave" });
      }
      if (gen === writeGenRef.current) setState("failed");
    }
  }, [sourceId, assetStoreRef]);

  const cancel = useCallback((): void => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    pendingRef.current = false;
    setState("idle");
  }, []);

  const flush = useCallback(async (): Promise<void> => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (!pendingRef.current) return;
    await write();
  }, [write]);

  const retry = useCallback(async (): Promise<void> => {
    if (!pendingRef.current) return;
    await write();
  }, [write]);

  // Declared BEFORE the flush effect on purpose: React runs cleanups in declaration
  // order, so the debounce timer is cleared before the unmount flush fires.
  useEffect(() => {
    if (!touchedRef.current && scene === openedWith.current) return;
    touchedRef.current = true;
    // Set before the `interacting` early return so closing the window mid-drag still
    // flushes the live scene.
    pendingRef.current = true;
    // A stale "Saved" would lie about the edit in progress; "failed" stays until a write
    // succeeds. React bails out of the update when the value is unchanged.
    setState((current) => (current === "saved" ? "idle" : current));
    if (interacting) return;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void write();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [scene, interacting, write]);

  // NIW2-561: main refuses saves while it fixes the vault's files, and queues nothing; the
  // latest pending scene is written again once it is done.
  const retryRef = useRef(retry);
  retryRef.current = retry;
  useEffect(
    () => window.electronAPI.onLibraryMaintenanceEnded?.(() => void retryRef.current()),
    [],
  );

  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    const onBeforeUnload = (): void => {
      // beforeunload cannot await. The write is fired and the process may die before
      // the IPC round-trip lands, so at most AUTOSAVE_DEBOUNCE_MS of work is at risk —
      // which is the whole point of keeping the debounce short.
      void flushRef.current();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      void flushRef.current();
    };
  }, []);

  return { pendingRef, flush, cancel, state, retry };
}
