import { useEffect, useState } from "react";
import type { RecordingReadyPayload } from "@shared/types/recording-ready";

/** One arrival on a recording's page: `key` is its history entry, so a revisit is a new one. */
export interface FloatingReadyRequest {
  key: string;
  payload: RecordingReadyPayload;
}

/**
 * What each history entry got, module-wide rather than in the page: Back from Export or the
 * editor remounts the page on the same entry (same key, `fromRecording` still in its state).
 * `askedKeys` keeps that remount from floating a second card (and covers StrictMode's second
 * effect run); `fellBackKeys` keeps the in-app card it fell back to on screen.
 */
const askedKeys = new Set<string>();
const fellBackKeys = new Set<string>();

/** Forget every entry, so each test starts clean. */
export function __resetFloatingReadyCardForTests(): void {
  askedKeys.clear();
  fellBackKeys.clear();
}

/**
 * Ask main to float "Your video is ready" on the desktop, once per arrival. `inApp` turns true
 * only when that window could not open (main answered false, or the IPC failed): the page
 * then shows the same card in its status stack instead, so the card is never shown twice
 * and never lost.
 */
export function useFloatingReadyCard(request: FloatingReadyRequest | null): { inApp: boolean } {
  // Only re-renders this page when its own entry falls back; the truth is `fellBackKeys`.
  const [, setFellBack] = useState<string | null>(null);

  useEffect(() => {
    if (!request || askedKeys.has(request.key)) return;
    const { key, payload } = request;
    askedKeys.add(key);
    const fallBack = (): void => {
      fellBackKeys.add(key);
      setFellBack(key);
    };
    window.electronAPI.showRecordingReady(payload).then((shown) => {
      if (!shown) fallBack();
    }, fallBack);
  }, [request]);

  return { inApp: request !== null && fellBackKeys.has(request.key) };
}
