import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IPC_CHANNELS } from "@shared/types/ipc";
import { VAULT_MAINTENANCE_MARKER } from "@shared/types/library-storage";

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
import { vaultActivity } from "./vault-activity";

/** Handlers that never touch the vault's files, or only reveal them. */
const EXEMPT = new Set<string>([
  IPC_CHANNELS.refreshCloudCatalog,
  IPC_CHANNELS.revealLocalRecording,
  IPC_CHANNELS.getVaultDirectory,
  IPC_CHANNELS.openVaultDirectory,
  // The reconcile channels answer for themselves ("maintenance", "already-running").
  IPC_CHANNELS.libraryReconcileScan,
  IPC_CHANNELS.libraryReconcileFix,
  IPC_CHANNELS.libraryReconcileCancel,
]);

describe("library IPC — maintenance mode refuses every entry point (C1)", () => {
  beforeAll(async () => {
    state.dir = await mkdtemp(join(tmpdir(), "kaipu-ipc-maint-"));
    registerLibraryVaultHandlers({
      auth: { getCurrentAccount: () => null, onAccountChanged: () => () => {} } as never,
      serverUrl: "http://localhost",
      isExportActive: () => false,
    });
  });
  afterAll(async () => {
    await rm(state.dir, { recursive: true, force: true });
  });

  it("registers the vault handlers this test walks", () => {
    for (const channel of [
      IPC_CHANNELS.listLibraryItems,
      IPC_CHANNELS.renameLocalRecording,
      IPC_CHANNELS.deleteLocalRecording,
      IPC_CHANNELS.removeLocalCopy,
      IPC_CHANNELS.backfillLocalRecordingMeta,
      IPC_CHANNELS.listTags,
      IPC_CHANNELS.setItemTags,
      IPC_CHANNELS.gifSave,
      IPC_CHANNELS.chooseVaultDirectory,
      IPC_CHANNELS.resetVaultDirectory,
      IPC_CHANNELS.videoEditSaveSession,
      IPC_CHANNELS.editorSessionAcquire,
    ]) {
      expect(state.handle.has(channel), channel).toBe(true);
    }
  });

  it("every non-exempt handler rejects with the maintenance marker, doing nothing", async () => {
    const exit = await vaultActivity.enterMaintenance();
    try {
      const sender = { id: 1, isDestroyed: () => false, once: () => {} };
      for (const [channel, handler] of state.handle) {
        if (EXEMPT.has(channel)) continue;
        const outcome = await Promise.resolve()
          .then(() => handler({ sender }, "Demo", "a-1", "Title"))
          .then(
            () => "resolved",
            (error: unknown) => String(error),
          );
        expect(outcome, channel).toContain(VAULT_MAINTENANCE_MARKER);
      }
    } finally {
      exit();
    }
  });
});
