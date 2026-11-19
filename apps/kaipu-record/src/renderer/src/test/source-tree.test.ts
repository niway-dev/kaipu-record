import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { dirnameOf, relativeId } from "./source-tree";

describe("source-tree helpers for the tests that scan the renderer source", () => {
  it("dirnameOf turns a file URL into a filesystem path, spaces included", () => {
    // A checkout under a folder with a space: its `import.meta.url` carries `%20`.
    const file = path.join(os.tmpdir(), "Kaipu Work", "features", "settings", "x.test.ts");
    const url = pathToFileURL(file).href;
    expect(url).toContain("%20");

    expect(dirnameOf(url)).toBe(path.dirname(file));
  });

  it("relativeId names a file with forward slashes whatever the platform separator is", () => {
    const root = path.join(os.tmpdir(), "renderer");

    expect(relativeId(root, path.join(root, "app", "i18n-root.tsx"))).toBe("app/i18n-root.tsx");
    expect(relativeId(root, path.join(root, "a", "b", "c.ts"))).toBe("a/b/c.ts");
  });
});
