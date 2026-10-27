import { useEffect, useState } from "react";

const hasFocus = (): boolean => (typeof document === "undefined" ? true : document.hasFocus());

/**
 * Whether this window has focus. Starts from `document.hasFocus()` and follows the window's
 * `focus` and `blur` events. `visibilitychange` is not enough here: the windows disable
 * background throttling, so a hidden window may never report itself hidden.
 */
export function useWindowFocus(): boolean {
  const [focused, setFocused] = useState(hasFocus);
  useEffect(() => {
    const onFocus = (): void => setFocused(true);
    const onBlur = (): void => setFocused(false);
    setFocused(hasFocus());
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
  return focused;
}
