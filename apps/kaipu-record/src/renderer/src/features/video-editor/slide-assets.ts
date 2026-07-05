/**
 * In-memory store for image slides added to the video editor. A plain factory (not a
 * hook) held in a `useRef` by the page — assets must outlive scene undo/redo, so an
 * undone slide's image stays available if the user redoes it. Plan 06 will persist
 * `entries()` next to the edit session; until then leaving the editor discards them
 * along with the rest of the unsaved scene.
 */

export interface SlideAsset {
  assetId: string;
  bytes: ArrayBuffer;
  mimeType: string;
  /** Object URL for `bytes` — safe to use directly as an <img src>. */
  url: string;
  naturalWidth: number;
  naturalHeight: number;
}

export interface SlideAssetStore {
  get(assetId: string): SlideAsset | null;
  /** Decodes `bytes` to measure natural size, then stores the asset. */
  put(bytes: ArrayBuffer, mimeType: string): Promise<SlideAsset>;
  /**
   * Re-insert an asset recovered from a saved session, preserving its original
   * `assetId` so slide items in the restored scene can still reference it. The
   * regular `put()` always mints a fresh UUID, which would break the restored
   * scene's slide→asset links.
   */
  restoreAsset(assetId: string, bytes: ArrayBuffer, mimeType: string): Promise<SlideAsset>;
  entries(): SlideAsset[];
  /** Revokes every object URL — call on editor unmount. */
  dispose(): void;
}

/** jsdom has no `createImageBitmap`; measuring via an `Image` element works in both
 *  the renderer and the test environment (see slide-assets.test.ts). */
function measureNaturalSize(url: string): Promise<{ naturalWidth: number; naturalHeight: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () =>
      resolve({ naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
    img.onerror = () => reject(new Error("slide-assets: image decode failed"));
    img.src = url;
  });
}

export function createSlideAssetStore(): SlideAssetStore {
  const assets = new Map<string, SlideAsset>();

  return {
    get(assetId) {
      return assets.get(assetId) ?? null;
    },

    async put(bytes, mimeType) {
      const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
      const { naturalWidth, naturalHeight } = await measureNaturalSize(url);
      const asset: SlideAsset = {
        assetId: crypto.randomUUID(),
        bytes,
        mimeType,
        url,
        naturalWidth,
        naturalHeight,
      };
      assets.set(asset.assetId, asset);
      return asset;
    },

    async restoreAsset(assetId, bytes, mimeType) {
      const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
      const { naturalWidth, naturalHeight } = await measureNaturalSize(url);
      const asset: SlideAsset = { assetId, bytes, mimeType, url, naturalWidth, naturalHeight };
      assets.set(assetId, asset);
      return asset;
    },

    entries() {
      return Array.from(assets.values());
    },

    dispose() {
      for (const asset of assets.values()) URL.revokeObjectURL(asset.url);
      assets.clear();
    },
  };
}
