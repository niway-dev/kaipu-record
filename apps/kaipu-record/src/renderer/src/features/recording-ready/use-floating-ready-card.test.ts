import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { RecordingReadyPayload } from "@shared/types/recording-ready";
import {
  __resetFloatingReadyCardForTests,
  type FloatingReadyRequest,
  useFloatingReadyCard,
} from "./use-floating-ready-card";

const PAYLOAD: RecordingReadyPayload = {
  assetId: "asset-1",
  durationSeconds: 78,
  dimensions: null,
  sizeBytes: 4_000_000,
  canEdit: true,
};

const request = (key: string): FloatingReadyRequest => ({ key, payload: PAYLOAD });

describe("useFloatingReadyCard", () => {
  afterEach(() => __resetFloatingReadyCardForTests());

  it("asks once per history entry, even when the page remounts on it (Back)", () => {
    const show = vi
      .spyOn(window.electronAPI, "showRecordingReady")
      .mockImplementation(async () => true);

    const first = renderHook(() => useFloatingReadyCard(request("k1")));
    first.unmount();
    renderHook(() => useFloatingReadyCard(request("k1")));
    expect(show).toHaveBeenCalledOnce();

    // A new arrival is a new entry.
    renderHook(() => useFloatingReadyCard(request("k2")));
    expect(show).toHaveBeenCalledTimes(2);
    show.mockRestore();
  });

  it("keeps the in-app fallback on screen when the page remounts on the same entry", async () => {
    const show = vi
      .spyOn(window.electronAPI, "showRecordingReady")
      .mockImplementation(async () => false);

    const first = renderHook(() => useFloatingReadyCard(request("k1")));
    await waitFor(() => expect(first.result.current.inApp).toBe(true));
    first.unmount();

    const back = renderHook(() => useFloatingReadyCard(request("k1")));
    expect(back.result.current.inApp).toBe(true);
    expect(show).toHaveBeenCalledOnce();
    show.mockRestore();
  });
});
