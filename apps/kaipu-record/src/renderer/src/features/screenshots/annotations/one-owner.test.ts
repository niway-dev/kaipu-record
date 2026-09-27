import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The invariant, enforced rather than written down: NO consumer computes text geometry.
 *
 * Seven places had independently turned a `size` index into a font size and drifted from
 * the renderer — the export rasterizers, both preview renderers, the hit test, the handle
 * box, and both inline editors. Each was found one at a time, by a user hitting it. The
 * count in the docs said five when it was seven, because counting copies by hand is the
 * method that fails here.
 *
 * Reading `TEXT_PX[...]` outside the module that owns it IS the bug, in every case: the
 * preset table cannot know about `fontPx`, so anything indexing it directly is measuring
 * a label the user may not be looking at.
 *
 * This is source inspection, normally a junk pattern. It is kept because no behavioural
 * test catches "someone wrote an eighth copy", and the failure it guards has now shipped
 * seven times.
 */
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "../..");

/** Where the presets legitimately live: the module that owns them. */
const OWNER = path.join(ROOT, "screenshots/annotations/tools.ts");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("text geometry has one owner", () => {
  it("nothing outside tools.ts indexes the preset table", () => {
    const offenders = sourceFiles(ROOT)
      .filter((file) => file !== OWNER)
      .filter((file) => {
        const code = readFileSync(file, "utf8")
          // Comments may name it while explaining exactly this rule.
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/\/\/.*$/gm, "");
        return /TEXT_PX\s*\[/.test(code);
      })
      .map((file) => path.relative(ROOT, file));

    expect(offenders).toEqual([]);
  });
});
