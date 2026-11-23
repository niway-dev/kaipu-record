import { describe, expect, it, vi } from "vitest";
import {
  detectSync,
  detectSyncedFolder,
  GOOGLE_DRIVE_ITEM_XATTR,
  syncProviderOfPath,
  syncRootOfPath,
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
    // Another iCloud container is iCloud too, not only iCloud Drive.
    [`${HOME}/Library/Mobile Documents/iCloud~md~obsidian/Documents/Kaipu`, "icloud"],
    // The home-folder roots of the clients before File Provider.
    [`${HOME}/Google Drive/Kaipu`, "google-drive"],
    [`${HOME}/Dropbox/Kaipu`, "cloud-provider"],
    [`${HOME}/Dropbox (Personal)/Kaipu`, "cloud-provider"],
    [`${HOME}/OneDrive/Kaipu`, "onedrive"],
    [`${HOME}/OneDrive - Acme Corp/Captures`, "onedrive"],
  ])("%s → %s", (path, provider) => {
    expect(syncProviderOfPath(path, HOME)).toBe(provider);
  });

  it.each([
    `${HOME}/Movies/Kaipu Record`,
    "/Volumes/T7/Kaipu",
    `${HOME}/Library/CloudStorageX/GoogleDrive-a/b`,
    // Omitted on purpose (see `syncProviderOfPath`): the path is the same with iCloud's
    // "Desktop & Documents" on and off.
    `${HOME}/Documents/Kaipu`,
    `${HOME}/Desktop/Kaipu`,
    // A root is a folder directly under home, named as the provider names it.
    `${HOME}/Dropboxes/Kaipu`,
    `${HOME}/OneDriveBackup/Kaipu`,
    `${HOME}/Movies/Dropbox/Kaipu`,
    `${HOME}/GoogleDriveBackup/Kaipu`,
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

  it("an xattr read that hangs or fails reads as the generic synced folder, within the timeout", async () => {
    const started = Date.now();
    expect(
      await detectSync(`${HOME}/Movies/K`, deps({ hasXattr: () => new Promise(() => {}) })),
    ).toBe("cloud-provider");
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
    ).toBe("cloud-provider");
  });

  it("a realpath that hangs on a folder the path rule misses is not proof of a plain folder", async () => {
    expect(
      await detectSync(`${HOME}/Movies/K`, deps({ realpath: () => new Promise(() => {}) })),
    ).toBe("cloud-provider");
  });

  it("answers that say no are final: no attribute, a path that cannot be resolved", async () => {
    expect(await detectSync(`${HOME}/Movies/K`, deps({ hasXattr: async () => false }))).toBeNull();
    expect(
      await detectSync(
        `${HOME}/Movies/K`,
        deps({
          realpath: async () => {
            throw Object.assign(new Error("gone"), { code: "ENOENT" });
          },
        }),
      ),
    ).toBeNull();
  });
});

describe("syncRootOfPath: where the provider's folder starts, from the path rule alone", () => {
  it.each([
    [
      `${HOME}/Library/CloudStorage/GoogleDrive-ana@acme.com/My Drive/Kaipu`,
      `${HOME}/Library/CloudStorage/GoogleDrive-ana@acme.com`,
    ],
    [
      `${HOME}/Library/Mobile Documents/com~apple~CloudDocs/Kaipu`,
      `${HOME}/Library/Mobile Documents`,
    ],
    [`${HOME}/Google Drive/Kaipu`, `${HOME}/Google Drive`],
    [`${HOME}/Dropbox (Personal)/Kaipu`, `${HOME}/Dropbox (Personal)`],
    [`${HOME}/OneDrive - Acme Corp/Captures`, `${HOME}/OneDrive - Acme Corp`],
  ])("%s → %s", (path, root) => {
    expect(syncRootOfPath(path, HOME)).toBe(root);
  });

  it("is null where the path rule names no provider, a folder found by xattr included", () => {
    expect(syncRootOfPath("/Volumes/Ext/GoogleDrive/My Drive/Kaipu", HOME)).toBeNull();
    expect(syncRootOfPath(`${HOME}/Documents/Kaipu`, HOME)).toBeNull();
  });
});

describe("detectSyncedFolder: a folder the user picked, not a workspace root", () => {
  const answering = (tagged: (file: string) => boolean | null): SyncDetectDeps => ({
    home: HOME,
    realpath: async (path) => path,
    hasXattr: async (file) => tagged(file),
    timeoutMs: 50,
  });

  it("finds a Drive folder through an ancestor the xattr names, though the folder has no identity.json", async () => {
    const drive = "/Volumes/Ext/GoogleDrive/My Drive";
    const deps = answering((file) => file === drive);
    // `detectSync` alone asks only about identity.json, which this folder does not have.
    expect(await detectSync(`${drive}/Exports`, deps)).toBeNull();
    expect(await detectSyncedFolder(`${drive}/Exports`, deps)).toBe("google-drive");
  });

  it("a folder no ancestor tags is plain", async () => {
    expect(
      await detectSyncedFolder(
        "/Volumes/Ext/Exports",
        answering(() => false),
      ),
    ).toBeNull();
  });

  it("an ancestor that does not answer reads as synced, never as plain", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      await detectSyncedFolder(
        "/Volumes/Ext/Exports",
        answering(() => null),
      ),
    ).toBe("cloud-provider");
    warn.mockRestore();
  });
});
