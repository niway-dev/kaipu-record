import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@shared/types";
import { getSettingsSnapshot } from "@renderer/features/settings/settings-store";
import { installSettingsIpc } from "@renderer/test/settings-ipc";
import { STUB_SETTINGS } from "@renderer/test/stub-settings";
import { useWidgetExpanded } from "./use-widget-expanded";

const BASE = STUB_SETTINGS as unknown as AppSettings;
const withWidget = (captureWidget: AppSettings["captureWidget"]): AppSettings => ({
  ...BASE,
  captureWidget,
});

const api = () => ({ updateSettings: vi.fn(async () => BASE) });

/** The hook shows compact until the first read answers: tests wait for the loaded store. */
const loaded = () => waitFor(() => expect(getSettingsSnapshot()).not.toBeNull());

describe("useWidgetExpanded", () => {
  it("opens compact for both capture types when nothing is saved", async () => {
    installSettingsIpc(BASE);
    const shot = renderHook(() => useWidgetExpanded(api(), "capture"));
    const take = renderHook(() => useWidgetExpanded(api(), "record"));
    await loaded();
    expect(shot.result.current.expanded).toBe(false);
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
    await loaded();
    expect(result.current.expanded).toBe(false);

    act(() => ipc.broadcast(withWidget({ screenshotExpanded: true, recordingExpanded: false })));

    expect(result.current.expanded).toBe(true);
  });

  it("a toggle shows at once and saves the whole object, keeping the other type's value", async () => {
    installSettingsIpc(withWidget({ screenshotExpanded: false, recordingExpanded: true }));
    const bridge = api();
    const { result } = renderHook(() => useWidgetExpanded(bridge, "capture"));
    await loaded();
    expect(result.current.expanded).toBe(false);

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
    await loaded();
    expect(result.current.expanded).toBe(false);

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
    await loaded();
    expect(result.current.expanded).toBe(false);

    act(() => {
      result.current.toggle();
      result.current.toggle();
    });

    expect(result.current.expanded).toBe(false);
    await waitFor(() => expect(bridge.updateSettings).toHaveBeenCalledTimes(2));
    expect(bridge.updateSettings.mock.calls).toEqual([
      [{ captureWidget: { screenshotExpanded: true, recordingExpanded: false } }],
      [{ captureWidget: { screenshotExpanded: false, recordingExpanded: false } }],
    ]);
  });

  it("going back to the stored value keeps the claim until the first save's echo has passed", async () => {
    const ipc = installSettingsIpc(BASE);
    const bridge = api();
    const { result } = renderHook(() => useWidgetExpanded(bridge, "capture"));
    await loaded();

    // Open, then closed again: the second tap asks for the value the store still holds.
    act(() => {
      result.current.toggle();
      result.current.toggle();
    });
    expect(result.current.expanded).toBe(false);
    // Main can only echo a save it was sent.
    await waitFor(() => expect(bridge.updateSettings).toHaveBeenCalledTimes(2));

    // Main echoes the first save: the toolbar must not open for the moment before the second
    // save's echo arrives.
    act(() => ipc.broadcast(withWidget({ screenshotExpanded: true, recordingExpanded: false })));
    expect(result.current.expanded).toBe(false);

    act(() => ipc.broadcast(withWidget({ screenshotExpanded: false, recordingExpanded: false })));
    expect(result.current.expanded).toBe(false);
    // Both echoes are in: the store decides again.
    act(() => ipc.broadcast(withWidget({ screenshotExpanded: true, recordingExpanded: false })));
    expect(result.current.expanded).toBe(true);
  });

  it("open, closed, open: the first echo does not end the claim of the third tap", async () => {
    const ipc = installSettingsIpc(BASE);
    const bridge = api();
    const { result } = renderHook(() => useWidgetExpanded(bridge, "capture"));
    await loaded();

    act(() => {
      result.current.toggle();
      result.current.toggle();
      result.current.toggle();
    });
    expect(result.current.expanded).toBe(true);
    await waitFor(() => expect(bridge.updateSettings).toHaveBeenCalledTimes(3));

    // Main echoes the three saves in order. The toolbar shows the newest tap all along.
    for (const value of [true, false, true]) {
      act(() => ipc.broadcast(withWidget({ screenshotExpanded: value, recordingExpanded: false })));
      expect(result.current.expanded).toBe(true);
    }
    // All three are echoed: the store decides again.
    act(() => ipc.broadcast(withWidget({ screenshotExpanded: false, recordingExpanded: false })));
    expect(result.current.expanded).toBe(false);
  });

  it("another window's broadcasts of the same values do not end the claims before this window's saves are echoed", async () => {
    const ipc = installSettingsIpc(BASE);
    let finishFirst: (settings: AppSettings) => void = () => {};
    const updateSettings = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => (finishFirst = resolve)))
      .mockImplementation(async () => BASE);
    const { result } = renderHook(() => useWidgetExpanded({ updateSettings }, "capture"));
    await loaded();

    // Open, then closed again here. Before either save is sent, another display's overlay makes
    // the same two changes: its broadcasts must not count as the echoes of this window's saves.
    act(() => {
      result.current.toggle();
      result.current.toggle();
      ipc.broadcast(withWidget({ screenshotExpanded: true, recordingExpanded: false }));
      ipc.broadcast(withWidget({ screenshotExpanded: false, recordingExpanded: false }));
    });
    expect(result.current.expanded).toBe(false);

    // The first local save is sent and echoed: it still must not open the toolbar.
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    act(() => ipc.broadcast(withWidget({ screenshotExpanded: true, recordingExpanded: false })));
    expect(result.current.expanded).toBe(false);
    await act(async () => finishFirst(BASE));

    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(2));
    act(() => ipc.broadcast(withWidget({ screenshotExpanded: false, recordingExpanded: false })));
    expect(result.current.expanded).toBe(false);
    // Both echoes are in: the store decides again.
    act(() => ipc.broadcast(withWidget({ screenshotExpanded: true, recordingExpanded: false })));
    expect(result.current.expanded).toBe(true);
  });

  it("a failed save shows the stored value again instead of sticking", async () => {
    installSettingsIpc(BASE);
    const bridge = { updateSettings: vi.fn(async () => Promise.reject(new Error("write failed"))) };
    const { result } = renderHook(() => useWidgetExpanded(bridge, "capture"));
    await loaded();

    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(true);

    await waitFor(() => expect(result.current.expanded).toBe(false));
    expect(bridge.updateSettings).toHaveBeenCalledTimes(1);
    // The next tap starts from what is shown, so it asks for the value again.
    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(true);
  });

  it("a failed save does not undo a newer toggle of the same type, even one with the same value", async () => {
    installSettingsIpc(BASE);
    let failFirst: (error: Error) => void = () => {};
    const updateSettings = vi
      .fn()
      .mockImplementationOnce(() => new Promise((_, reject) => (failFirst = reject)))
      .mockImplementation(async () => BASE);
    const { result } = renderHook(() => useWidgetExpanded({ updateSettings }, "capture"));
    await loaded();

    // Expanded, compact, expanded again: the third tap's claim asks for the same value as the
    // first one's, whose save is the one that fails.
    act(() => result.current.toggle());
    act(() => result.current.toggle());
    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(true);
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    await act(async () => failFirst(new Error("write failed")));

    // The other two saves still run, and the newest tap is what shows.
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(3));
    expect(result.current.expanded).toBe(true);
  });

  it("a toggle of the other type, made before the store echoes, keeps the first one's value", async () => {
    installSettingsIpc(BASE);
    const bridge = api();
    const { result, rerender } = renderHook(
      ({ intent }: { intent: "capture" | "record" }) => useWidgetExpanded(bridge, intent),
      { initialProps: { intent: "capture" } },
    );
    await loaded();

    act(() => result.current.toggle());
    rerender({ intent: "record" });
    act(() => result.current.toggle());

    await waitFor(() => expect(bridge.updateSettings).toHaveBeenCalledTimes(2));
    // The store never echoed the first save, and still holds both as false.
    expect(bridge.updateSettings).toHaveBeenLastCalledWith({
      captureWidget: { screenshotExpanded: true, recordingExpanded: true },
    });
  });

  it("a save of the other type does not write back a claim whose own save failed", async () => {
    installSettingsIpc(BASE);
    let failFirst: (error: Error) => void = () => {};
    const updateSettings = vi
      .fn()
      .mockImplementationOnce(() => new Promise((_, reject) => (failFirst = reject)))
      .mockImplementation(async () => BASE);
    const { result, rerender } = renderHook(
      ({ intent }: { intent: "capture" | "record" }) =>
        useWidgetExpanded({ updateSettings }, intent),
      { initialProps: { intent: "capture" } },
    );
    await loaded();

    // The screenshot toggle is still saving when the recording toggle is made.
    act(() => result.current.toggle());
    rerender({ intent: "record" });
    act(() => result.current.toggle());
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    await act(async () => failFirst(new Error("write failed")));

    // The recording save runs after the failure: the screenshot value stays what the store holds.
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(2));
    expect(updateSettings).toHaveBeenLastCalledWith({
      captureWidget: { screenshotExpanded: false, recordingExpanded: true },
    });
  });

  it("an older broadcast still in flight does not flip a fresh toggle back", async () => {
    const ipc = installSettingsIpc(BASE);
    const bridge = api();
    const { result } = renderHook(() => useWidgetExpanded(bridge, "capture"));
    await loaded();
    expect(result.current.expanded).toBe(false);

    act(() => result.current.toggle());
    await waitFor(() => expect(bridge.updateSettings).toHaveBeenCalledTimes(1));
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
