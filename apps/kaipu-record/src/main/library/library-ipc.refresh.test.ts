import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CloudCatalogEntry } from "@shared/types/library-item";
import { IPC_CHANNELS } from "@shared/types/ipc";

const state = vi.hoisted(() => ({
  dir: "",
  handle: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  send: vi.fn(),
  catalog: [] as unknown[],
  fetches: 0,
  account: null as { userId: string; token: string } | null,
  accountChanged: null as ((userId: string | null) => void) | null,
}));

vi.mock("electron", () => ({
  app: { getPath: () => state.dir },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) =>
      state.handle.set(channel, fn),
    on: () => {},
  },
  BrowserWindow: {
    getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: state.send } }],
    fromWebContents: () => null,
  },
  dialog: { showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
  shell: { openPath: vi.fn(async () => ""), showItemInFolder: vi.fn() },
}));
vi.mock("../infrastructure/settings-store", () => ({ getAppSettings: () => ({ locale: "en" }) }));
vi.mock("../workspaces", () => ({
  activeWorkspace: () => ({ id: "ws-test", path: join(state.dir, "vault") }),
  activeEvictionProbe: () => null,
  activeScratch: () => null,
  ownsLegacyCloud: () => true,
  workspaceGate: () => ({
    run: (_stamp: unknown, fn: () => unknown) => Promise.resolve().then(fn),
  }),
}));
vi.mock("./vault-location", () => ({
  vaultDirectory: () => ({ path: join(state.dir, "vault"), isCustom: false }),
  setVaultDirectory: vi.fn(),
  resetVaultDirectory: vi.fn(),
}));
vi.mock("./tag-repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./tag-repository")>()),
  loadDeviceId: async () => "test-device",
}));
vi.mock("../cloud/catalog-client", () => ({
  fetchCloudCatalog: async () => {
    state.fetches += 1;
    return state.catalog;
  },
}));

import { registerLibraryVaultHandlers } from "./index";

const STAMP = { workspaceId: "ws-test", generation: 1 };
const EVENT = {};

const call = async (channel: string, ...args: unknown[]): Promise<unknown> => {
  const fn = state.handle.get(channel);
  if (!fn) throw new Error(`no handler registered for ${channel}`);
  return fn(EVENT, ...args);
};

const entry = (assetId: string, title = "C"): CloudCatalogEntry => ({
  assetId,
  kind: "recording",
  title,
  revisionId: "r1",
  contentType: "video/mp4",
  sizeBytes: 0,
  contentSha256: "x",
  durationSeconds: 1,
  hasThumbnail: false,
  derivedFromAssetId: null,
  autoUploadExcluded: false,
  createdAt: 1,
  lastVerifiedAt: 1,
  lastSeenLocalId: null,
});

const broadcasts = (): number =>
  state.send.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.libraryChanged).length;

describe("library IPC: cloud refresh and tags broadcast only real changes", () => {
  beforeAll(async () => {
    state.dir = await mkdtemp(join(tmpdir(), "kaipu-ipc-refresh-"));
    await mkdir(join(state.dir, "vault"), { recursive: true });
    registerLibraryVaultHandlers({
      auth: {
        getCurrentAccount: () => state.account,
        onAccountChanged: (cb: (userId: string | null) => void) => {
          state.accountChanged = cb;
          return () => {};
        },
      } as never,
      serverUrl: "http://localhost",
      isExportActive: () => false,
    });
  });
  afterAll(async () => {
    await rm(state.dir, { recursive: true, force: true });
  });
  beforeEach(() => {
    state.send.mockClear();
    state.fetches = 0;
    state.account = { userId: "u1", token: "t" };
  });

  it("broadcasts library:changed only when the cloud catalog changed", async () => {
    state.catalog = [entry("a")];
    expect(await call(IPC_CHANNELS.refreshCloudCatalog, true)).toMatchObject({
      ok: true,
      changed: true,
    });
    expect(broadcasts()).toBe(1);

    expect(await call(IPC_CHANNELS.refreshCloudCatalog, true)).toMatchObject({
      ok: true,
      changed: false,
    });
    expect(broadcasts()).toBe(1);

    state.catalog = [entry("a", "renamed")];
    await call(IPC_CHANNELS.refreshCloudCatalog, true);
    expect(broadcasts()).toBe(2);
  });

  it("a non-forced call inside the throttle window does not fetch or broadcast", async () => {
    state.catalog = [entry("a", "renamed")];
    await call(IPC_CHANNELS.refreshCloudCatalog, true);
    const fetched = state.fetches;
    state.send.mockClear();
    await call(IPC_CHANNELS.refreshCloudCatalog);
    await call(IPC_CHANNELS.refreshCloudCatalog, "yes");
    expect(state.fetches).toBe(fetched);
    expect(broadcasts()).toBe(0);
  });

  it("an account change forces the refresh even inside the throttle window", async () => {
    state.catalog = [entry("a", "renamed")];
    await call(IPC_CHANNELS.refreshCloudCatalog, true);
    const fetched = state.fetches;
    state.catalog = [entry("a", "renamed"), entry("b")];
    state.accountChanged?.("u1");
    await vi.waitFor(() => expect(state.fetches).toBe(fetched + 1));
    // One broadcast for the account change itself, one for the catalog that changed.
    await vi.waitFor(() => expect(broadcasts()).toBe(2));
  });

  it("createTag answers a zero-count summary; rename and recolor answer nothing", async () => {
    const created = (await call(IPC_CHANNELS.createTag, STAMP, "alpha", "rose")) as {
      id: string;
      count: number;
      name: string;
    };
    expect(created).toMatchObject({ name: "alpha", color: "rose", count: 0 });
    expect(broadcasts()).toBe(1);
    await expect(call(IPC_CHANNELS.renameTag, STAMP, created.id, "beta")).resolves.toBeUndefined();
    await expect(call(IPC_CHANNELS.recolorTag, STAMP, created.id, "sky")).resolves.toBeUndefined();
    expect(broadcasts()).toBe(3);
  });
});
