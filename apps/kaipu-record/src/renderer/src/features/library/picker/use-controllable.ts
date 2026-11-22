import { useCallback, useState } from "react";

/**
 * A value that is controlled when the caller passes one (`value !== undefined`) and kept here
 * otherwise. `onChange` fires in both modes, so a caller can watch an uncontrolled value.
 */
export function useControllable<T>(
  value: T | undefined,
  defaultValue: T,
  onChange?: (next: T) => void,
): [T, (next: T) => void] {
  const [inner, setInner] = useState<T>(defaultValue);
  const current = value !== undefined ? value : inner;
  const set = useCallback(
    (next: T): void => {
      if (value === undefined) setInner(next);
      onChange?.(next);
    },
    [value, onChange],
  );
  return [current, set];
}
