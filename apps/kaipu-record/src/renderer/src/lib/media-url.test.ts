import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mediaUrl } from "./media-url";

const realApi = window.electronAPI;
afterEach(() => {
  window.electronAPI = realApi;
});

function withActiveWorkspace(id: string | null): void {
  window.electronAPI = {
    ...realApi,
    workspaces: { ...realApi.workspaces, activeId: () => id },
  };
}

describe("mediaUrl", () => {
  it("names the workspace the window is in, for every kind of media", () => {
    withActiveWorkspace("ws-a");
    expect(mediaUrl("recording", "clip 1")).toBe("kaipu-media://recording/clip%201?w=ws-a");
    expect(mediaUrl("screenshot", "shot")).toBe("kaipu-media://screenshot/shot?w=ws-a");
    expect(mediaUrl("thumb", "clip")).toBe("kaipu-media://thumb/clip?w=ws-a");
  });

  it("keeps the caller's own query next to the workspace", () => {
    withActiveWorkspace("ws-a");
    expect(mediaUrl("screenshot", "shot", { v: "7" })).toBe(
      "kaipu-media://screenshot/shot?v=7&w=ws-a",
    );
    withActiveWorkspace(null);
    expect(mediaUrl("screenshot", "shot", { v: "7" })).toBe("kaipu-media://screenshot/shot?v=7");
  });

  it("leaves the workspace out only when the window has none yet", () => {
    withActiveWorkspace(null);
    expect(mediaUrl("recording", "clip")).toBe("kaipu-media://recording/clip");
  });
});

describe("every renderer media URL goes through mediaUrl", () => {
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return sources(full);
      return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
    });
  }

  it("no source builds a kaipu-media:// URL by hand: it would not be tied to a workspace", () => {
    const root = join(__dirname, "..");
    const offenders = sources(root)
      .filter((file) => !file.endsWith(join("lib", "media-url.ts")))
      .filter((file) => /[`"']kaipu-media:\/\/[a-z]+\//.test(readFileSync(file, "utf-8")))
      .map((file) => relative(root, file));
    expect(offenders).toEqual([]);
  });
});
