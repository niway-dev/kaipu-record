import { afterEach, describe, expect, it, vi } from "vitest";
import { anyJoinedHasWebcam, readJoinedLibrary } from "./joined-library";

function stubLibrary(result: { items: unknown[]; vaultError: string | null }) {
  vi.stubGlobal("window", {
    electronAPI: { listLibraryItems: vi.fn(async () => ({ ...result, catalogVerifiedAt: null })) },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("readJoinedLibrary", () => {
  it("throws when the vault could not be read, instead of reporting the recording as gone", async () => {
    stubLibrary({ items: [], vaultError: "EACCES: permission denied" });
    await expect(readJoinedLibrary(["asset-b"])).rejects.toThrow("EACCES");
  });

  it("returns an empty map without reading when nothing is joined", async () => {
    stubLibrary({ items: [], vaultError: "EACCES" });
    expect((await readJoinedLibrary([])).size).toBe(0);
  });
});

describe("anyJoinedHasWebcam", () => {
  it("keeps the saved layer (true) when the vault cannot be read", async () => {
    stubLibrary({ items: [], vaultError: "EACCES" });
    expect(await anyJoinedHasWebcam([{ assetId: "asset-b" }])).toBe(true);
  });
});
