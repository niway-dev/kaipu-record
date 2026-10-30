import { matchPath } from "react-router-dom";
import { ROUTES } from "@shared/routes";

/** The part of react-router's data router a switch needs (so tests can pass a memory router). */
export interface SwitchRouter {
  readonly state: {
    location: { pathname: string };
    blockers: ReadonlyMap<string, { state: string }>;
    navigation: { state: string };
  };
  navigate(to: string): Promise<void>;
  subscribe(listener: (state: SwitchRouter["state"]) => void): () => void;
}

/** Pages that hold one item of the active workspace, and the list each goes back to. */
const ITEM_ROUTES: ReadonlyArray<[pattern: string, back: string]> = [
  [ROUTES.editorVideo, ROUTES.editor],
  [ROUTES.editorImage, ROUTES.editor],
  [ROUTES.editorCapture, ROUTES.editor],
  [ROUTES.editorNew, ROUTES.editor],
  [ROUTES.videoEditor, ROUTES.editor],
  [ROUTES.screenshotEditor, ROUTES.editor],
  [ROUTES.libraryDetail, ROUTES.library],
];

/** Where a switch sends `pathname`, or null when that page holds no item. */
export function closeTargetFor(pathname: string): string | null {
  for (const [pattern, back] of ITEM_ROUTES) {
    if (matchPath({ path: pattern, end: true }, pathname)) return back;
  }
  return null;
}

/**
 * This window's part of a switch (ADR 0032, decision 7): flush every pending save, then
 * close the page that holds an item. Closing is a normal navigation, so an editor with
 * unsaved work asks through its own leave guard: Discard (or a save) lets the switch go on,
 * Keep editing cancels it. Resolves whether the window is ready.
 */
export async function prepareForSwitch(
  router: SwitchRouter,
  flushers: Iterable<() => Promise<void>>,
): Promise<boolean> {
  // While the editor is still mounted: its save is a call into the old workspace, which
  // main still accepts until every window has answered.
  for (const flush of flushers) {
    try {
      await flush();
    } catch (error) {
      // The editor's guard sees the save as still pending and asks the user.
      console.error("workspace switch: a pending save could not be flushed", error);
    }
  }
  const from = router.state.location.pathname;
  const target = closeTargetFor(from);
  if (!target) return true;

  return new Promise<boolean>((resolve) => {
    let asked = false;
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      unsubscribe();
      resolve(ok);
    };
    const unsubscribe = router.subscribe((state) => {
      if (state.location.pathname !== from) return finish(true);
      // "blocked" while the guard asks, "proceeding" once the user let it go.
      const pending = [...state.blockers.values()].some((b) => b.state !== "unblocked");
      if (pending) asked = true;
      // The guard asked and the user kept editing: the blocker reset, the page stayed.
      else if (asked && state.navigation.state === "idle") finish(false);
    });
    void router.navigate(target).then(() => {
      if (router.state.location.pathname !== from) finish(true);
    });
  });
}

/** Saves an open editor must write before a switch (its debounced autosave). */
const flushers = new Set<() => Promise<void>>();

/** Register a save to flush before a switch; returns the unregister function. */
export function registerSwitchFlush(flush: () => Promise<void>): () => void {
  flushers.add(flush);
  return () => flushers.delete(flush);
}

export function switchFlushers(): Iterable<() => Promise<void>> {
  return [...flushers];
}
