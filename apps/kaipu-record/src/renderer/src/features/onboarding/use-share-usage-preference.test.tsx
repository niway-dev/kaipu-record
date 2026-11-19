import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@shared/types";
import { installSettingsIpc } from "@renderer/test/settings-ipc";
import { STUB_SETTINGS } from "@renderer/test/stub-settings";
import { useShareUsagePreference } from "./use-share-usage-preference";

const withDiagnostics = (diagnosticsEnabled: boolean): AppSettings =>
  ({ ...STUB_SETTINGS, diagnosticsEnabled }) as unknown as AppSettings;

describe("useShareUsagePreference", () => {
  afterEach(cleanup);

  it("is null until the first read, then what main holds", async () => {
    const ipc = installSettingsIpc(withDiagnostics(false), { deferRead: true });
    const { result } = renderHook(() => useShareUsagePreference());
    expect(result.current.enabled).toBeNull();

    await act(async () => ipc.resolveRead(withDiagnostics(false)));
    expect(result.current.enabled).toBe(false);
  });

  it("shows the new value at once and keeps main's answer", async () => {
    installSettingsIpc(withDiagnostics(true));
    window.electronAPI.updateSettings = vi.fn(async () => withDiagnostics(false));
    const { result } = renderHook(() => useShareUsagePreference());
    await waitFor(() => expect(result.current.enabled).toBe(true));

    act(() => result.current.setEnabled(false));
    expect(result.current.enabled).toBe(false);
    await waitFor(() => expect(window.electronAPI.updateSettings).toHaveBeenCalled());
    await act(async () => {});

    expect(result.current.enabled).toBe(false);
  });

  it("shows what main holds when main rejected the write after storing it", async () => {
    const ipc = installSettingsIpc(withDiagnostics(true));
    window.electronAPI.updateSettings = vi.fn(async () => {
      throw new Error("update failed");
    });
    const { result } = renderHook(() => useShareUsagePreference());
    await waitFor(() => expect(result.current.enabled).toBe(true));
    // Main merged the patch, then threw before it broadcast: it now holds Off.
    ipc.getSettings.mockImplementationOnce(async () => withDiagnostics(false));

    act(() => result.current.setEnabled(false));
    await waitFor(() => expect(ipc.getSettings).toHaveBeenCalledTimes(2));
    await act(async () => {});

    // Not back to On: the switch must not read differently from what main holds.
    expect(result.current.enabled).toBe(false);
  });

  it("goes back to the stored value when main rejected the write without storing it", async () => {
    const ipc = installSettingsIpc(withDiagnostics(true));
    window.electronAPI.updateSettings = vi.fn(async () => {
      throw new Error("update failed");
    });
    const { result } = renderHook(() => useShareUsagePreference());
    await waitFor(() => expect(result.current.enabled).toBe(true));

    act(() => result.current.setEnabled(false));
    await waitFor(() => expect(ipc.getSettings).toHaveBeenCalledTimes(2));
    await act(async () => {});

    expect(result.current.enabled).toBe(true);
  });
});
