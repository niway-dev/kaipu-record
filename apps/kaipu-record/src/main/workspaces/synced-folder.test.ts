import { describe, expect, it, vi } from "vitest";
import {
  detectSync,
  GOOGLE_DRIVE_ITEM_XATTR,
  syncProviderOfPath,
  type SyncDetectDeps,
} from "./synced-folder";

const HOME = "/Users/ana";

describe("syncProviderOfPath (spec, Synced folders: detection by path)", () => {
  it.each([
    [`${HOME}/Library/CloudStorage/GoogleDrive-ana@acme.com/My Drive/Kaipu`, "google-drive"],
    [`${HOME}/Library/CloudStorage/GoogleDrive-ana@acme.com/Shared drives/Team`, "google-drive"],
    [`${HOME}/Library/CloudStorage/OneDrive-Personal/Kaipu`, "onedrive"],
    [`${HOME}/Library/CloudStorage/OneDrive-AcmeCorp/Captures`, "onedrive"],
    [`${HOME}/Library/Mobile Documents/com~apple~CloudDocs/Kaipu`, "icloud"],
    [`${HOME}/Library/CloudStorage/Dropbox/Kaipu`, "cloud-provider"],
  ])("%s → %s", (path, provider) => {
    expect(syncProviderOfPath(path, HOME)).toBe(provider);
  });

  it.each([
    `${HOME}/Movies/Kaipu Record`,
    "/Volumes/T7/Kaipu",
    `${HOME}/Library/CloudStorageX/GoogleDrive-a/b`,
  ])("%s is not synced", (path) => {
    expect(syncProviderOfPath(path, HOME)).toBeNull();
  });

  it("the provider root itself counts as synced", () => {
    expect(syncProviderOfPath(`${HOME}/Library/CloudStorage/GoogleDrive-a@b.c`, HOME)).toBe(
      "google-drive",
    );
  });
});

function deps(overrides: Partial<SyncDetectDeps> = {}): SyncDetectDeps {
  return {
    home: HOME,
    realpath: async (path) => path,
    hasXattr: async () => false,
    timeoutMs: 50,
    ...overrides,
  };
}

describe("detectSync", () => {
  it("resolves symlinks first: a link to a Drive folder is synced by Google Drive", async () => {
    const result = await detectSync(
      `${HOME}/Desktop/Kaipu`,
      deps({
        realpath: async () => `${HOME}/Library/CloudStorage/GoogleDrive-a@b.c/My Drive/Kaipu`,
      }),
    );
    expect(result).toBe("google-drive");
  });

  it("falls back to Google Drive's item xattr on identity.json when the path says nothing", async () => {
    const hasXattr = vi.fn(async () => true);
    const result = await detectSync(`${HOME}/Documents/Kaipu`, deps({ hasXattr }));
    expect(result).toBe("google-drive");
    expect(hasXattr).toHaveBeenCalledWith(
      `${HOME}/Documents/Kaipu/.kaipu/workspace/identity.json`,
      GOOGLE_DRIVE_ITEM_XATTR,
    );
    expect(GOOGLE_DRIVE_ITEM_XATTR).toBe("com.google.drivefs.item-id#S");
  });

  it("does not read xattrs when the path already says synced (never touches the provider root)", async () => {
    const hasXattr = vi.fn(async () => false);
    await detectSync(`${HOME}/Library/CloudStorage/OneDrive-X/K`, deps({ hasXattr }));
    expect(hasXattr).not.toHaveBeenCalled();
  });

  it("a local folder is not synced", async () => {
    expect(await detectSync(`${HOME}/Movies/Kaipu Record`, deps())).toBeNull();
  });

  it("a realpath that does not answer in time falls back to the registered path", async () => {
    const result = await detectSync(
      `${HOME}/Library/CloudStorage/GoogleDrive-a/My Drive/K`,
      deps({ realpath: () => new Promise(() => {}) }),
    );
    expect(result).toBe("google-drive");
  });

  it("an xattr read that hangs or fails reads as not synced, within the timeout", async () => {
    const started = Date.now();
    expect(
      await detectSync(`${HOME}/Movies/K`, deps({ hasXattr: () => new Promise(() => {}) })),
    ).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(
      await detectSync(
        `${HOME}/Movies/K`,
        deps({
          hasXattr: async () => {
            throw new Error("boom");
          },
        }),
      ),
    ).toBeNull();
  });
});
