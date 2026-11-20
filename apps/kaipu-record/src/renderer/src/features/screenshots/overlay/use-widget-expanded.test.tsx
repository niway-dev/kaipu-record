import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@shared/types";
import { installSettingsIpc } from "@renderer/test/settings-ipc";
import { STUB_SETTINGS } from "@renderer/test/stub-settings";
import { useWidgetExpanded } from "./use-widget-expanded";

const BASE = STUB_SETTINGS as unknown as AppSettings;
const withWidget = (captureWidget: AppSettings["captureWidget"]): AppSettings => ({
  ...BASE,
  captureWidget,
});

const api = () => ({ updateSettings: vi.fn(async () => BASE) });

describe("useWidgetExpanded", () => {
  it("opens compact for both capture types when nothing is saved", async () => {
    installSettingsIpc(BASE);
    const shot = renderHook(() => useWidgetExpanded(api(), "capture"));
    const take = renderHook(() => useWidgetExpanded(api(), "record"));
    await waitFor(() => expect(shot.result.current.expanded).toBe(false));
    expect(take.result.current.expanded).toBe(false);
  });

  it("reads the mode of its own capture type", async () => {
    installSettingsIpc(withWidget({ screenshotExpanded: true, recordingExpanded: false }));
    const shot = renderHook(() => useWidgetExpanded(api(), "capture"));
    const take = renderHook(() => useWidgetExpanded(api(), "record"));
    await waitFor(() => expect(shot.result.current.expanded).toBe(true));
    expect(take.result.current.expanded).toBe(false);
  });

  it("follows a captureWidget change broadcast by main, as another display's overlay would send", async () => {
    const ipc = installSettingsIpc(
      withWidget({ screenshotExpanded: false, recordingExpanded: false }),
    );
    const { result } = renderHook(() => useWidgetExpanded(api(), "capture"));
    await waitFor(() => expect(result.current.expanded).toBe(false));

    act(() => ipc.broadcast(withWidget({ screenshotExpanded: true, recordingExpanded: false })));

    expect(result.current.expanded).toBe(true);
  });

  it("a toggle shows at once and saves the whole object, keeping the other type's value", async () => {
    installSettingsIpc(withWidget({ screenshotExpanded: false, recordingExpanded: true }));
    const bridge = api();
    const { result } = renderHook(() => useWidgetExpanded(bridge, "capture"));
    await waitFor(() => expect(result.current.expanded).toBe(false));

    act(() => result.current.toggle());

    expect(result.current.expanded).toBe(true);
    await waitFor(() =>
      expect(bridge.updateSettings).toHaveBeenCalledExactlyOnceWith({
        captureWidget: { screenshotExpanded: true, recordingExpanded: true },
      }),
    );
  });

  it("a recording toggle saves recordingExpanded", async () => {
    installSettingsIpc(BASE);
    const bridge = api();
    const { result } = renderHook(() => useWidgetExpanded(bridge, "record"));
    await waitFor(() => expect(result.current.expanded).toBe(false));

    act(() => result.current.toggle());

    await waitFor(() =>
      expect(bridge.updateSettings).toHaveBeenCalledWith({
        captureWidget: { screenshotExpanded: false, recordingExpanded: true },
      }),
    );
  });

  it("two taps before a render flip twice", async () => {
    installSettingsIpc(BASE);
    const bridge = api();
    const { result } = renderHook(() => useWidgetExpanded(bridge, "capture"));
    await waitFor(() => expect(result.current.expanded).toBe(false));

    act(() => {
      result.current.toggle();
      result.current.toggle();
    });

    expect(result.current.expanded).toBe(false);
    await waitFor(() => expect(bridge.updateSettings).toHaveBeenCalledTimes(2));
  });

  it("an older broadcast still in flight does not flip a fresh toggle back", async () => {
    const ipc = installSettingsIpc(BASE);
    const { result } = renderHook(() => useWidgetExpanded(api(), "capture"));
    await waitFor(() => expect(result.current.expanded).toBe(false));

    act(() => result.current.toggle());
    // A broadcast of the value from before the toggle arrives late.
    act(() => ipc.broadcast(withWidget({ screenshotExpanded: false, recordingExpanded: false })));
    expect(result.current.expanded).toBe(true);

    // Main's echo of the toggle ends the claim, and the store holds the value.
    act(() => ipc.broadcast(withWidget({ screenshotExpanded: true, recordingExpanded: false })));
    expect(result.current.expanded).toBe(true);
    // From then on the store decides: another display collapsing it shows here.
    act(() => ipc.broadcast(withWidget({ screenshotExpanded: false, recordingExpanded: false })));
    expect(result.current.expanded).toBe(false);
  });
});
