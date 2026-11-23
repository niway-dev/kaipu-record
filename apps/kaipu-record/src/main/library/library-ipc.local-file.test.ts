import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shell } from "electron";
import { IPC_CHANNELS } from "@shared/types/ipc";

const state = vi.hoisted(() => ({
  dir: "",
  handle: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
}));

vi.mock("electron", () => ({
  app: { getPath: () => state.dir },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) =>
      state.handle.set(channel, fn),
    on: () => {},
  },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
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

import { registerLibraryVaultHandlers } from "./index";

/** The workspace stamp the preload sends first on every item-scoped call. */
const STAMP = { workspaceId: "ws-test", generation: 1 };
const EVENT = {};

function handler(channel: string): (event: unknown, ...args: unknown[]) => Promise<unknown> {
  const fn = state.handle.get(channel);
  if (!fn) throw new Error(`no handler registered for ${channel}`);
  return async (...args) => fn(...args);
}

describe("library IPC — openLocalRecording and localRecordingPath (NIW2-669)", () => {
  let vault: string;

  beforeAll(async () => {
    state.dir = await mkdtemp(join(tmpdir(), "kaipu-ipc-local-file-"));
    vault = join(state.dir, "vault");
    await mkdir(vault, { recursive: true });
    await writeFile(join(vault, "item-1.mp4"), "video");
    await writeFile(join(vault, "shot-1.png"), "png");
    await writeFile(join(vault, "gif-1.gif"), "gif");
    registerLibraryVaultHandlers({
      auth: { getCurrentAccount: () => null, onAccountChanged: () => () => {} } as never,
      serverUrl: "http://localhost",
      isExportActive: () => false,
    });
  });
  afterAll(async () => {
    await rm(state.dir, { recursive: true, force: true });
  });
  beforeEach(() => {
    vi.mocked(shell.openPath).mockClear();
    vi.mocked(shell.openPath).mockResolvedValue("");
  });

  it("openLocalRecording opens the vault file for the id with the default app", async () => {
    await handler(IPC_CHANNELS.openLocalRecording)(EVENT, STAMP, "item-1");

    expect(shell.openPath).toHaveBeenCalledTimes(1);
    expect(shell.openPath).toHaveBeenCalledWith(join(vault, "item-1.mp4"));
  });

  it("openLocalRecording throws the OS error when openPath returns one", async () => {
    vi.mocked(shell.openPath).mockResolvedValueOnce("No application knows how to open this file");

    await expect(handler(IPC_CHANNELS.openLocalRecording)(EVENT, STAMP, "item-1")).rejects.toThrow(
      "No application knows how to open this file",
    );
  });

  it("openLocalRecording refuses an unknown id without calling openPath", async () => {
    await expect(handler(IPC_CHANNELS.openLocalRecording)(EVENT, STAMP, "missing")).rejects.toThrow(
      "no local recording",
    );
    expect(shell.openPath).not.toHaveBeenCalled();
  });

  it("localRecordingPath returns the absolute path of a local item", async () => {
    await expect(handler(IPC_CHANNELS.localRecordingPath)(EVENT, STAMP, "item-1")).resolves.toBe(
      join(vault, "item-1.mp4"),
    );
  });

  it("localRecordingPath and openLocalRecording pick the right extension for a screenshot and a GIF", async () => {
    await expect(handler(IPC_CHANNELS.localRecordingPath)(EVENT, STAMP, "shot-1")).resolves.toBe(
      join(vault, "shot-1.png"),
    );
    await expect(handler(IPC_CHANNELS.localRecordingPath)(EVENT, STAMP, "gif-1")).resolves.toBe(
      join(vault, "gif-1.gif"),
    );
    await handler(IPC_CHANNELS.openLocalRecording)(EVENT, STAMP, "shot-1");
    expect(shell.openPath).toHaveBeenLastCalledWith(join(vault, "shot-1.png"));
    await handler(IPC_CHANNELS.openLocalRecording)(EVENT, STAMP, "gif-1");
    expect(shell.openPath).toHaveBeenLastCalledWith(join(vault, "gif-1.gif"));
  });

  it("localRecordingPath returns null for an unknown id", async () => {
    await expect(
      handler(IPC_CHANNELS.localRecordingPath)(EVENT, STAMP, "missing"),
    ).resolves.toBeNull();
  });

  it("both handlers refuse ids that name a path outside the vault", async () => {
    await expect(
      handler(IPC_CHANNELS.localRecordingPath)(EVENT, STAMP, "../item-1"),
    ).resolves.toBeNull();
    await expect(
      handler(IPC_CHANNELS.openLocalRecording)(EVENT, STAMP, "../item-1"),
    ).rejects.toThrow("no local recording");
    expect(shell.openPath).not.toHaveBeenCalled();
  });

  it("refuses a symlink named like an item, so the app never opens its target", async () => {
    await writeFile(join(state.dir, "outside.txt"), "secret");
    await symlink(join(state.dir, "outside.txt"), join(vault, "linked.mp4"));
    await expect(
      handler(IPC_CHANNELS.localRecordingPath)(EVENT, STAMP, "linked"),
    ).resolves.toBeNull();
    await expect(handler(IPC_CHANNELS.openLocalRecording)(EVENT, STAMP, "linked")).rejects.toThrow(
      "no local recording",
    );
    expect(shell.openPath).not.toHaveBeenCalled();
  });

  it("refuses a directory named like an item", async () => {
    await mkdir(join(vault, "folder.mp4"));
    await expect(
      handler(IPC_CHANNELS.localRecordingPath)(EVENT, STAMP, "folder"),
    ).resolves.toBeNull();
    await expect(handler(IPC_CHANNELS.openLocalRecording)(EVENT, STAMP, "folder")).rejects.toThrow(
      "no local recording",
    );
    expect(shell.openPath).not.toHaveBeenCalled();
  });
});
