import { useEffect, useState } from "react";
import { useWindowFocus } from "../settings-controls/use-window-focus";

/**
 * The microphone's bars (0..1) from the take in progress. Subscribes through the preload
 * only while `active` and focused, so the recorder reads and sends levels only when a meter
 * is actually on screen; nothing here goes through the activity broadcast. `undefined`
 * until the first reading.
 */
export function useTakeMicLevels(active: boolean): number[] | undefined {
  const [levels, setLevels] = useState<number[] | undefined>(undefined);
  const focused = useWindowFocus();
  const subscribed = active && focused;

  useEffect(() => {
    if (!subscribed) return;
    const unsubscribe = window.electronAPI.subscribeMicLevels(setLevels);
    return () => {
      unsubscribe();
      setLevels(undefined);
    };
  }, [subscribed]);

  return levels;
}
