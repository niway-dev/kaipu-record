import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AppSettings } from "@shared/types";
import { installSettingsIpc } from "@renderer/test/settings-ipc";
import { STUB_SETTINGS } from "@renderer/test/stub-settings";
import { useWatermark } from "./use-watermark";

const settings = (showBrandBadge: boolean): AppSettings =>
  ({ ...STUB_SETTINGS, showBrandBadge }) as unknown as AppSettings;

describe("useWatermark", () => {
  it("stays off until the first read, then follows the badge toggle", async () => {
    const ipc = installSettingsIpc(settings(false), { deferRead: true });
    const { result } = renderHook(() => useWatermark());
    expect(result.current.enabled).toBe(false);

    await act(async () => ipc.resolveRead(settings(true)));
    expect(result.current.enabled).toBe(true);

    act(() => ipc.broadcast(settings(false)));
    expect(result.current.enabled).toBe(false);
  });
});
