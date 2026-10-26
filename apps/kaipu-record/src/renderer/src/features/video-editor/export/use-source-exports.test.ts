import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LibraryItem } from "@shared/types/library-item";
import { useSourceExports } from "./use-source-exports";

function item(assetId: string, derivedFromAssetId: string | null): LibraryItem {
  return {
    assetId,
    kind: "recording",
    title: assetId,
    createdAt: 1,
    durationSeconds: 5,
    derivedFromAssetId,
    editSavedAt: null,
    editExportedSavedAt: null,
    local: null,
    cloud: null,
    availability: "local",
    transfer: { state: "idle" },
    comparison: "same",
    editing: "exported-only",
    sharing: "private",
    capture: null,
  };
}

describe("useSourceExports", () => {
  it("reads nothing until enabled (the sheet opening)", () => {
    window.electronAPI.listLibraryItems = vi.fn();
    const { result } = renderHook(() => useSourceExports("src", false));
    expect(result.current).toEqual([]);
    expect(window.electronAPI.listLibraryItems).not.toHaveBeenCalled();
  });

  it("lists only the items exported from the source", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [item("src", null), item("a", "src"), item("b", "other")],
      vaultError: null,
      catalogVerifiedAt: null,
    }));
    const { result } = renderHook(() => useSourceExports("src", true));
    await waitFor(() => expect(result.current.map((v) => v.assetId)).toEqual(["a"]));
  });

  it("leaves the list empty when the library can't be read", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => {
      throw new Error("vault");
    });
    const { result } = renderHook(() => useSourceExports("src", true));
    await waitFor(() => expect(window.electronAPI.listLibraryItems).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });
});
