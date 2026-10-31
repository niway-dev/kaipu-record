import { useEffect, useRef, useState } from "react";
import type { RecordingReadyPayload } from "@shared/types/recording-ready";

/** One arrival on a recording's page: `key` is its history entry, so a revisit is a new one. */
export interface FloatingReadyRequest {
  key: string;
  payload: RecordingReadyPayload;
}

/**
 * Ask main to float "Your video is ready" on the desktop, once per arrival. `inApp` turns true
 * only when that window could not open (main answered false, or the IPC failed): the page
 * then shows the same card in its status stack instead, so the card is never shown twice
 * and never lost.
 */
export function useFloatingReadyCard(request: FloatingReadyRequest | null): { inApp: boolean } {
  // A ref, so StrictMode's second effect run does not ask again.
  const asked = useRef<string | null>(null);
  const [fallbackFor, setFallbackFor] = useState<string | null>(null);

  useEffect(() => {
    if (!request || asked.current === request.key) return;
    const { key, payload } = request;
    asked.current = key;
    const fallBack = (): void => setFallbackFor(key);
    window.electronAPI.showRecordingReady(payload).then((shown) => {
      if (!shown) fallBack();
    }, fallBack);
  }, [request]);

  return { inApp: request !== null && fallbackFor === request.key };
}
