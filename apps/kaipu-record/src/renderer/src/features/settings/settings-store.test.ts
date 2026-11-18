import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { AppSettings } from "@shared/types";
import { STUB_SETTINGS } from "../../test/stub-settings";
import { installSettingsIpc } from "../../test/settings-ipc";
import {
  getSettingsSnapshot,
  loadSettings,
  resetSettingsStoreForTests,
  settingsSubscriberCount,
  subscribeSettings,
  updateSettings,
  useSettings,
  watchSettings,
} from "./settings-store";

const BASE = STUB_SETTINGS as unknown as AppSettings;
const withLocale = (locale: "es" | "en"): AppSettings => ({ ...BASE, locale });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("settings store", () => {
  it("opens one settings:changed listener and one read, however many consumers come and go", async () => {
    const ipc = installSettingsIpc(withLocale("es"));
    const offs = Array.from({ length: 20 }, () => subscribeSettings(() => {}));
    await loadSettings();
    await loadSettings();

    expect(ipc.onSettingsChanged).toHaveBeenCalledTimes(1);
    expect(ipc.getSettings).toHaveBeenCalledTimes(1);
    expect(settingsSubscriberCount()).toBe(20);

    for (const off of offs) off();
    subscribeSettings(() => {})();
    expect(settingsSubscriberCount()).toBe(0);
    // Nobody is listening, and the window still holds its one listener: no churn.
    expect(ipc.activeSubscriptions()).toBe(1);
    expect(ipc.onSettingsChanged).toHaveBeenCalledTimes(1);
    expect(ipc.getSettings).toHaveBeenCalledTimes(1);
  });

  it("does not touch main until something uses it", () => {
    const ipc = installSettingsIpc();
    expect(getSettingsSnapshot()).toBeNull();
    expect(ipc.onSettingsChanged).not.toHaveBeenCalled();
    expect(ipc.getSettings).not.toHaveBeenCalled();
  });

  it("tells every consumer about the read and about each broadcast", async () => {
    const ipc = installSettingsIpc(withLocale("es"));
    const first = vi.fn();
    const second = vi.fn();
    subscribeSettings(first);
    subscribeSettings(second);
    await loadSettings();
    expect(first).toHaveBeenLastCalledWith(withLocale("es"));

    ipc.broadcast(withLocale("en"));

    expect(first).toHaveBeenLastCalledWith(withLocale("en"));
    expect(second).toHaveBeenLastCalledWith(withLocale("en"));
    expect(getSettingsSnapshot()?.locale).toBe("en");
  });

  it("a broadcast that lands before the first read finishes wins over the read", async () => {
    const ipc = installSettingsIpc(withLocale("es"), { deferRead: true });
    const heard = vi.fn();
    subscribeSettings(heard);

    ipc.broadcast(withLocale("en"));
    ipc.resolveRead(withLocale("es"));
    const loaded = await loadSettings();

    expect(loaded.locale).toBe("en");
    expect(getSettingsSnapshot()?.locale).toBe("en");
    // The older read was dropped, not replayed to consumers.
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("loadSettings resolves with what the read found when nothing newer arrived", async () => {
    const ipc = installSettingsIpc(withLocale("es"), { deferRead: true });
    const loaded = loadSettings();
    ipc.resolveRead(withLocale("es"));
    await expect(loaded).resolves.toMatchObject({ locale: "es" });
  });

  it("a failed read rejects loadSettings, and a later call asks again", async () => {
    const ipc = installSettingsIpc(withLocale("es"), { deferRead: true });
    const failed = loadSettings();
    ipc.rejectRead();
    await expect(failed).rejects.toThrow("read failed");

    const again = loadSettings();
    ipc.resolveRead(withLocale("en"));
    await expect(again).resolves.toMatchObject({ locale: "en" });
    expect(ipc.getSettings).toHaveBeenCalledTimes(2);
    expect(ipc.onSettingsChanged).toHaveBeenCalledTimes(1);
  });

  it("updateSettings returns main's answer and hands it to every consumer at once", async () => {
    installSettingsIpc(withLocale("es"));
    window.electronAPI.updateSettings = vi.fn(async () => withLocale("en"));
    const heard = vi.fn();
    subscribeSettings(heard);
    await loadSettings();

    const saved = await updateSettings({ locale: "en" });

    expect(window.electronAPI.updateSettings).toHaveBeenCalledWith({ locale: "en" });
    expect(saved.locale).toBe("en");
    expect(getSettingsSnapshot()?.locale).toBe("en");
    expect(heard).toHaveBeenLastCalledWith(withLocale("en"));
  });

  it("an answer to updateSettings that a newer broadcast overtook does not roll the window back", async () => {
    const ipc = installSettingsIpc(withLocale("es"));
    let answer: (settings: AppSettings) => void = () => {};
    window.electronAPI.updateSettings = vi.fn(
      () => new Promise<AppSettings>((resolve) => (answer = resolve)),
    );
    await loadSettings();

    const pending = updateSettings({ locale: "en" });
    // Main sent the newer value to every window while this window's answer was still on its way.
    ipc.broadcast({ ...withLocale("es"), showInDock: false });
    answer(withLocale("en"));
    await pending;

    expect(getSettingsSnapshot()?.showInDock).toBe(false);
  });

  it("watchSettings applies the held value at once, or the first read when there is none yet", async () => {
    const ipc = installSettingsIpc(withLocale("es"), { deferRead: true });
    const early = vi.fn();
    watchSettings(early);
    expect(early).not.toHaveBeenCalled();
    ipc.resolveRead(withLocale("es"));
    await loadSettings();
    expect(early).toHaveBeenCalledTimes(1);

    const late = vi.fn();
    watchSettings(late);
    expect(late).toHaveBeenCalledExactlyOnceWith(withLocale("es"));
  });

  it("a consumer that unsubscribes inside its own notification does not skip the others", async () => {
    const ipc = installSettingsIpc(withLocale("es"));
    await loadSettings();
    const second = vi.fn();
    const off = subscribeSettings(() => off());
    subscribeSettings(second);

    ipc.broadcast(withLocale("en"));

    expect(second).toHaveBeenCalledTimes(1);
  });

  it("reset forgets the value, the listeners and the window's listener", async () => {
    const ipc = installSettingsIpc(withLocale("es"));
    subscribeSettings(() => {});
    await loadSettings();

    resetSettingsStoreForTests();

    expect(getSettingsSnapshot()).toBeNull();
    expect(settingsSubscriberCount()).toBe(0);
    expect(ipc.activeSubscriptions()).toBe(0);
  });
});

describe("useSettings", () => {
  it("is null until the first read, then the selected value", async () => {
    const ipc = installSettingsIpc(withLocale("es"), { deferRead: true });
    const { result } = renderHook(() => useSettings((s) => s.locale));
    expect(result.current).toBeNull();

    await act(async () => {
      ipc.resolveRead(withLocale("es"));
    });
    expect(result.current).toBe("es");

    act(() => ipc.broadcast(withLocale("en")));
    expect(result.current).toBe("en");
  });

  it("returns the value at once when the store already has one", async () => {
    installSettingsIpc(withLocale("en"));
    await loadSettings();
    const { result } = renderHook(() => useSettings((s) => s.locale));
    expect(result.current).toBe("en");
  });

  it("many hooks share the window's single listener", async () => {
    const ipc = installSettingsIpc(withLocale("es"));
    const hooks = Array.from({ length: 12 }, () => renderHook(() => useSettings((s) => s.locale)));
    await act(async () => {
      await loadSettings();
    });
    expect(ipc.onSettingsChanged).toHaveBeenCalledTimes(1);
    expect(ipc.getSettings).toHaveBeenCalledTimes(1);
    for (const hook of hooks) hook.unmount();
    expect(ipc.activeSubscriptions()).toBe(1);
  });

  it("does not re-render for a broadcast that leaves the selected value as it was", async () => {
    const ipc = installSettingsIpc(withLocale("es"));
    await loadSettings();
    let renders = 0;
    renderHook(() => {
      renders += 1;
      return useSettings(
        (s) => s.audio,
        (a, b) => JSON.stringify(a) === JSON.stringify(b),
      );
    });
    const before = renders;

    act(() => ipc.broadcast({ ...withLocale("en"), audio: { ...BASE.audio } }));

    expect(renders).toBe(before);
  });
});
