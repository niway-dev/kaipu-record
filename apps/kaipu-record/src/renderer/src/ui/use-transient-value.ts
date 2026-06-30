import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A value that auto-clears to `null` after `ms`. For transient UI feedback
 * (a "Copied"/"Saved" flash, a toast): call `show(v)` to set it; it resets itself,
 * and the timer is cleared on unmount. One place for the timer bookkeeping that was
 * hand-rolled per call site.
 */
export function useTransientValue<T>(ms: number): [T | null, (value: T) => void] {
  const [value, setValue] = useState<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const show = useCallback(
    (next: T) => {
      setValue(next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setValue(null), ms);
    },
    [ms],
  );

  return [value, show];
}
