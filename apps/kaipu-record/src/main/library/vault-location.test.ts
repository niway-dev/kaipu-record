import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
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

const prefs = () => join(mockState.userDataDir, "preferences.json");

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

  it("serves later reads from memory", () => {
    setVaultDirectory("/a");
    writeFileSync(prefs(), JSON.stringify({ vaultDirectory: "/b" }));
    expect(vaultDirectory().path).toBe("/a");
  });

  it("a set after a hand edit merges the file's other keys", () => {
    writeFileSync(prefs(), JSON.stringify({ vaultDirectory: "/x", other: 1 }));
    setVaultDirectory("/y");
    expect(JSON.parse(readFileSync(prefs(), "utf-8"))).toEqual({ vaultDirectory: "/y", other: 1 });
    expect(vaultDirectory().path).toBe("/y");
  });

  it("reset after a hand edit drops only vaultDirectory", () => {
    writeFileSync(prefs(), JSON.stringify({ vaultDirectory: "/x", other: 1 }));
    resetVaultDirectory();
    expect(JSON.parse(readFileSync(prefs(), "utf-8"))).toEqual({ other: 1 });
    expect(vaultDirectory().isCustom).toBe(false);
  });

  it("a failed write keeps the previous value", async () => {
    setVaultDirectory("/ok");
    // afterEach's rm is then a no-op on the removed dir (force: true).
    await rm(mockState.userDataDir, { recursive: true, force: true });
    expect(() => setVaultDirectory("/new")).toThrow();
    expect(vaultDirectory().path).toBe("/ok");
  });

  it("a different userData dir does not see another dir's cache", async () => {
    setVaultDirectory("/one");
    mockState.userDataDir = await mkdtemp(join(tmpdir(), "kaipu-prefs-b-"));
    expect(vaultDirectory().isCustom).toBe(false);
  });
});
