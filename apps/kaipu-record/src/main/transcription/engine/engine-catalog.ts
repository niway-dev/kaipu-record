/**
 * The speech engine the app downloads (ADR 0062, amendment 2026-11-16): one pinned sherpa-onnx
 * archive for macOS arm64. The version, size and SHA-256 fix the exact bytes; serving the archive
 * from another host later changes `url` only. A bump is a deliberate change here, and
 * `PINNED_ENGINE_VERSION` follows it.
 */

export interface EngineArchive {
  /** The sherpa-onnx release, without the leading `v`. */
  version: string;
  /** The file name of the archive; also the name the download is written under. */
  archiveName: string;
  url: string;
  sizeBytes: number;
  /** Lowercase hex SHA-256 of the archive. */
  sha256: string;
  /** The single directory the archive extracts into. */
  topDir: string;
}

const VERSION = "1.13.8";
const TOP_DIR = `sherpa-onnx-v${VERSION}-osx-arm64-shared-no-tts`;

export const ENGINE_ARCHIVE: EngineArchive = {
  version: VERSION,
  archiveName: `${TOP_DIR}.tar.bz2`,
  url: `https://github.com/k2-fsa/sherpa-onnx/releases/download/v${VERSION}/${TOP_DIR}.tar.bz2`,
  sizeBytes: 18_252_168,
  sha256: "91b96512c4fa1960f8a9ed5360a6c8dda53a4b5015d0590244f14086a234557a",
  topDir: TOP_DIR,
};

/** Kept from the archive, relative to the install directory. Everything else is dropped. */
export const ENGINE_BINARIES = ["bin/sherpa-onnx-offline", "bin/sherpa-onnx-version"] as const;
export const ENGINE_LIBRARIES = [
  "lib/libonnxruntime.dylib",
  "lib/libsherpa-onnx-c-api.dylib",
  "lib/libsherpa-onnx-cxx-api.dylib",
] as const;
export const ENGINE_FILES = [...ENGINE_BINARIES, ...ENGINE_LIBRARIES] as const;
