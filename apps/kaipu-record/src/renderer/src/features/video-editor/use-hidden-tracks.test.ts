import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@shared/types";
import { useHiddenTracks } from "./use-hidden-tracks";

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@renderer/features/analytics", () => ({ captureException }));

const store = (hiddenTracks: unknown, update = vi.fn().mockResolvedValue(undefined)) => ({
  settings: { editor: { hiddenTracks } } as unknown as AppSettings,
  update,
});

describe("useHiddenTracks", () => {
  it("reads the stored list through the parser (clips and unknown keys dropped)", () => {
    const { result } = renderHook(() => useHiddenTracks(store(["zooms", "clips", "nope"])));
    expect(result.current.hidden).toEqual(["zooms"]);
  });

  it("shows every lane while settings have not loaded", () => {
    const { result } = renderHook(() => useHiddenTracks({ settings: null, update: vi.fn() }));
    expect(result.current.hidden).toEqual([]);
  });

  it("toggle hides a shown lane and shows a hidden one, writing editor.hiddenTracks", () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useHiddenTracks(store(["audio"], update)));
    act(() => result.current.toggle("zooms"));
    expect(update).toHaveBeenLastCalledWith({ editor: { hiddenTracks: ["audio", "zooms"] } });
    act(() => result.current.toggle("audio"));
    // The second toggle starts from what the first one wrote, not from the stale store.
    expect(update).toHaveBeenLastCalledWith({ editor: { hiddenTracks: ["zooms"] } });
  });

  it("never writes clips", () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useHiddenTracks(store([], update)));
    act(() => result.current.toggle("clips"));
    expect(update).not.toHaveBeenCalled();
  });

  it("showTrack turns a hidden lane on, and writes nothing for a lane already shown", () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useHiddenTracks(store(["zooms"], update)));
    act(() => result.current.showTrack("audio"));
    expect(update).not.toHaveBeenCalled();
    act(() => result.current.showTrack("zooms"));
    expect(update).toHaveBeenCalledWith({ editor: { hiddenTracks: [] } });
  });

  it("showTrack on Zooms leaves a stored Cursor activity choice alone", () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useHiddenTracks(store(["zooms", "activity"], update)));
    act(() => result.current.showTrack("zooms"));
    expect(update).toHaveBeenCalledWith({ editor: { hiddenTracks: ["activity"] } });
  });

  it("keeps the other fields of editor when it writes: the settings merge is shallow", () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const settings = {
      editor: { hiddenTracks: ["audio"], futureField: 7 },
    } as unknown as AppSettings;
    const { result } = renderHook(() => useHiddenTracks({ settings, update }));
    act(() => result.current.toggle("zooms"));
    expect(update).toHaveBeenLastCalledWith({
      editor: { hiddenTracks: ["audio", "zooms"], futureField: 7 },
    });
    act(() => result.current.showTrack("audio"));
    expect(update).toHaveBeenLastCalledWith({
      editor: { hiddenTracks: ["zooms"], futureField: 7 },
    });
  });

  it("reports a refused save instead of leaving an unhandled rejection", async () => {
    captureException.mockClear();
    const failure = new Error("settings:update refused");
    const update = vi.fn().mockRejectedValue(failure);
    const { result } = renderHook(() => useHiddenTracks(store([], update)));
    act(() => result.current.toggle("zooms"));
    await waitFor(() =>
      expect(captureException).toHaveBeenCalledWith(failure, {
        context: "editor-hidden-tracks-save",
      }),
    );
  });
});
