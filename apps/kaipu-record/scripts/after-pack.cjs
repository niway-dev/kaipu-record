/**
 * electron-builder `afterPack` hook (electron-builder.yml). Runs once per app, after packing and
 * before signing.
 *
 * It keeps the speech engine (ADR 0062) out of every app that cannot run it. The engine is the
 * macOS arm64 build of sherpa-onnx, fetched into `resources/native/sherpa-onnx` by
 * scripts/fetch-speech-engine.sh. `asarUnpack: resources/**` ships that directory in every
 * package, and the release builds the arm64 and x64 Mac apps in one electron-builder run, so
 * without this the x64 app (and a Windows or Linux package built on an arm64 Mac) would carry
 * about 30 MB of arm64 code it can never load. Those apps report the engine as "unavailable".
 */
const { rm } = require("node:fs/promises");
const { join } = require("node:path");

// builder-util's `Arch` enum: ia32 = 0, x64 = 1, armv7l = 2, arm64 = 3, universal = 4.
const ARCH_ARM64 = 3;

/** True when this package may carry the arm64 macOS engine. */
function carriesSpeechEngine(electronPlatformName, arch) {
  return electronPlatformName === "darwin" && arch === ARCH_ARM64;
}

async function removeSpeechEngineUnlessSupported({ electronPlatformName, arch, resourcesDir }) {
  if (carriesSpeechEngine(electronPlatformName, arch)) return false;
  await rm(join(resourcesDir, "app.asar.unpacked", "resources", "native", "sherpa-onnx"), {
    recursive: true,
    force: true,
  });
  return true;
}

exports.default = async function afterPack(context) {
  await removeSpeechEngineUnlessSupported({
    electronPlatformName: context.electronPlatformName,
    arch: context.arch,
    resourcesDir: context.packager.getResourcesDir(context.appOutDir),
  });
};
exports.carriesSpeechEngine = carriesSpeechEngine;
exports.removeSpeechEngineUnlessSupported = removeSpeechEngineUnlessSupported;
