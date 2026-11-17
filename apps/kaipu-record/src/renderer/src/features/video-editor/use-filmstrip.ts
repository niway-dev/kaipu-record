/**
 * Runs the zoom-aware filmstrip for one editor window (ADR 0064, layer 3), only while
 * `zoom-filmstrip` is on. It owns a {@link FilmstripController}, feeds it from the timeline view
 * store (never from a render: the strip re-renders on every scroll tick), and ends it, and its
 * worker, when the editor goes away. With `enabled` false it does nothing at all.
 */
import { useEffect, useMemo, useRef } from "react";
import { FilmstripController } from "./filmstrip-controller";
import {
  TERMINATE_WORKER_ON_IDLE_CLOSE,
  createFilmstripWorker,
  getFilmstripStore,
} from "./filmstrip-service";
import { buildFilmstripTargets, type FilmstripFileInput } from "./filmstrip-targets";
import type { TimelineViewStore } from "./use-timeline-view";

export interface UseFilmstripOptions {
  enabled: boolean;
  viewStore: TimelineViewStore;
  /** The files of the lanes that are showing: a hidden lane's file is simply not listed. */
  files: readonly FilmstripFileInput[];
  /** The preview is playing or an export is running: the decoder is not ours (AC6). */
  paused: boolean;
  /** The playhead in SOURCE time, null over a slide. */
  playheadSource: number | null;
}

export function useFilmstrip({
  enabled,
  viewStore,
  files,
  paused,
  playheadSource,
}: UseFilmstripOptions): void {
  const controllerRef = useRef<FilmstripController | null>(null);
  const targets = useMemo(() => (enabled ? buildFilmstripTargets(files) : []), [enabled, files]);

  useEffect(() => {
    if (!enabled) return;
    const controller = new FilmstripController({
      store: getFilmstripStore(),
      prewarm: true,
      createWorker: createFilmstripWorker,
      getView: () => viewStore.getView(),
      terminateOnIdleClose: TERMINATE_WORKER_ON_IDLE_CLOSE,
    });
    controllerRef.current = controller;
    const offView = viewStore.subscribe(() => controller.viewChanged());
    // A workspace switch closes the editor first, so this is the belt to the store's braces.
    const offWorkspace = window.electronAPI?.workspaces?.onChanged?.(() => controller.reset());
    return () => {
      offView();
      offWorkspace?.();
      controller.dispose();
      controllerRef.current = null;
    };
  }, [enabled, viewStore]);

  useEffect(() => {
    controllerRef.current?.setPaused(paused);
  }, [enabled, viewStore, paused]);

  useEffect(() => {
    controllerRef.current?.setTargets(targets);
  }, [enabled, viewStore, targets]);

  useEffect(() => {
    controllerRef.current?.setPlayhead(playheadSource);
  }, [enabled, viewStore, playheadSource]);
}
