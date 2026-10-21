import { useSyncExternalStore } from "react";

/**
 * Test-only stand-in for `use-sync-external-store/shim` (and its `with-selector` entry).
 *
 * The real shim is CommonJS, so Vitest loads it with Node's own `require("react")`, which can
 * hand it the other React copy in this workspace (see `vitest.config.ts`) and crash with a null
 * dispatcher. React 19 has the hook natively, which is all the shim falls back to.
 */
export { useSyncExternalStore };

export function useSyncExternalStoreWithSelector<Snapshot, Selection>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => Snapshot,
  getServerSnapshot: undefined | null | (() => Snapshot),
  selector: (snapshot: Snapshot) => Selection,
): Selection {
  return selector(useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot ?? getSnapshot));
}
