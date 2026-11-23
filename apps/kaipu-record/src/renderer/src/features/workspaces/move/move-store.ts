import { useSyncExternalStore } from "react";
import type { MoveProgress } from "@shared/types/workspaces";

/** "Move all N" / "Move only …", or null when the dialog was dismissed (nothing moves). */
export type ExportsAnswer = "all" | "only" | null;

export interface ExportsPrompt {
  /** How many exports the selection's recordings have in the source workspace. */
  count: number;
  /** The source workspace's name. */
  source: string;
  /** Items selected (the recording alone, or a multi-select). */
  selected: number;
  answer(choice: ExportsAnswer): void;
}

/** "Moving out of a synced folder deletes it from the cloud": confirm, or cancel. */
export interface SyncedMovePrompt {
  /** The source workspace's name. */
  source: string;
  answer(confirmed: boolean): void;
}

interface MoveUiState {
  /** "Moving 3 of 12" while a group this window started runs; null otherwise. */
  progress: MoveProgress | null;
  prompt: ExportsPrompt | null;
  syncedPrompt: SyncedMovePrompt | null;
}

let state: MoveUiState = { progress: null, prompt: null, syncedPrompt: null };
const listeners = new Set<() => void>();

function set(patch: Partial<MoveUiState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMoveUi(): MoveUiState {
  return useSyncExternalStore(subscribe, () => state);
}

export function setMoveProgress(progress: MoveProgress | null): void {
  set({ progress });
}

/** Ask "Move them too?" (ADR 0033, decision 15); resolves the user's answer. */
export function askAboutExports(question: Omit<ExportsPrompt, "answer">): Promise<ExportsAnswer> {
  state.prompt?.answer(null);
  return new Promise((resolve) => {
    set({
      prompt: {
        ...question,
        answer: (choice) => {
          set({ prompt: null });
          resolve(choice);
        },
      },
    });
  });
}

/**
 * Ask before a move out of a synced workspace (decision 4): the file leaves the provider's
 * folder, and the provider deletes it from the cloud on every device. Resolves true to go on.
 */
export function askAboutSyncedMove(question: Omit<SyncedMovePrompt, "answer">): Promise<boolean> {
  state.syncedPrompt?.answer(false);
  return new Promise((resolve) => {
    set({
      syncedPrompt: {
        ...question,
        answer: (confirmed) => {
          set({ syncedPrompt: null });
          resolve(confirmed);
        },
      },
    });
  });
}

/** For tests: back to nothing running and nothing asked. */
export function resetMoveUi(): void {
  state = { progress: null, prompt: null, syncedPrompt: null };
}
