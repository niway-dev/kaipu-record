import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IPC_CHANNELS } from "@shared/types/ipc";
import { MAX_SAVE_TEXT_BYTES } from "@shared/types/save-text-file";

const state = vi.hoisted(() => ({
  dir: "",
  handle: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  showSaveDialog: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { getPath: () => state.dir },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) =>
      state.handle.set(channel, fn),
  },
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showSaveDialog: state.showSaveDialog },
}));
vi.mock("./infrastructure/settings-store", () => ({ getAppSettings: () => ({ locale: "en" }) }));

import { registerSaveTextFileIpc, saveTextFileName } from "./save-text-file-ipc";

const call = (request: unknown) =>
  Promise.resolve().then(() =>
    state.handle.get(IPC_CHANNELS.saveTextFile)!({ sender: {} }, request),
  );

const REQUEST = {
  suggestedName: "My video",
  extension: "srt",
  text: "1\n00:00:00,000 --> 00:00:01,000\nHola ñ\n",
};

beforeAll(async () => {
  state.dir = await mkdtemp(join(tmpdir(), "kaipu-save-text-"));
  registerSaveTextFileIpc();
});
afterAll(async () => {
  await rm(state.dir, { recursive: true, force: true });
});
beforeEach(() => {
  state.showSaveDialog.mockReset();
});

describe("saveTextFile", () => {
  it("seeds the dialog with the sanitized name in Downloads and writes UTF-8 where the user chose", async () => {
    const target = join(state.dir, "out.srt");
    state.showSaveDialog.mockResolvedValue({ canceled: false, filePath: target });
    const result = await call({ ...REQUEST, suggestedName: "Demo: 10/7" });
    expect(result).toEqual({ status: "saved", path: target });
    expect(await readFile(target, "utf8")).toBe(REQUEST.text);
    const options = state.showSaveDialog.mock.calls[0][0];
    expect(options.defaultPath).toBe(join(state.dir, "Demo- 10-7.srt"));
    expect(options.filters[0].extensions).toEqual(["srt"]);
    // No temp file is left behind.
    expect((await readdir(state.dir)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("replaces an existing file", async () => {
    const target = join(state.dir, "again.txt");
    await writeFile(target, "old");
    state.showSaveDialog.mockResolvedValue({ canceled: false, filePath: target });
    await call({ ...REQUEST, extension: "txt", text: "new" });
    expect(await readFile(target, "utf8")).toBe("new");
  });

  it("resolves cancelled and writes nothing when the dialog is dismissed", async () => {
    state.showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined });
    expect(await call(REQUEST)).toEqual({ status: "cancelled" });
  });

  it("resolves failed when the file cannot be written", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    await mkdir(join(state.dir, "dir"), { recursive: true });
    // The target is a directory: the rename over it fails.
    state.showSaveDialog.mockResolvedValue({ canceled: false, filePath: join(state.dir, "dir") });
    expect(await call(REQUEST)).toEqual({ status: "failed" });
    expect((await readdir(state.dir)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    quiet.mockRestore();
  });

  it.each([
    ["not an object", null],
    ["a format outside the allowlist", { ...REQUEST, extension: "exe" }],
    ["a missing format", { suggestedName: "x", text: "hi" }],
    ["a non-string text", { ...REQUEST, text: 5 }],
    ["empty text", { ...REQUEST, text: "" }],
    ["text over the cap", { ...REQUEST, text: "a".repeat(MAX_SAVE_TEXT_BYTES + 1) }],
    ["a non-string name", { ...REQUEST, suggestedName: 3 }],
    ["an overlong name", { ...REQUEST, suggestedName: "n".repeat(600) }],
  ])("rejects %s before any dialog opens", async (_label, request) => {
    await expect(call(request)).rejects.toThrow(/save-text/);
    expect(state.showSaveDialog).not.toHaveBeenCalled();
  });
});

describe("saveTextFileName", () => {
  it("replaces reserved characters, strips leading dots and falls back to a default", () => {
    expect(saveTextFileName("a/b:c", "vtt")).toBe("a-b-c.vtt");
    expect(saveTextFileName("..hidden", "txt")).toBe("hidden.txt");
    expect(saveTextFileName("   ", "srt")).toBe("transcript.srt");
  });
});
