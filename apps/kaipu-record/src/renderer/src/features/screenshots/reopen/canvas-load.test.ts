import { afterEach, describe, expect, it, vi } from "vitest";
import { readWithRetry, savedAtOf, whyNoDocument } from "./canvas-load";

const original = window.electronAPI.statScreenshotCanvas;
afterEach(() => {
  window.electronAPI.statScreenshotCanvas = original;
});

describe("whyNoDocument", () => {
  it("is absent when no document file exists: a plain screenshot", async () => {
    window.electronAPI.statScreenshotCanvas = vi.fn(async () => null);
    expect(await whyNoDocument("shot-1")).toBe("absent");
  });

  it("is unreadable when a document file exists although the reader gave up on it", async () => {
    window.electronAPI.statScreenshotCanvas = vi.fn(async () => ({ savedAt: 1 }));
    expect(await whyNoDocument("shot-1")).toBe("unreadable");
  });

  it("is unknown when the question itself fails: a document may be there, intact", async () => {
    window.electronAPI.statScreenshotCanvas = vi.fn(async () => {
      throw new Error("ipc");
    });
    expect(await whyNoDocument("shot-1")).toBe("unknown");
  });
});

describe("savedAtOf", () => {
  it("returns the time the document was written", async () => {
    window.electronAPI.statScreenshotCanvas = vi.fn(async () => ({ savedAt: 1234 }));
    expect(await savedAtOf("shot-1")).toBe(1234);
  });

  it("is null when it cannot be told", async () => {
    window.electronAPI.statScreenshotCanvas = vi.fn(async () => null);
    expect(await savedAtOf("shot-1")).toBeNull();
  });
});

describe("readWithRetry", () => {
  it("returns a later success after a rejection", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("EIO")).mockResolvedValue("doc");
    expect(await readWithRetry(read)).toBe("doc");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("rethrows the last rejection after three attempts", async () => {
    const read = vi.fn().mockRejectedValue(new Error("EIO"));
    await expect(readWithRetry(read)).rejects.toThrow("EIO");
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("does not retry a read that resolves with null", async () => {
    const read = vi.fn().mockResolvedValue(null);
    expect(await readWithRetry(read)).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });
});
