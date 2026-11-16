import { afterEach, expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const hook = require("../../../../scripts/after-pack.cjs") as {
  carriesSpeechEngine: (platform: string, arch: number) => boolean;
  removeSpeechEngineUnlessSupported: (options: {
    electronPlatformName: string;
    arch: number;
    resourcesDir: string;
  }) => Promise<boolean>;
};

// builder-util's Arch enum values (arm64 = 3, x64 = 1), as in scripts/after-pack.cjs.
const ARM64 = 3;
const X64 = 1;

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function packagedResources(): Promise<{ resourcesDir: string; engineDir: string }> {
  const resourcesDir = await mkdtemp(join(tmpdir(), "kaipu-after-pack-"));
  directories.push(resourcesDir);
  const native = join(resourcesDir, "app.asar.unpacked", "resources", "native");
  await mkdir(join(native, "sherpa-onnx", "bin"), { recursive: true });
  await writeFile(join(native, "sherpa-onnx", "bin", "sherpa-onnx-offline"), "");
  await writeFile(join(native, "kaipu-encoded-capture"), "");
  return { resourcesDir, engineDir: join(native, "sherpa-onnx") };
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

it("only the macOS arm64 app carries the engine", () => {
  expect(hook.carriesSpeechEngine("darwin", ARM64)).toBe(true);
  expect(hook.carriesSpeechEngine("darwin", X64)).toBe(false);
  expect(hook.carriesSpeechEngine("win32", ARM64)).toBe(false);
  expect(hook.carriesSpeechEngine("linux", X64)).toBe(false);
});

it("keeps the engine in the arm64 app", async () => {
  const { resourcesDir, engineDir } = await packagedResources();
  expect(
    await hook.removeSpeechEngineUnlessSupported({
      electronPlatformName: "darwin",
      arch: ARM64,
      resourcesDir,
    }),
  ).toBe(false);
  expect(await exists(engineDir)).toBe(true);
});

it("removes only the engine from the x64 app", async () => {
  const { resourcesDir, engineDir } = await packagedResources();
  expect(
    await hook.removeSpeechEngineUnlessSupported({
      electronPlatformName: "darwin",
      arch: X64,
      resourcesDir,
    }),
  ).toBe(true);
  expect(await exists(engineDir)).toBe(false);
  expect(
    await exists(
      join(resourcesDir, "app.asar.unpacked", "resources", "native", "kaipu-encoded-capture"),
    ),
  ).toBe(true);
});

it("does not fail when the engine was never fetched", async () => {
  const resourcesDir = await mkdtemp(join(tmpdir(), "kaipu-after-pack-"));
  directories.push(resourcesDir);
  await hook.removeSpeechEngineUnlessSupported({
    electronPlatformName: "darwin",
    arch: X64,
    resourcesDir,
  });
});
