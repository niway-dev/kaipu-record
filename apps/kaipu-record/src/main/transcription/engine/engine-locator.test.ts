import { afterEach, describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  engineDir,
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

/** A packaged-style tree under `resources/app.asar.unpacked` with scripted stand-in binaries. */
async function fakeEngine(options: {
  versionScript?: string | null;
  cliScript?: string | null;
}): Promise<string> {
  const resourcesPath = await mkdtemp(join(tmpdir(), "kaipu-engine-locator-"));
  directories.push(resourcesPath);
  const bin = join(resourcesPath, "app.asar.unpacked", "resources", "native", "sherpa-onnx", "bin");
  await mkdir(bin, { recursive: true });
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
  return resourcesPath;
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
      expect(await locateEngine({ resourcesPath: "/Res", ...target, existsSync })).toEqual({
        available: false,
        reason: "unsupported-platform",
      });
    }
  });

  it("reports binary-missing when the CLI or the version tool is absent", async () => {
    expect(await locateEngine({ resourcesPath: "/nowhere", ...arm })).toEqual({
      available: false,
      reason: "binary-missing",
    });
    const noVersionTool = await fakeEngine({ versionScript: null });
    expect(await locateEngine({ resourcesPath: noVersionTool, ...arm })).toEqual({
      available: false,
      reason: "binary-missing",
    });
    const noCli = await fakeEngine({ cliScript: null });
    expect(await locateEngine({ resourcesPath: noCli, ...arm })).toEqual({
      available: false,
      reason: "binary-missing",
    });
  });

  it("returns the CLI path, lib dir and version when the handshake passes", async () => {
    const resourcesPath = await fakeEngine({});
    const root = join(resourcesPath, "app.asar.unpacked", "resources", "native", "sherpa-onnx");
    expect(await locateEngine({ resourcesPath, ...arm })).toEqual({
      available: true,
      cliPath: join(root, "bin", "sherpa-onnx-offline"),
      libDir: join(root, "lib"),
      version: PINNED_ENGINE_VERSION,
    });
  });

  it("prefers the dev tree under the app path over asar.unpacked", async () => {
    const appPath = await mkdtemp(join(tmpdir(), "kaipu-engine-app-"));
    directories.push(appPath);
    const dev = join(appPath, "resources", "native", "sherpa-onnx");
    await mkdir(join(dev, "bin"), { recursive: true });
    await writeFile(join(dev, "bin", "sherpa-onnx-offline"), "");
    expect(engineDir("/Res", appPath)).toBe(dev);
    expect(engineDir("/Res", "/nowhere/app")).toBe(
      join("/Res", "app.asar.unpacked", "resources", "native", "sherpa-onnx"),
    );
    expect(engineDir("/Res", undefined)).toBe(
      join("/Res", "app.asar.unpacked", "resources", "native", "sherpa-onnx"),
    );
  });

  it("fails the handshake on another release", async () => {
    const resourcesPath = await fakeEngine({
      versionScript: 'echo "sherpa-onnx version : 0.0.1"',
    });
    expect(await locateEngine({ resourcesPath, ...arm })).toEqual({
      available: false,
      reason: "handshake-failed",
    });
  });

  it("fails the handshake when the version tool exits non-zero or prints nothing useful", async () => {
    for (const versionScript of ['echo "sherpa-onnx version : 1.13.8"; exit 1', "echo hello"]) {
      const resourcesPath = await fakeEngine({ versionScript });
      expect(await locateEngine({ resourcesPath, ...arm })).toEqual({
        available: false,
        reason: "handshake-failed",
      });
    }
  });

  it("fails the handshake when the CLI itself does not start", async () => {
    const resourcesPath = await fakeEngine({ cliScript: "exit 9" });
    expect(await locateEngine({ resourcesPath, ...arm })).toEqual({
      available: false,
      reason: "handshake-failed",
    });
  });

  it("fails the handshake, and kills the probe, when a binary hangs", async () => {
    const resourcesPath = await fakeEngine({ versionScript: "exec sleep 30" });
    const started = Date.now();
    expect(await locateEngine({ resourcesPath, ...arm, handshakeTimeoutMs: 200 })).toEqual({
      available: false,
      reason: "handshake-failed",
    });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("fails the handshake when spawning throws", async () => {
    const resourcesPath = await fakeEngine({});
    const spawn = (() => {
      throw new Error("EACCES");
    }) as never;
    expect(await locateEngine({ resourcesPath, ...arm, spawn })).toEqual({
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
  it("matches scripts/speech-engine.lock", async () => {
    const lock = await readFile(join(__dirname, "../../../../scripts/speech-engine.lock"), "utf8");
    const version = /^SHERPA_VERSION=(.+)$/m.exec(lock)?.[1];
    expect(version).toBe(`v${PINNED_ENGINE_VERSION}`);
  });
});

const devTree = join(__dirname, "../../../..");
const fetched =
  process.platform === "darwin" &&
  process.arch === "arm64" &&
  existsSync(join(devTree, "resources", "native", "sherpa-onnx", "bin", "sherpa-onnx-offline"));

describe("the real engine from the fetch script", () => {
  it.skipIf(!fetched)("passes the handshake", async () => {
    const found = await locateEngine({ resourcesPath: "/nowhere", appPath: devTree });
    expect(found).toMatchObject({ available: true, version: PINNED_ENGINE_VERSION });
  });
});
