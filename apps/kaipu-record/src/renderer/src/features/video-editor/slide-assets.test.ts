import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSlideAssetStore } from "./slide-assets";

// jsdom's Image never fires onload for blob: URLs (no real image decoding), so
// `new Image()` here must be a controllable fake — see the probe in this task's
// TDD notes. Natural size is fixed per test via FIXTURE_W/H below.
const FIXTURE_W = 4;
const FIXTURE_H = 3;

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  private _src = "";

  get src(): string {
    return this._src;
  }

  set src(value: string) {
    this._src = value;
    // Simulate the async decode a real <img> would do.
    queueMicrotask(() => {
      this.naturalWidth = FIXTURE_W;
      this.naturalHeight = FIXTURE_H;
      this.onload?.();
    });
  }
}

function pngBytes(): ArrayBuffer {
  // Content is irrelevant — FakeImage ignores it — but keep it non-empty and PNG-ish.
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer;
}

beforeEach(() => {
  vi.stubGlobal("Image", FakeImage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createSlideAssetStore", () => {
  it("put() decodes the image, measures natural size, and returns a fetchable asset", async () => {
    const store = createSlideAssetStore();
    const asset = await store.put(pngBytes(), "image/png");

    expect(asset.assetId).toEqual(expect.any(String));
    expect(asset.mimeType).toBe("image/png");
    expect(asset.naturalWidth).toBe(FIXTURE_W);
    expect(asset.naturalHeight).toBe(FIXTURE_H);
    expect(asset.url).toEqual(expect.stringContaining("blob:"));
    expect(store.get(asset.assetId)).toEqual(asset);
  });

  it("get() returns null for an unknown id", () => {
    const store = createSlideAssetStore();
    expect(store.get("nope")).toBeNull();
  });

  it("restoreAsset() preserves the given assetId (unlike put(), which mints a fresh one)", async () => {
    const store = createSlideAssetStore();
    const asset = await store.restoreAsset("asset-from-session", pngBytes(), "image/png");

    expect(asset.assetId).toBe("asset-from-session");
    expect(asset.naturalWidth).toBe(FIXTURE_W);
    expect(asset.naturalHeight).toBe(FIXTURE_H);
    expect(store.get("asset-from-session")).toEqual(asset);
    expect(store.entries()).toEqual([asset]);
  });

  it("assigns a fresh assetId per put(), even for identical bytes", async () => {
    const store = createSlideAssetStore();
    const bytes = pngBytes();
    const a = await store.put(bytes, "image/png");
    const b = await store.put(bytes, "image/png");
    expect(a.assetId).not.toBe(b.assetId);
    expect(store.entries()).toHaveLength(2);
  });

  it("entries() lists every stored asset", async () => {
    const store = createSlideAssetStore();
    const a = await store.put(pngBytes(), "image/png");
    const b = await store.put(pngBytes(), "image/jpeg");
    const entries = store.entries();
    expect(entries.map((e) => e.assetId).sort()).toEqual([a.assetId, b.assetId].sort());
  });

  it("dispose() revokes every object URL and empties the store", async () => {
    const store = createSlideAssetStore();
    const a = await store.put(pngBytes(), "image/png");
    const b = await store.put(pngBytes(), "image/png");
    const revoke = vi.spyOn(URL, "revokeObjectURL");

    store.dispose();

    expect(revoke).toHaveBeenCalledWith(a.url);
    expect(revoke).toHaveBeenCalledWith(b.url);
    expect(store.entries()).toHaveLength(0);
    expect(store.get(a.assetId)).toBeNull();
  });

  it("rejects when the image fails to decode", async () => {
    class FailingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 0;
      naturalHeight = 0;
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal("Image", FailingImage);

    const store = createSlideAssetStore();
    await expect(store.put(pngBytes(), "image/png")).rejects.toThrow();
  });
});
