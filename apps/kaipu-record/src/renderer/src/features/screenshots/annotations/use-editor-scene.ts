import { useCallback, useRef, useState } from "react";
import { DEFAULT_BEAUTIFY, type BeautifyState } from "../beautify/backgrounds";
import type { BeautifyController } from "../beautify/use-beautify";
import { sameScene, type Annotation, type CropRect, type Scene } from "./scene";

export interface EditorScene {
  /** Beautify controls, shaped like BeautifyController so the panel is unchanged. */
  beautify: BeautifyController;
  annotations: Annotation[];
  selectedId: string | null;
  select(id: string | null): void;
  addAnnotation(annotation: Annotation): void;
  /** Edit an existing annotation as a single, undoable change (e.g. recolor). */
  commitAnnotation(id: string, patch: Partial<Annotation>): void;
  /** Snapshot the scene before a continuous interaction (move/draw). */
  beginInteract(): void;
  /** Commit the interaction to history if the scene changed. */
  endInteract(): void;
  /** Delete one annotation by id as a single undoable change (selection is not consulted). */
  removeAnnotation(id: string): void;
  removeSelected(): void;
  crop?: CropRect;
  /** Set the crop as one undoable change (Reset/Esc, or an external set). */
  setCrop(crop: CropRect | undefined): void;
  /**
   * Canvas mode: the export window, world-normalized (see `Scene.exportFrame`). Undefined =
   * the whole content box.
   */
  exportFrame?: CropRect;
  /** Set the export frame as one undoable change (Reset/Esc, or a crop drag release). */
  setExportFrame(frame: CropRect | undefined): void;
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
}

/** Unified editor scene (beautify + annotations) with one undo/redo history. The
 *  initial beautify can be overridden (a re-opened flat screenshot starts unframed). */
export function useEditorScene(
  initialBeautify: BeautifyState = DEFAULT_BEAUTIFY,
  /** A reopened document's content (ADR 0053): the scene starts as saved, with an empty history. */
  initial?: Pick<Scene, "annotations" | "exportFrame">,
): EditorScene {
  const [scene, setScene] = useState<Scene>(() => ({
    beautify: initialBeautify,
    annotations: initial?.annotations ?? [],
    ...(initial?.exportFrame ? { exportFrame: initial.exportFrame } : {}),
  }));
  const [past, setPast] = useState<Scene[]>([]);
  const [future, setFuture] = useState<Scene[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const snapshot = useRef<Scene | null>(null);

  const commit = useCallback((next: Scene) => {
    setPast((p) => [...p, sceneRef.current]);
    setFuture([]);
    setScene(next);
  }, []);

  const beginInteract = useCallback(() => {
    snapshot.current = sceneRef.current;
  }, []);

  const endInteract = useCallback(() => {
    const snap = snapshot.current;
    snapshot.current = null;
    if (snap && !sameScene(snap, sceneRef.current)) {
      setPast((p) => [...p, snap]);
      setFuture([]);
    }
  }, []);

  // A drag owns the history until it ends: stepping through it mid-drag (a key chord) would let
  // `endInteract` push a stale snapshot over the step just taken.
  const undo = useCallback(() => {
    if (snapshot.current !== null || past.length === 0) return;
    setFuture((f) => [sceneRef.current, ...f]);
    setScene(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
    setSelectedId(null);
  }, [past]);

  const redo = useCallback(() => {
    if (snapshot.current !== null || future.length === 0) return;
    setPast((p) => [...p, sceneRef.current]);
    setScene(future[0]);
    setFuture((f) => f.slice(1));
    setSelectedId(null);
  }, [future]);

  const addAnnotation = useCallback(
    (annotation: Annotation) => {
      commit({ ...sceneRef.current, annotations: [...sceneRef.current.annotations, annotation] });
    },
    [commit],
  );

  const commitAnnotation = useCallback(
    (id: string, patch: Partial<Annotation>) => {
      commit({
        ...sceneRef.current,
        annotations: sceneRef.current.annotations.map((a) =>
          a.id === id ? ({ ...a, ...patch } as Annotation) : a,
        ),
      });
    },
    [commit],
  );

  const setCrop = useCallback(
    (crop: CropRect | undefined) => {
      commit({ ...sceneRef.current, crop });
    },
    [commit],
  );

  const setExportFrame = useCallback(
    (exportFrame: CropRect | undefined) => {
      commit({ ...sceneRef.current, exportFrame });
    },
    [commit],
  );

  const removeAnnotation = useCallback(
    (id: string) => {
      if (!sceneRef.current.annotations.some((a) => a.id === id)) return;
      commit({
        ...sceneRef.current,
        annotations: sceneRef.current.annotations.filter((a) => a.id !== id),
      });
      setSelectedId((cur) => (cur === id ? null : cur));
    },
    [commit],
  );

  const removeSelected = useCallback(() => {
    if (selectedId) removeAnnotation(selectedId);
  }, [selectedId, removeAnnotation]);

  const beautify: BeautifyController = {
    state: scene.beautify,
    commit: (patch) =>
      commit({ ...sceneRef.current, beautify: { ...sceneRef.current.beautify, ...patch } }),
    beginEdit: beginInteract,
    setLive: (patch) => setScene((s) => ({ ...s, beautify: { ...s.beautify, ...patch } })),
    endEdit: endInteract,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };

  return {
    beautify,
    annotations: scene.annotations,
    selectedId,
    select: setSelectedId,
    addAnnotation,
    commitAnnotation,
    beginInteract,
    endInteract,
    removeAnnotation,
    removeSelected,
    crop: scene.crop,
    setCrop,
    exportFrame: scene.exportFrame,
    setExportFrame,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
}
