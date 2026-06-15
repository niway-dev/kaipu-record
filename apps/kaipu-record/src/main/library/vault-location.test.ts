import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock Electron's `app.getPath`: userData → a temp dir (so we read/write a real
// preferences.json without touching the user's machine), videos → a fixed root.
const mockState = vi.hoisted(() => ({ userDataDir: "" }));
vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => (name === "userData" ? mockState.userDataDir : "/Movies"),
  },
}));

import {
  defaultVaultDirectory,
  resetVaultDirectory,
  setVaultDirectory,
  vaultDirectory,
} from "./vault-location";

describe("vault-location", () => {
  beforeEach(async () => {
    mockState.userDataDir = await mkdtemp(join(tmpdir(), "kaipu-prefs-"));
  });

  afterEach(async () => {
    await rm(mockState.userDataDir, { recursive: true, force: true });
  });

  it("defaults to the platform Videos folder when nothing is stored", () => {
    expect(defaultVaultDirectory()).toBe(join("/Movies", "Kaipu Record"));
    expect(vaultDirectory()).toEqual({ path: join("/Movies", "Kaipu Record"), isCustom: false });
  });

  it("persists a custom directory and flags it as custom", () => {
    setVaultDirectory("/Users/me/Recordings");
    expect(vaultDirectory()).toEqual({ path: "/Users/me/Recordings", isCustom: true });
  });

  it("reset restores the default", () => {
    setVaultDirectory("/custom");
    resetVaultDirectory();
    expect(vaultDirectory()).toEqual({ path: join("/Movies", "Kaipu Record"), isCustom: false });
  });
});
