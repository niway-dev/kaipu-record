import { useEffect, useState } from "react";
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
/**
 * History entries already asked for. Module-wide, not a ref: Back from Export or the editor
 * remounts the page on the same entry (same key, `fromRecording` still in its state), and a
 * ref would reset with the page and float a second card. It also covers StrictMode's second
 * effect run.
 */
const askedKeys = new Set<string>();

/** Forget every asked entry, so each test starts clean. */
export function __resetFloatingReadyCardForTests(): void {
  askedKeys.clear();
}

export function useFloatingReadyCard(request: FloatingReadyRequest | null): { inApp: boolean } {
  const [fallbackFor, setFallbackFor] = useState<string | null>(null);

  useEffect(() => {
    if (!request || askedKeys.has(request.key)) return;
    const { key, payload } = request;
    askedKeys.add(key);
    const fallBack = (): void => setFallbackFor(key);
    window.electronAPI.showRecordingReady(payload).then((shown) => {
      if (!shown) fallBack();
    }, fallBack);
  }, [request]);

  return { inApp: request !== null && fallbackFor === request.key };
}
