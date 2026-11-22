import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@shared/types";
import type { ImageInspectSettings, PickedColor } from "@shared/image-inspect-settings";
import { reportError } from "@renderer/features/analytics";
import { STUB_SETTINGS } from "../../../test/stub-settings";
import { installSettingsIpc, type SettingsIpc } from "../../../test/settings-ipc";
import { usePickedColors } from "./use-picked-colors";

vi.mock("@renderer/features/analytics", () => ({ reportError: vi.fn() }));

const BASE = STUB_SETTINGS as unknown as AppSettings;
const withInspect = (imageInspect: ImageInspectSettings): AppSettings => ({
  ...BASE,
  imageInspect,
});
const px = (r: number, g: number, b: number): PickedColor => ({ color: { r, g, b, a: 255 } });
const RED = px(255, 0, 82);
const GREEN = px(0, 200, 0);
const BLUE = px(0, 0, 255);
const GRAY = px(128, 128, 128);

/** Main's side of `updateSettings`: keeps the value and broadcasts it like the real service. */
function installUpdate(ipc: SettingsIpc, initial: AppSettings): ReturnType<typeof vi.fn> {
  let latest = initial;
  const update = vi.fn(async (patch: Partial<AppSettings>): Promise<AppSettings> => {
    latest = { ...latest, ...patch };
    ipc.broadcast(latest);
    return latest;
  });
  window.electronAPI.updateSettings = update as unknown as typeof window.electronAPI.updateSettings;
  return update;
}

describe("usePickedColors (imageInspect, follows main's broadcast)", () => {
  beforeEach(() => {
    vi.mocked(reportError).mockClear();
  });

  it("starts empty, with the loupe on, before any value was saved", async () => {
    const ipc = installSettingsIpc(BASE);
    installUpdate(ipc, BASE);
    const { result } = renderHook(() => usePickedColors(true));
    await waitFor(() => expect(ipc.getSettings).toHaveBeenCalled());
    expect(result.current.picked).toBeNull();
    expect(result.current.recents).toEqual([]);
    expect(result.current.loupe).toBe(true);
  });

  it("loads the persisted picked color, recents and loupe (AC5)", async () => {
    const stored = withInspect({ picked: RED, recents: [GREEN, BLUE], loupe: false });
    installSettingsIpc(stored);
    const { result } = renderHook(() => usePickedColors(true));
    await waitFor(() => expect(result.current.picked).toEqual(RED));
    expect(result.current.recents).toEqual([GREEN, BLUE]);
    expect(result.current.loupe).toBe(false);
  });

  it("saves a pick as { imageInspect } and shows it at once", async () => {
    const ipc = installSettingsIpc(BASE);
    const update = installUpdate(ipc, BASE);
    const { result } = renderHook(() => usePickedColors(true));
    await waitFor(() => expect(ipc.getSettings).toHaveBeenCalled());
    act(() => result.current.pick(RED));
    expect(result.current.picked).toEqual(RED);
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith({
      imageInspect: { picked: RED, recents: [], loupe: true },
    });
  });

  it("pushes the replaced pick to the front of the recents and keeps three (AC2)", async () => {
    const ipc = installSettingsIpc(BASE);
    const update = installUpdate(ipc, BASE);
    const { result } = renderHook(() => usePickedColors(true));
    await waitFor(() => expect(ipc.getSettings).toHaveBeenCalled());
    // Two picks in the same tick: the second builds on the first, which is not saved yet.
    act(() => {
      result.current.pick(RED);
      result.current.pick(GREEN);
      result.current.pick(BLUE);
      result.current.pick(GRAY);
      result.current.pick(px(1, 2, 3));
    });
    expect(result.current.picked).toEqual(px(1, 2, 3));
    expect(result.current.recents).toEqual([GRAY, BLUE, GREEN]);
    await waitFor(() => expect(update).toHaveBeenCalledTimes(5));
    // Saved one after another, in order.
    expect(update.mock.calls.map(([patch]) => patch.imageInspect.picked)).toEqual([
      RED,
      GREEN,
      BLUE,
      GRAY,
      px(1, 2, 3),
    ]);
    await waitFor(() => expect(result.current.recents).toEqual([GRAY, BLUE, GREEN]));
  });

  it("does nothing when the picked color is picked again", async () => {
    const stored = withInspect({ picked: RED, recents: [], loupe: true });
    const ipc = installSettingsIpc(stored);
    const update = installUpdate(ipc, stored);
    const { result } = renderHook(() => usePickedColors(true));
    await waitFor(() => expect(result.current.picked).toEqual(RED));
    act(() => result.current.pick(px(255, 0, 82)));
    expect(update).not.toHaveBeenCalled();
    expect(result.current.recents).toEqual([]);
  });

  it("saves the loupe switch and keeps the picks", async () => {
    const stored = withInspect({ picked: RED, recents: [GREEN], loupe: true });
    const ipc = installSettingsIpc(stored);
    const update = installUpdate(ipc, stored);
    const { result } = renderHook(() => usePickedColors(true));
    await waitFor(() => expect(result.current.picked).toEqual(RED));
    act(() => result.current.setLoupe(false));
    expect(result.current.loupe).toBe(false);
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith({
      imageInspect: { picked: RED, recents: [GREEN], loupe: false },
    });
    act(() => result.current.setLoupe(false));
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("follows a broadcast from another window", async () => {
    const ipc = installSettingsIpc(BASE);
    const { result } = renderHook(() => usePickedColors(true));
    await waitFor(() => expect(ipc.getSettings).toHaveBeenCalled());
    await waitFor(() => expect(ipc.activeSubscriptions()).toBeGreaterThan(0));
    act(() => ipc.broadcast(withInspect({ picked: BLUE, recents: [RED], loupe: false })));
    expect(result.current.picked).toEqual(BLUE);
    expect(result.current.recents).toEqual([RED]);
    expect(result.current.loupe).toBe(false);
  });

  it("drops the value and reports the error when the save fails", async () => {
    const ipc = installSettingsIpc(BASE);
    window.electronAPI.updateSettings = vi.fn(async () => {
      throw new Error("disk full");
    }) as unknown as typeof window.electronAPI.updateSettings;
    const { result } = renderHook(() => usePickedColors(true));
    await waitFor(() => expect(ipc.getSettings).toHaveBeenCalled());
    act(() => result.current.pick(RED));
    await waitFor(() => expect(reportError).toHaveBeenCalledTimes(1));
    expect(vi.mocked(reportError).mock.calls[0]![2]).toMatchObject({
      context: { phase: "inspect-picks-save" },
    });
    await waitFor(() => expect(result.current.picked).toBeNull());
  });

  it("never asks main for the settings while it is not enabled", () => {
    const ipc = installSettingsIpc(BASE);
    const { result } = renderHook(() => usePickedColors(false));
    expect(ipc.getSettings).not.toHaveBeenCalled();
    expect(ipc.onSettingsChanged).not.toHaveBeenCalled();
    expect(result.current.picked).toBeNull();
    expect(result.current.loupe).toBe(true);
  });
});
