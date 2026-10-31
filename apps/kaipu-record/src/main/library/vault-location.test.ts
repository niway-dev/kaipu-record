import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
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

import { defaultVaultDirectory, forgetCachedPreferences, vaultDirectory } from "./vault-location";

const prefs = () => join(mockState.userDataDir, "preferences.json");

describe("vault-location", () => {
  beforeEach(async () => {
    mockState.userDataDir = await mkdtemp(join(tmpdir(), "kaipu-prefs-"));
    forgetCachedPreferences();
  });

  afterEach(async () => {
    await rm(mockState.userDataDir, { recursive: true, force: true });
  });

  it("defaults to the platform Videos folder when nothing is stored", () => {
    expect(defaultVaultDirectory()).toBe(join("/Movies", "Kaipu Record"));
    expect(vaultDirectory()).toEqual({ path: join("/Movies", "Kaipu Record"), isCustom: false });
  });

  it("reads the mirrored vaultDirectory and flags it as custom", () => {
    writeFileSync(prefs(), JSON.stringify({ vaultDirectory: "/Users/me/Recordings" }));
    expect(vaultDirectory()).toEqual({ path: "/Users/me/Recordings", isCustom: true });
  });

  it("an unparseable file reads as the default folder, as before workspaces", () => {
    writeFileSync(prefs(), "{ nope");
    expect(vaultDirectory().isCustom).toBe(false);
  });

  it("serves later reads from memory until the registry says it wrote the file", () => {
    writeFileSync(prefs(), JSON.stringify({ vaultDirectory: "/a" }));
    expect(vaultDirectory().path).toBe("/a");
    writeFileSync(prefs(), JSON.stringify({ vaultDirectory: "/b" }));
    expect(vaultDirectory().path).toBe("/a");
    forgetCachedPreferences();
    expect(vaultDirectory().path).toBe("/b");
  });

  it("a different userData dir does not see another dir's cache", async () => {
    writeFileSync(prefs(), JSON.stringify({ vaultDirectory: "/one" }));
    expect(vaultDirectory().isCustom).toBe(true);
    mockState.userDataDir = await mkdtemp(join(tmpdir(), "kaipu-prefs-b-"));
    expect(vaultDirectory().isCustom).toBe(false);
  });
});
