import { useCallback, useRef, useState } from "react";
import { DEFAULT_BEAUTIFY, type BeautifyState } from "./backgrounds";

export interface BeautifyController {
  state: BeautifyState;
  /** Discrete change (e.g. picking a background) — snapshots history immediately. */
  commit(patch: Partial<BeautifyState>): void;
  /** Begin a continuous edit (slider drag) — captures the pre-edit snapshot. */
  beginEdit(): void;
  /** Live value during a continuous edit — no history entry yet. */
  setLive(patch: Partial<BeautifyState>): void;
  /** End a continuous edit — snapshots history if the value actually changed. */
  endEdit(): void;
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
}

function sameState(a: BeautifyState, b: BeautifyState): boolean {
  return a.bg === b.bg && a.padding === b.padding && a.radius === b.radius && a.shadow === b.shadow;
}

/** Beautify state with undo/redo. Drags update live; history snaps on commit/release. */
export function useBeautify(): BeautifyController {
  const [state, setState] = useState<BeautifyState>(DEFAULT_BEAUTIFY);
  const [past, setPast] = useState<BeautifyState[]>([]);
  const [future, setFuture] = useState<BeautifyState[]>([]);
  const stateRef = useRef(state);
  stateRef.current = state;
  const snapshot = useRef<BeautifyState | null>(null);

  const setLive = useCallback((patch: Partial<BeautifyState>) => {
    setState((s) => ({ ...s, ...patch }));
  }, []);

  const commit = useCallback((patch: Partial<BeautifyState>) => {
    setPast((p) => [...p, stateRef.current]);
    setFuture([]);
    setState((s) => ({ ...s, ...patch }));
  }, []);

  const beginEdit = useCallback(() => {
    snapshot.current = stateRef.current;
  }, []);

  const endEdit = useCallback(() => {
    const snap = snapshot.current;
    snapshot.current = null;
    if (snap && !sameState(snap, stateRef.current)) {
      setPast((p) => [...p, snap]);
      setFuture([]);
    }
  }, []);

  const undo = useCallback(() => {
    if (past.length === 0) return;
    setFuture((f) => [stateRef.current, ...f]);
    setState(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
  }, [past]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    setPast((p) => [...p, stateRef.current]);
    setState(future[0]);
    setFuture((f) => f.slice(1));
  }, [future]);

  return {
    state,
    commit,
    beginEdit,
    setLive,
    endEdit,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
}
