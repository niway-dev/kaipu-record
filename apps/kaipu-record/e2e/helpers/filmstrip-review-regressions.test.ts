import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const source = (name: string) =>
  readFileSync(resolve(`verify/filmstrip-${name}.verify.ts`), "utf8");
const js = (code: string) =>
  ts.transpile(code, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS });

// Exercise the actual verifier code without launching Electron or probing fixture media.
// Source extraction keeps browser-serialized callbacks in their real scenario rather than
// adding test-only exports or helpers that Playwright cannot serialize with their closures.
const latency = source("latency");
const analysisCode = latency.slice(
  latency.indexOf("const r1 ="),
  latency.indexOf("async function visibleIds"),
);
const analyse = new Function(`${js(`const BUDGET_MS = 500; ${analysisCode}`)}; return analyse;`)();

describe("latency evidence requires visible tiles", () => {
  for (const requested of [false, true]) {
    it(`rejects empty tiles with request=${requested}`, () => {
      const events = [
        { k: "mark", label: "test", t: 0, own: {} },
        ...(requested ? [{ k: "post", type: "request", requestId: 1, t: 120 }] : []),
      ];
      const row = analyse(events, "test", 0, []);
      expect(row.tiles).toBe(0);
      expect(row.allOwnAtMs).toBeNull();
    });
  }
  it("rejects a zero-tile row even if an analysis regression reports zero latency", () => {
    const assertions = latency.slice(
      latency.indexOf("    for (const row of rows) {"),
      latency.indexOf("  } catch (error)", latency.indexOf("    for (const row of rows) {")),
    );
    const check = new Function("rows", "expect", `${js(`const BUDGET_MS = 500; ${assertions}`)}`);
    expect(() => check([{ label: "empty", tiles: 0, allOwnAtMs: 0 }], expect)).toThrow();
  });
  it("retains valid cached-tile timing", () => {
    expect(
      analyse([{ k: "mark", label: "test", t: 0, own: { 1: "true" } }], "test", 0, [1]).allOwnAtMs,
    ).toBe(0);
  });
});

it("counts an undecoded replacement of a previously decoded logical tile", () => {
  const editor = source("editor");
  const code = editor.slice(
    editor.indexOf("const had ="),
    editor.indexOf("            requestAnimationFrame(sample);"),
  );
  let images = [
    { complete: true, naturalWidth: 72, getAttribute: () => "10,11", closest: () => null },
  ];
  const root = { querySelectorAll: () => images };
  const run = new Function(
    "root",
    "MutationObserver",
    "requestAnimationFrame",
    "replace",
    `${js(code)}; sample(); replace(); sample(); return blankTileSamples;`,
  );
  class Observer {
    observe() {}
  }
  expect(
    run(
      root,
      Observer,
      () => {},
      () => {
        images = [
          { complete: false, naturalWidth: 0, getAttribute: () => "10,11", closest: () => null },
        ];
      },
    ),
  ).toBe(1);
});

for (const name of ["editor", "latency", "lifecycle", "performance"]) {
  it(`${name}: finishes after report write failure${name === "lifecycle" ? " and removes workspace even if finish fails" : ""}`, async () => {
    const text = source(name);
    const cleanup = text.slice(
      text.lastIndexOf("\n  } finally {") + "\n  } finally {".length,
      text.lastIndexOf("\n  }\n});"),
    );
    const run = new Function(
      "writeFile",
      "s",
      "rm",
      "path",
      "OUT",
      "SIDE",
      "LABEL",
      "NAME",
      "result",
      "createdPath",
      `return (async () => { ${js(cleanup)} })();`,
    );
    const write = vi.fn().mockRejectedValue(new Error("disk full"));
    const finish = vi.fn().mockResolvedValue(undefined);
    const rm = vi.fn().mockResolvedValue(undefined);
    await expect(
      run(
        write,
        { finish },
        rm,
        { join: () => "report" },
        "out",
        "on",
        "test",
        "test",
        {},
        "workspace",
      ),
    ).rejects.toThrow("disk full");
    expect(finish).toHaveBeenCalledOnce();
    if (name === "lifecycle") {
      expect(rm).toHaveBeenCalledWith("workspace", { recursive: true, force: true });
      finish.mockRejectedValueOnce(new Error("close failed"));
      await expect(
        run(
          write,
          { finish },
          rm,
          { join: () => "report" },
          "out",
          "on",
          "test",
          "test",
          {},
          "workspace",
        ),
      ).rejects.toThrow("close failed");
      expect(rm).toHaveBeenCalledTimes(2);
    }
  });
}
