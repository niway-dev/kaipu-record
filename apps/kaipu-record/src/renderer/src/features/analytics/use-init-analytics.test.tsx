import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@shared/types";
import { installSettingsIpc } from "@renderer/test/settings-ipc";
import { STUB_SETTINGS } from "@renderer/test/stub-settings";
import { useInitAnalytics } from "./use-init-analytics";

const setAnalyticsEnabled = vi.hoisted(() => vi.fn());
vi.mock("./analytics-client", () => ({ setAnalyticsEnabled }));

const settings = (diagnosticsEnabled: boolean): AppSettings =>
  ({ ...STUB_SETTINGS, diagnosticsEnabled, deviceId: "device-1" }) as unknown as AppSettings;

describe("useInitAnalytics", () => {
  it("applies the first read, then follows the toggle through the window's store", async () => {
    setAnalyticsEnabled.mockClear();
    const ipc = installSettingsIpc(settings(true));
    renderHook(() => useInitAnalytics());

    await vi.waitFor(() => expect(setAnalyticsEnabled).toHaveBeenCalledWith(true, "device-1"));

    act(() => ipc.broadcast(settings(false)));
    expect(setAnalyticsEnabled).toHaveBeenLastCalledWith(false, "device-1");
    expect(ipc.onSettingsChanged).toHaveBeenCalledTimes(1);
    expect(ipc.getSettings).toHaveBeenCalledTimes(1);
  });
});
