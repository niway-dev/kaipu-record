import { useEffect, useState } from "react";
import { FLAG_DEFAULTS, FLAG_NAMES, type FlagName } from "@shared/analytics";
import {
  currentFlagOverrides,
  flagState,
  onFlagsChanged,
  type FlagSource,
} from "./analytics-client";

export interface FlagRow {
  name: FlagName;
  value: boolean;
  source: FlagSource;
}

function readRows(): FlagRow[] {
  return FLAG_NAMES.map((name) => ({ name, ...flagState(name, FLAG_DEFAULTS[name]) }));
}

/** Every flag with its effective value and source; re-renders when an override or PostHog changes. */
export function useFlagRows(): FlagRow[] {
  const [rows, setRows] = useState(readRows);
  useEffect(() => {
    setRows(readRows());
    return onFlagsChanged(() => setRows(readRows()));
  }, []);
  return rows;
}

/** True while any flag is pinned by an override (launch variable or Developer page). */
export function useAnyFlagOverridden(): boolean {
  const [overridden, setOverridden] = useState(
    () => Object.keys(currentFlagOverrides()).length > 0,
  );
  useEffect(() => {
    const read = (): void => setOverridden(Object.keys(currentFlagOverrides()).length > 0);
    read();
    return onFlagsChanged(read);
  }, []);
  return overridden;
}
