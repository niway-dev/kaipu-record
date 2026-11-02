import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeSettings } from "../services/settings.service";
import {
  MachineSettingsStore,
  SETTINGS_FILE,
  folderState,
  normalizeOverride,
  readFolderOverrides,
  resolveEffective,
  writeFolderOverrides,
} from "./settings-overrides";

let root: string;
const DEFAULTS = mergeSettings(null);

let userData: string;

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

async function putSettingsFile(content: string): Promise<void> {
  await mkdir(join(root, ".kaipu", "workspace"), { recursive: true });
  await writeFile(join(root, SETTINGS_FILE), content);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kaipu-ws-"));
  userData = await mkdtemp(join(tmpdir(), "kaipu-userdata-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(userData, { recursive: true, force: true });
});

describe("normalizeOverride (each key uses the validator mergeSettings uses)", () => {
  it("accepts a valid value of each overridable key", () => {
    expect(normalizeOverride("showBrandBadge", true)).toEqual({ ok: true, value: true });
    expect(normalizeOverride("screenshotCopy", "manual")).toEqual({ ok: true, value: "manual" });
    expect(normalizeOverride("exportQuality", "maximum")).toEqual({ ok: true, value: "maximum" });
    expect(normalizeOverride("uploadMode", "automatic")).toEqual({ ok: true, value: "automatic" });
    const quality = DEFAULTS.recordingQuality;
    expect(normalizeOverride("recordingQuality", quality)).toEqual({ ok: true, value: quality });
  });

  it("rejects an invalid value instead of defaulting it", () => {
    expect(normalizeOverride("showBrandBadge", "yes")).toEqual({ ok: false });
    expect(normalizeOverride("screenshotCopy", "always")).toEqual({ ok: false });
    expect(normalizeOverride("exportQuality", "ultra")).toEqual({ ok: false });
    expect(normalizeOverride("uploadMode", "sometimes")).toEqual({ ok: false });
    expect(normalizeOverride("recordingQuality", { resolution: 12, fps: 1, bitrate: "x" })).toEqual(
      { ok: false },
    );
    expect(normalizeOverride("recordingQuality", "1080p60")).toEqual({ ok: false });
  });
});

describe("readFolderOverrides", () => {
  it("reports an absent file without creating anything", async () => {
    expect(await readFolderOverrides(root)).toEqual({ kind: "absent" });
    expect(await readdir(root)).toEqual([]);
  });

  it("reads the valid entries and hashes the exact bytes", async () => {
    const text = JSON.stringify({
      version: 1,
      overrides: { showBrandBadge: false, screenshotCopy: "manual" },
    });
    await putSettingsFile(text);
    const read = await readFolderOverrides(root);
    expect(read).toEqual({
      kind: "ok",
      overrides: { showBrandBadge: false, screenshotCopy: "manual" },
      sha256: sha(text),
    });
  });

  it("ignores an unknown key, a key outside the folder list (uploadMode) and an invalid value", async () => {
    const text = JSON.stringify({
      version: 1,
      overrides: {
        uploadMode: "automatic",
        shortcuts: { startRecording: "A" },
        theme: "light",
        mystery: 1,
        exportQuality: "ultra",
        screenshotCopy: "manual",
      },
    });
    await putSettingsFile(text);
    const read = await readFolderOverrides(root);
    expect(read).toMatchObject({ kind: "ok", overrides: { screenshotCopy: "manual" } });
    if (read.kind === "ok") expect(Object.keys(read.overrides)).toEqual(["screenshotCopy"]);
    // Reading never rewrites the file.
    expect(await readFile(join(root, SETTINGS_FILE), "utf-8")).toBe(text);
  });

  it("reads a file that is not JSON, or has the wrong shape, as unreadable", async () => {
    await putSettingsFile("{not json");
    expect(await readFolderOverrides(root)).toEqual({ kind: "unreadable" });
    await putSettingsFile(JSON.stringify({ version: 2, overrides: {} }));
    expect(await readFolderOverrides(root)).toEqual({ kind: "unreadable" });
    await putSettingsFile(JSON.stringify({ version: 1, overrides: [1] }));
    expect(await readFolderOverrides(root)).toEqual({ kind: "unreadable" });
  });

  it("reads a path that cannot be read (a directory) as unreadable", async () => {
    await mkdir(join(root, SETTINGS_FILE), { recursive: true });
    expect(await readFolderOverrides(root)).toEqual({ kind: "unreadable" });
  });
});

describe("writeFolderOverrides", () => {
  it("writes version 1 with only the given keys and returns the sha256 of the bytes", async () => {
    const hash = await writeFolderOverrides(root, { showBrandBadge: false });
    const text = await readFile(join(root, SETTINGS_FILE), "utf-8");
    expect(JSON.parse(text)).toEqual({ version: 1, overrides: { showBrandBadge: false } });
    expect(hash).toBe(sha(text));
    const read = await readFolderOverrides(root);
    expect(read).toMatchObject({ kind: "ok", sha256: hash });
  });

  it("refuses a missing folder instead of recreating it (an unplugged drive stays unplugged)", async () => {
    const gone = join(root, "unplugged");
    await expect(writeFolderOverrides(gone, { showBrandBadge: true })).rejects.toThrow();
    await expect(readdir(root)).resolves.toEqual([]);
  });
});

describe("folderState", () => {
  const ok = (hash: string, overrides = { screenshotCopy: "manual" as const }) =>
    ({ kind: "ok", overrides, sha256: hash }) as const;

  it("is none for an absent file or a file with no valid entry", () => {
    expect(folderState({ kind: "absent" }, undefined)).toBe("none");
    expect(folderState({ kind: "ok", overrides: {}, sha256: "a" }, undefined)).toBe("none");
  });

  it("is pending with no record, and pending again when the file's hash differs", () => {
    expect(folderState(ok("h1"), undefined)).toBe("pending");
    expect(folderState(ok("h2"), { sha256: "h1", decision: "use", at: 1 })).toBe("pending");
  });

  it("is active only for the exact confirmed file", () => {
    expect(folderState(ok("h1"), { sha256: "h1", decision: "use", at: 1 })).toBe("active");
  });

  it("is ignored for the exact ignored file, and stays inactive", () => {
    expect(folderState(ok("h1"), { sha256: "h1", decision: "ignore", at: 1 })).toBe("ignored");
  });

  it("is unreadable for a file that cannot be read, whatever was recorded", () => {
    expect(folderState({ kind: "unreadable" }, { sha256: "h1", decision: "use", at: 1 })).toBe(
      "unreadable",
    );
  });
});

describe("resolveEffective", () => {
  it("is the All value when there is no override", () => {
    expect(resolveEffective(DEFAULTS, {})).toEqual(DEFAULTS);
  });

  it("takes the override per key and leaves every other key at the All value", () => {
    const all = { ...DEFAULTS, screenshotCopy: "auto" as const, theme: "light" as const };
    const effective = resolveEffective(all, { screenshotCopy: "manual", showBrandBadge: true });
    expect(effective.screenshotCopy).toBe("manual");
    expect(effective.showBrandBadge).toBe(true);
    expect(effective.theme).toBe("light");
    expect(effective.shortcuts).toBe(all.shortcuts);
    // Nothing is copied into the All level.
    expect(all.screenshotCopy).toBe("auto");
  });
});

describe("MachineSettingsStore (userData/workspace-settings.json)", () => {
  const file = (): string => join(userData, "workspace-settings.json");

  it("starts empty and writes nothing until something is stored", async () => {
    const store = await MachineSettingsStore.open(file());
    expect(store.get("w1")).toEqual({});
    await expect(readFile(file(), "utf-8")).rejects.toThrow();
  });

  it("stores uploadMode and the folder record per workspace, and reloads them", async () => {
    const store = await MachineSettingsStore.open(file());
    await store.update("w1", (entry) => ({ ...entry, uploadMode: "manual" }));
    await store.update("w1", (entry) => ({
      ...entry,
      folderOverrides: { sha256: "abc", decision: "use", at: 5 },
    }));
    const text = JSON.parse(await readFile(file(), "utf-8"));
    expect(text).toEqual({
      version: 1,
      workspaces: {
        w1: { uploadMode: "manual", folderOverrides: { sha256: "abc", decision: "use", at: 5 } },
      },
    });
    const again = await MachineSettingsStore.open(file());
    expect(again.get("w1")).toEqual({
      uploadMode: "manual",
      folderOverrides: { sha256: "abc", decision: "use", at: 5 },
    });
  });

  it("drops an entry that becomes empty", async () => {
    const store = await MachineSettingsStore.open(file());
    await store.update("w1", () => ({ uploadMode: "manual" }));
    await store.update("w1", () => ({}));
    expect(JSON.parse(await readFile(file(), "utf-8"))).toEqual({ version: 1, workspaces: {} });
  });

  it("ignores invalid stored values", async () => {
    await writeFile(
      file(),
      JSON.stringify({
        version: 1,
        workspaces: {
          w1: { uploadMode: "sometimes", folderOverrides: { sha256: 3, decision: "use", at: 1 } },
          w2: { uploadMode: "automatic", folderOverrides: { sha256: "x", decision: "maybe" } },
        },
      }),
    );
    const store = await MachineSettingsStore.open(file());
    expect(store.get("w1")).toEqual({});
    expect(store.get("w2")).toEqual({ uploadMode: "automatic" });
  });

  it("keeps a file it cannot parse aside before the first write over it", async () => {
    await writeFile(file(), "{broken");
    const store = await MachineSettingsStore.open(file());
    expect(store.get("w1")).toEqual({});
    await store.update("w1", () => ({ uploadMode: "manual" }));
    const names = await readdir(userData);
    expect(names.some((name) => name.startsWith("workspace-settings.json.corrupt"))).toBe(true);
    expect(JSON.parse(await readFile(file(), "utf-8"))).toMatchObject({
      workspaces: { w1: { uploadMode: "manual" } },
    });
  });

  it("serializes concurrent updates", async () => {
    const store = await MachineSettingsStore.open(file());
    await Promise.all(
      ["a", "b", "c", "d"].map((id) => store.update(id, () => ({ uploadMode: "manual" }))),
    );
    const again = await MachineSettingsStore.open(file());
    for (const id of ["a", "b", "c", "d"]) expect(again.get(id)).toEqual({ uploadMode: "manual" });
  });

  it("does not treat an unreadable file as absent: it rejects updates and leaves the file alone", async () => {
    // A directory in its place: reading it fails with something other than "no such file".
    await mkdir(file(), { recursive: true });
    await writeFile(join(file(), "keep.txt"), "x");
    const store = await MachineSettingsStore.open(file());
    expect(store.get("w1")).toEqual({});
    await expect(store.update("w1", () => ({ uploadMode: "manual" }))).rejects.toThrow();
    expect(await readFile(join(file(), "keep.txt"), "utf-8")).toBe("x");
    // Nothing was kept in memory for the write that failed.
    expect(store.get("w1")).toEqual({});
  });

  it("reads the file again on the next update, so a temporary failure heals", async () => {
    await writeFile(
      file(),
      JSON.stringify({ version: 1, workspaces: { w2: { uploadMode: "automatic" } } }),
    );
    const store = await MachineSettingsStore.open(file());
    expect(store.get("w2")).toEqual({ uploadMode: "automatic" });
    // Simulate a store that first failed to read: swap the file for a directory, reopen, restore.
    await rm(file());
    await mkdir(file());
    const failed = await MachineSettingsStore.open(file());
    await rm(file(), { recursive: true });
    await writeFile(
      file(),
      JSON.stringify({ version: 1, workspaces: { w2: { uploadMode: "automatic" } } }),
    );
    await failed.update("w1", () => ({ uploadMode: "manual" }));
    expect(failed.get("w2")).toEqual({ uploadMode: "automatic" });
    expect(JSON.parse(await readFile(file(), "utf-8"))).toMatchObject({
      workspaces: { w1: { uploadMode: "manual" }, w2: { uploadMode: "automatic" } },
    });
  });
});
