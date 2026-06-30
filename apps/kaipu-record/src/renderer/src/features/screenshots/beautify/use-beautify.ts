import type { BeautifyState } from "./backgrounds";

/**
 * The beautify panel's controller contract. The live implementation is provided by
 * `useEditorScene` (which owns the unified beautify + annotations undo/redo history);
 * `BeautifyPanel` only depends on this shape, not on where it comes from.
 */
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
