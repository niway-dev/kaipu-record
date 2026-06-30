import { afterEach, describe, expect, it, vi } from "vitest";
import { blobReader } from "./blob-reader";
import { localReader } from "./local-reader";
import { cloudReader } from "./cloud-reader";

describe("image-source readers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("blobReader returns the original in-memory bytes", async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    expect(await blobReader.getBytes({ kind: "blob", bytes, width: 10, height: 10 })).toBe(bytes);
  });

  it("localReader resolves to the bypass-CSP media protocol URL", () => {
    const resolved = localReader.resolve({ kind: "local", id: "shot-1", width: 10, height: 10 });
    expect(resolved.displayUrl).toBe("kaipu-media://screenshot/shot-1");
  });

  it("localReader appends the version token so an overwrite busts the cache", () => {
    const resolved = localReader.resolve({ kind: "local", id: "shot-1", version: 42 });
    expect(resolved.displayUrl).toBe("kaipu-media://screenshot/shot-1?v=42");
  });

  it("cloudReader resolves to the remote URL as-is", () => {
    const url = "https://cdn.example/x.png";
    expect(cloudReader.resolve({ kind: "cloud", url, width: 10, height: 10 }).displayUrl).toBe(url);
  });

  it("localReader reads bytes through the main bridge (not fetch)", async () => {
    const buf = new Uint8Array([9]).buffer;
    const readMock = vi.fn(async () => buf);
    window.electronAPI.readScreenshotBytes = readMock;
    const bytes = await localReader.getBytes({ kind: "local", id: "shot-2", width: 1, height: 1 });
    expect(bytes).toBe(buf);
    expect(readMock).toHaveBeenCalledWith("shot-2");
  });
});
