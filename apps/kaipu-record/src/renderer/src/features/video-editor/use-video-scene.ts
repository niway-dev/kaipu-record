import { useCallback, useRef, useState } from "react";
import type { VideoScene } from "./scene";

export interface VideoSceneController {
  scene: VideoScene;
  /** True once at least one commit is on the undo stack (clean again after undoing all). */
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
  /** One undoable step; no-op if `next` is reference-equal to the current scene. */
  commit(next: VideoScene): void;
  /** Snapshot the scene before a continuous interaction (drag). */
  beginInteract(): void;
  /** Live-update the scene during an interaction (no history entry yet). */
  updateLive(next: VideoScene): void;
  /** Collapse the interaction into one undo step, if the scene actually changed. */
  endInteract(): void;
}

/**
 * Undo/redo history for the video-editor scene, ported 1:1 from the screenshot editor's
 * useEditorScene (see features/screenshots/annotations/use-editor-scene.ts): same
 * past/future stacks, same interactBase-ref snapshot for drags, same reference-equality
 * no-op guards. Consistency with the proven hook matters more than novelty here.
 */
export function useVideoScene(initial: VideoScene): VideoSceneController {
  const [scene, setScene] = useState<VideoScene>(initial);
  const [past, setPast] = useState<VideoScene[]>([]);
  const [future, setFuture] = useState<VideoScene[]>([]);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const snapshot = useRef<VideoScene | null>(null);

  const commit = useCallback((next: VideoScene) => {
    // A drag owns history via begin/updateLive/endInteract — a stray commit mid-drag
    // (e.g. a keyboard shortcut firing while a pointer is still down) would fork the
    // in-progress interaction into its own undo step and corrupt the snapshot base.
    if (snapshot.current !== null) return;
    if (next === sceneRef.current) return;
    setPast((p) => [...p, sceneRef.current]);
    setFuture([]);
    setScene(next);
  }, []);

  const beginInteract = useCallback(() => {
    snapshot.current = sceneRef.current;
  }, []);

  const updateLive = useCallback((next: VideoScene) => {
    setScene(next);
    // Keep the ref in sync so endInteract can compare correctly within the same tick.
    sceneRef.current = next;
  }, []);

  const endInteract = useCallback(() => {
    const snap = snapshot.current;
    snapshot.current = null;
    if (snap && snap !== sceneRef.current) {
      setPast((p) => [...p, snap]);
      setFuture([]);
    }
  }, []);

  const undo = useCallback(() => {
    // Same rationale as commit(): a ⌘Z fired mid-drag must not touch history — the
    // drag's own snapshot is still pending in endInteract.
    if (snapshot.current !== null) return;
    if (past.length === 0) return;
    setFuture((f) => [sceneRef.current, ...f]);
    setScene(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
  }, [past]);

  const redo = useCallback(() => {
    if (snapshot.current !== null) return;
    if (future.length === 0) return;
    setPast((p) => [...p, sceneRef.current]);
    setScene(future[0]);
    setFuture((f) => f.slice(1));
  }, [future]);

  return {
    scene,
    dirty: past.length > 0,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    undo,
    redo,
    commit,
    beginInteract,
    updateLive,
    endInteract,
  };
}
