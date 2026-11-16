import { afterEach, describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ENGINE_ARCHIVE, ENGINE_LIBRARIES } from "./engine-catalog";
import {
  inspectEngineDir,
  locateEngine,
  parseEngineVersion,
  PINNED_ENGINE_VERSION,
} from "./engine-locator";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

/** An install-style tree (`bin/` and `lib/`) with scripted stand-in binaries; returns its root. */
async function fakeEngine(options: {
  versionScript?: string | null;
  cliScript?: string | null;
  skipLibrary?: string;
}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kaipu-engine-locator-"));
  directories.push(dir);
  const bin = join(dir, "bin");
  await mkdir(bin, { recursive: true });
  await mkdir(join(dir, "lib"), { recursive: true });
  for (const library of ENGINE_LIBRARIES) {
    if (library !== options.skipLibrary) await writeFile(join(dir, library), "");
  }
  const write = async (name: string, script: string | null | undefined, fallback: string) => {
    if (script === null) return;
    await writeFile(join(bin, name), `#!/bin/sh\n${script ?? fallback}\n`);
    await chmod(join(bin, name), 0o755);
  };
  await write(
    "sherpa-onnx-version",
    options.versionScript,
    `echo "sherpa-onnx version : ${PINNED_ENGINE_VERSION}"`,
  );
  await write("sherpa-onnx-offline", options.cliScript, "echo usage >&2");
  return dir;
}

/** Whether a process still exists. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const arm = { platform: "darwin", arch: "arm64" } as const;

describe("locateEngine", () => {
  it("is unsupported anywhere but macOS arm64, without looking at the disk", async () => {
    const existsSync = () => {
      throw new Error("must not touch the disk");
    };
    for (const target of [
      { platform: "win32", arch: "x64" },
      { platform: "linux", arch: "arm64" },
      { platform: "darwin", arch: "x64" },
    ] as const) {
      expect(await locateEngine({ engineDir: "/Res", ...target, existsSync })).toEqual({
        available: false,
        reason: "unsupported-platform",
      });
    }
  });

  it("reports binary-missing when the CLI or the version tool is absent", async () => {
    expect(await locateEngine({ engineDir: "/nowhere", ...arm })).toEqual({
      available: false,
      reason: "binary-missing",
    });
    const noVersionTool = await fakeEngine({ versionScript: null });
    expect(await locateEngine({ engineDir: noVersionTool, ...arm })).toEqual({
      available: false,
      reason: "binary-missing",
    });
    const noCli = await fakeEngine({ cliScript: null });
    expect(await locateEngine({ engineDir: noCli, ...arm })).toEqual({
      available: false,
      reason: "binary-missing",
    });
  });

  it("returns the CLI path, lib dir and version when the handshake passes", async () => {
    const engineDir = await fakeEngine({});
    expect(await locateEngine({ engineDir, ...arm })).toEqual({
      available: true,
      cliPath: join(engineDir, "bin", "sherpa-onnx-offline"),
      libDir: join(engineDir, "lib"),
      version: PINNED_ENGINE_VERSION,
    });
  });

  it("reports binary-missing when a library is absent, so a damaged install can be redone", async () => {
    const engineDir = await fakeEngine({ skipLibrary: "lib/libonnxruntime.dylib" });
    expect(await locateEngine({ engineDir, ...arm })).toEqual({
      available: false,
      reason: "binary-missing",
    });
  });

  it("fails the handshake on another release", async () => {
    const engineDir = await fakeEngine({
      versionScript: 'echo "sherpa-onnx version : 0.0.1"',
    });
    expect(await locateEngine({ engineDir, ...arm })).toEqual({
      available: false,
      reason: "handshake-failed",
    });
  });

  it("fails the handshake when the version tool exits non-zero or prints nothing useful", async () => {
    for (const versionScript of [
      `echo "sherpa-onnx version : ${PINNED_ENGINE_VERSION}"; exit 1`,
      "echo hello",
    ]) {
      const engineDir = await fakeEngine({ versionScript });
      expect(await locateEngine({ engineDir, ...arm })).toEqual({
        available: false,
        reason: "handshake-failed",
      });
    }
  });

  it("fails the handshake when the CLI itself does not start", async () => {
    const engineDir = await fakeEngine({ cliScript: "exit 9" });
    expect(await locateEngine({ engineDir, ...arm })).toEqual({
      available: false,
      reason: "handshake-failed",
    });
  });

  it("fails the handshake, and kills the probe, when a binary hangs", async () => {
    const pidFile = join(await mkdtemp(join(tmpdir(), "kaipu-engine-pid-")), "pid");
    directories.push(dirname(pidFile));
    const engineDir = await fakeEngine({
      versionScript: `echo $$ > "${pidFile}"\nexec sleep 30`,
    });
    const started = Date.now();
    expect(await locateEngine({ engineDir, ...arm, handshakeTimeoutMs: 1500 })).toEqual({
      available: false,
      reason: "handshake-failed",
    });
    expect(Date.now() - started).toBeLessThan(10_000);
    const pid = Number((await readFile(pidFile, "utf8")).trim());
    expect(pid).toBeGreaterThan(0);
    // The kill is a signal; give the OS a moment to reap the child before checking.
    for (let i = 0; i < 50 && alive(pid); i++) await new Promise((r) => setTimeout(r, 20));
    expect(alive(pid)).toBe(false);
  });

  it("fails the handshake when spawning throws", async () => {
    const engineDir = await fakeEngine({});
    const spawn = (() => {
      throw new Error("EACCES");
    }) as never;
    expect(await locateEngine({ engineDir, ...arm, spawn })).toEqual({
      available: false,
      reason: "handshake-failed",
    });
  });
});

describe("parseEngineVersion", () => {
  it("reads the real sherpa-onnx-version output", () => {
    const output =
      "sherpa-onnx version : 1.13.8\nsherpa-onnx Git SHA1: 11afbd00\nonnxruntime version : 1.28.2\n";
    expect(parseEngineVersion(output)).toBe("1.13.8");
    expect(parseEngineVersion("nothing here")).toBeUndefined();
  });
});

describe("the pinned release", () => {
  it("names the archive, URL and top directory after the pinned version", () => {
    expect(ENGINE_ARCHIVE.url).toContain(`/download/v${ENGINE_ARCHIVE.version}/`);
    expect(ENGINE_ARCHIVE.url.endsWith(`/${ENGINE_ARCHIVE.archiveName}`)).toBe(true);
    expect(ENGINE_ARCHIVE.archiveName).toBe(`${ENGINE_ARCHIVE.topDir}.tar.bz2`);
    expect(ENGINE_ARCHIVE.topDir).toContain(`v${ENGINE_ARCHIVE.version}-`);
    expect(ENGINE_ARCHIVE.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(ENGINE_ARCHIVE.url.startsWith("https://")).toBe(true);
  });
});

describe("inspectEngineDir", () => {
  it("runs the handshake without a platform check", async () => {
    const engineDir = await fakeEngine({});
    expect(await inspectEngineDir(engineDir)).toMatchObject({
      available: true,
      version: PINNED_ENGINE_VERSION,
    });
  });
});

/** An engine unpacked by hand: KAIPU_SPEECH_ENGINE_DIR is the root holding `bin/` and `lib/`. */
const handmadeEngineDir = process.env.KAIPU_SPEECH_ENGINE_DIR;

describe("a real engine directory", () => {
  it.skipIf(!handmadeEngineDir)("passes the handshake", async () => {
    expect(await inspectEngineDir(handmadeEngineDir!)).toMatchObject({
      available: true,
      version: PINNED_ENGINE_VERSION,
    });
  });
});
