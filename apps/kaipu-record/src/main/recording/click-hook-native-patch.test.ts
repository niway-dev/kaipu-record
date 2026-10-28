/**
 * Pins the native fix for the `uIOhook.start()` deadlock.
 *
 * uiohook-napi 1.5.5 ships a startup handshake in `src/lib/uiohook_worker.c` that
 * can deadlock the calling thread — Electron's main thread — forever: `hook_enable()`
 * waits on a condition variable without a predicate loop, reads a spurious wake-up as
 * a startup failure, and joins the hook thread while holding the two mutexes that
 * thread needs to finish `EVENT_HOOK_ENABLED`. The whole app freezes at "start
 * recording" and only `kill -9` ends it. Upstream fix, unmerged as of 2026-10-28:
 * https://github.com/SnosMe/uiohook-napi/pull/66 — applied here as a bun patch.
 *
 * This test fails when the patch is dropped, or when a version bump of
 * `uiohook-napi` leaves the patch behind without re-checking that the fix landed
 * upstream. The deadlock itself is a thread race that no unit test can trigger on
 * demand; the recorded `sample` of a hung process stands in as the repro.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../../..");
const appDir = resolve(here, "../../..");

function installedUiohookVersion(): string {
  const pkg = JSON.parse(
    readFileSync(resolve(appDir, "node_modules/uiohook-napi/package.json"), "utf8"),
  ) as { version: string };
  return pkg.version;
}

describe("uiohook-napi native patch", () => {
  const version = installedUiohookVersion();
  const rootPkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")) as {
    patchedDependencies?: Record<string, string>;
  };

  it("is declared for the installed version", () => {
    expect(rootPkg.patchedDependencies?.[`uiohook-napi@${version}`]).toBe(
      `patches/uiohook-napi@${version}.patch`,
    );
  });

  it("is a patch of uiohook_worker.c", () => {
    const patchPath = resolve(repoRoot, `patches/uiohook-napi@${version}.patch`);
    expect(existsSync(patchPath)).toBe(true);
    expect(readFileSync(patchPath, "utf8")).toContain("src/lib/uiohook_worker.c");
  });

  it("replaces the mutex-as-flag handshake in the installed native sources", () => {
    const worker = readFileSync(
      resolve(appDir, "node_modules/uiohook-napi/src/lib/uiohook_worker.c"),
      "utf8",
    );
    const code = worker
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => !line.startsWith("//") && !line.startsWith("*"));
    // The fix: an explicit start state, waited on in a predicate loop, so a spurious
    // wake-up goes back to waiting instead of being read as a startup failure.
    expect(code).toContain("while (hook_state == HOOK_START_PENDING) {");
    // The old flag mutex is gone from the code (comments may still name it): nothing
    // may trylock it as a "started" signal, nothing may join while holding it.
    expect(code.some((line) => line.includes("hook_running_mutex"))).toBe(false);
  });
});
