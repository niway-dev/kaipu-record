import { useEffect, useState } from "react";
import { FLAG_DEFAULTS, type FlagName } from "@shared/analytics";
import { isFlagEnabled, onFlagsChanged } from "./analytics-client";

/**
 * Read a PostHog feature flag reactively. Returns the flag's documented default
 * (`FLAG_DEFAULTS`) until the SDK resolves — so behavior is deterministic offline
 * and re-renders once flags load or change.
 */
export function useFlag(name: FlagName): boolean {
  const [value, setValue] = useState<boolean>(() => isFlagEnabled(name, FLAG_DEFAULTS[name]));
  useEffect(() => {
    setValue(isFlagEnabled(name, FLAG_DEFAULTS[name]));
    return onFlagsChanged(() => setValue(isFlagEnabled(name, FLAG_DEFAULTS[name])));
  }, [name]);
  return value;
}
