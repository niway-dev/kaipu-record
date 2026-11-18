import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DownloadError } from "../download-file";
import { ENGINE_FILES, type EngineArchive } from "./engine-catalog";
import { EngineStore, extractWithTar, type EngineStoreOptions } from "./engine-store";

const sha = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("EngineStore", () => {
  let server: Server;
  let baseUrl: string;
  let body: Buffer;
  /** Pause after the first half of the body until this resolves. */
  let hold: Promise<void> | undefined;
  let requests: number;
  let root: string;

  beforeEach(async () => {
    body = Buffer.alloc(9000, 7);
    hold = undefined;
    requests = 0;
    server = createServer((_req, res) => {
      requests += 1;
      res.writeHead(200, { "content-length": body.length });
      const half = Math.floor(body.length / 2);
      res.write(body.subarray(0, half));
      void (hold ?? Promise.resolve()).then(() => res.end(body.subarray(half)));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    root = await mkdtemp(join(tmpdir(), "engine-store-"));
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  });

  const archive = (overrides: Partial<EngineArchive> = {}): EngineArchive => ({
    version: "9.9.9",
    archiveName: "engine.tar.bz2",
    url: `${baseUrl}/engine.tar.bz2`,
    sizeBytes: body.length,
    sha256: sha(body),
    topDir: "engine-top",
    ...overrides,
  });

  /** What `tar` would leave behind: the top directory with the five files plus noise to drop. */
  async function writeExtracted(dest: string, topDir = "engine-top"): Promise<void> {
    for (const file of [
      ...ENGINE_FILES,
      "bin/sherpa-onnx-offline-websocket-server",
      "lib/extra.a",
    ]) {
      await mkdir(join(dest, topDir, file, ".."), { recursive: true });
      await writeFile(join(dest, topDir, file), `content of ${file}`);
    }
  }

  function makeStore(extra: Partial<EngineStoreOptions> = {}) {
    const extract = vi.fn(async (_archivePath: string, dest: string) => writeExtracted(dest));
    const handshake = vi.fn(async (_dir: string) => true);
    const store = new EngineStore({
      rootDir: join(root, "speech-engine"),
      archive: archive(),
      allowInsecureHttpForTests: true,
      extract,
      handshake,
      ...extra,
    });
    return { store, extract, handshake };
  }

  const finalDir = () => join(root, "speech-engine", "9.9.9");
  const rootEntries = async () =>
    (await readdir(join(root, "speech-engine")).catch(() => [])).sort();

  it("downloads, extracts, keeps only the five files and renames into place", async () => {
    const { store, extract, handshake } = makeStore();
    expect(store.installDir).toBe(finalDir());
    expect(store.locate()).toBeNull();
    const received: number[] = [];

    const dir = await store.install({ onBytes: (n) => received.push(n) });

    expect(dir).toBe(finalDir());
    expect(store.locate()).toBe(finalDir());
    expect(received.reduce((a, b) => a + b, 0)).toBe(body.length);
    expect(extract).toHaveBeenCalledTimes(1);
    expect((await readdir(join(finalDir(), "bin"))).sort()).toEqual([
      "sherpa-onnx-offline",
      "sherpa-onnx-version",
    ]);
    expect((await readdir(join(finalDir(), "lib"))).sort()).toEqual([
      "libonnxruntime.dylib",
      "libsherpa-onnx-c-api.dylib",
      "libsherpa-onnx-cxx-api.dylib",
    ]);
    expect(await readFile(join(finalDir(), "bin", "sherpa-onnx-offline"), "utf8")).toBe(
      "content of bin/sherpa-onnx-offline",
    );
    expect(statSync(join(finalDir(), "bin", "sherpa-onnx-offline")).mode & 0o111).toBe(0o111);
    expect(statSync(join(finalDir(), "bin", "sherpa-onnx-version")).mode & 0o111).toBe(0o111);
    // The handshake ran on the staged copy, not on the final path.
    expect(handshake).toHaveBeenCalledTimes(1);
    expect(handshake.mock.calls[0]![0]).not.toBe(finalDir());
    expect(handshake.mock.calls[0]![0]).toContain(".partial");
    expect(await rootEntries()).toEqual(["9.9.9"]);
  });

  it("extracts the verified archive with the injected extractor, never before verification", async () => {
    const { store, extract } = makeStore();
    await store.install({});
    const [archivePath, dest] = extract.mock.calls[0]!;
    expect(archivePath).toContain(".partial");
    expect(archivePath.endsWith("engine.tar.bz2")).toBe(true);
    expect(dest).toContain(".partial");
  });

  it("rejects a hash mismatch, removes the partial and never extracts", async () => {
    const { store, extract } = makeStore({ archive: archive({ sha256: "0".repeat(64) }) });
    await expect(store.install({})).rejects.toMatchObject({ code: "hash-mismatch" });
    expect(extract).not.toHaveBeenCalled();
    expect(existsSync(finalDir())).toBe(false);
    expect(await rootEntries()).toEqual([]);
    expect(store.locate()).toBeNull();
  });

  it("rejects a size mismatch (declared and real), and never extracts", async () => {
    for (const sizeBytes of [body.length + 10, body.length - 10]) {
      const { store, extract } = makeStore({ archive: archive({ sizeBytes }) });
      await expect(store.install({})).rejects.toMatchObject({ code: "size-mismatch" });
      expect(extract).not.toHaveBeenCalled();
      expect(await rootEntries()).toEqual([]);
    }
  });

  it("refuses a non-https URL without touching the network", async () => {
    const { store } = makeStore({
      archive: archive({ url: "http://example.test/engine.tar.bz2" }),
    });
    await expect(store.install({})).rejects.toMatchObject({ code: "network" });
    expect(requests).toBe(0);
    const strict = makeStore({ allowInsecureHttpForTests: false });
    await expect(strict.store.install({})).rejects.toMatchObject({ code: "network" });
    expect(requests).toBe(0);
  });

  it("fails with insufficient-disk-space before downloading", async () => {
    const { store } = makeStore({
      statfsImpl: async () => ({ bavail: 1, bsize: 1 }),
    });
    await expect(store.install({})).rejects.toMatchObject({ code: "insufficient-disk-space" });
    expect(requests).toBe(0);
    expect(await rootEntries()).toEqual([]);
  });

  it("cancels mid-download and removes the partial", async () => {
    hold = new Promise(() => {});
    const { store, extract } = makeStore();
    const controller = new AbortController();
    const started = deferred();
    const pending = store.install({
      signal: controller.signal,
      onBytes: () => started.resolve(),
    });
    pending.catch(() => {});
    await started.promise;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    expect(extract).not.toHaveBeenCalled();
    expect(await rootEntries()).toEqual([]);
  });

  it("rejects at once with cancelled when the signal is already aborted", async () => {
    const { store } = makeStore();
    const controller = new AbortController();
    controller.abort();
    await expect(store.install({ signal: controller.signal })).rejects.toMatchObject({
      code: "cancelled",
    });
    expect(requests).toBe(0);
  });

  it("cancels during extraction by aborting the extractor's signal", async () => {
    const controller = new AbortController();
    const { store } = makeStore({
      extract: (_archive, _dest, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("tar killed")));
          controller.abort();
        }),
    });
    await expect(store.install({ signal: controller.signal })).rejects.toMatchObject({
      code: "cancelled",
    });
    expect(await rootEntries()).toEqual([]);
  });

  it("maps an extractor failure to engine-failed-to-start and leaves nothing behind", async () => {
    const { store, handshake } = makeStore({
      extract: async () => {
        throw new Error("tar exited with 1");
      },
    });
    const error = await store.install({}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DownloadError);
    expect(error).toMatchObject({ code: "engine-failed-to-start" });
    expect(handshake).not.toHaveBeenCalled();
    expect(await rootEntries()).toEqual([]);
  });

  it("fails with engine-failed-to-start when the archive lacks one of the five files", async () => {
    const { store, handshake } = makeStore({
      extract: async (_archive, dest) => {
        await writeExtracted(dest);
        await rm(join(dest, "engine-top", "lib", "libonnxruntime.dylib"));
      },
    });
    await expect(store.install({})).rejects.toMatchObject({ code: "engine-failed-to-start" });
    expect(handshake).not.toHaveBeenCalled();
    expect(await rootEntries()).toEqual([]);
  });

  it("refuses a symlink where one of the five files should be", async () => {
    const { store } = makeStore({
      extract: async (_archive, dest) => {
        await writeExtracted(dest);
        const target = join(dest, "engine-top", "lib", "libonnxruntime.dylib");
        await rm(target);
        await symlink("/etc/hosts", target);
      },
    });
    await expect(store.install({})).rejects.toMatchObject({ code: "engine-failed-to-start" });
    expect(await rootEntries()).toEqual([]);
  });

  it("reports cancelled, not engine-failed-to-start, when the user cancels during the handshake", async () => {
    const controller = new AbortController();
    const { store } = makeStore({
      // The version probe is not abortable: it returns "unavailable" after the cancel.
      handshake: async () => {
        controller.abort();
        return false;
      },
    });
    await expect(store.install({ signal: controller.signal })).rejects.toMatchObject({
      code: "cancelled",
    });
    expect(await rootEntries()).toEqual([]);
  });

  it("fails with engine-failed-to-start when the handshake fails, leaving the final path untouched", async () => {
    await mkdir(join(finalDir(), "bin"), { recursive: true });
    await writeFile(join(finalDir(), "bin", "older"), "x");
    const { store } = makeStore({ handshake: async () => false });
    await expect(store.install({})).rejects.toMatchObject({ code: "engine-failed-to-start" });
    expect(await rootEntries()).toEqual(["9.9.9"]);
    expect(existsSync(join(finalDir(), "bin", "older"))).toBe(true);
    expect(store.locate()).toBeNull();
  });

  it("replaces an incomplete or older install at the final path", async () => {
    await mkdir(join(finalDir(), "bin"), { recursive: true });
    await writeFile(join(finalDir(), "bin", "stale"), "x");
    const { store } = makeStore();
    expect(store.locate()).toBeNull();
    await store.install({});
    expect(store.locate()).toBe(finalDir());
    expect(existsSync(join(finalDir(), "bin", "stale"))).toBe(false);
  });

  it("deletes stale .partial directories when it is constructed", async () => {
    await mkdir(join(root, "speech-engine", "9.9.9.partial", "x"), { recursive: true });
    await mkdir(join(root, "speech-engine", "1.0.0"), { recursive: true });
    makeStore();
    expect(await rootEntries()).toEqual(["1.0.0"]);
  });

  it("does not throw at construction when a stale directory cannot be deleted", async () => {
    const rootDir = join(root, "speech-engine");
    await mkdir(join(rootDir, "9.9.9.partial"), { recursive: true });
    await chmod(rootDir, 0o555);
    try {
      expect(() => makeStore()).not.toThrow();
    } finally {
      await chmod(rootDir, 0o755);
    }
  });

  /** An extractor that leaves its tree undeletable, so the cleanup after the install fails. */
  const undeletableExtract = (then?: () => never) => async (_archive: string, dest: string) => {
    await writeExtracted(dest);
    await chmod(dest, 0o555);
    then?.();
  };
  const restoreExtracted = async () => {
    const partial = join(root, "speech-engine", "9.9.9.partial", "extracted");
    await chmod(partial, 0o755).catch(() => {});
  };

  it("reports an installed engine as installed when the cleanup afterwards fails", async () => {
    const { store } = makeStore({ extract: undeletableExtract() });
    try {
      await expect(store.install({})).resolves.toBe(finalDir());
      expect(existsSync(join(finalDir(), "bin"))).toBe(true);
    } finally {
      await restoreExtracted();
    }
  });

  it("keeps the cancelled error when the cleanup of a cancelled install fails", async () => {
    const controller = new AbortController();
    const { store } = makeStore({
      extract: undeletableExtract(() => {
        controller.abort();
        throw new Error("tar killed");
      }),
    });
    try {
      await expect(store.install({ signal: controller.signal })).rejects.toMatchObject({
        code: "cancelled",
      });
    } finally {
      await restoreExtracted();
    }
  });

  it("shares one promise between concurrent installs", async () => {
    const release = deferred();
    hold = release.promise;
    const { store, extract } = makeStore();
    const first = store.install({});
    const second = store.install({});
    expect(second).toBe(first);
    release.resolve();
    await first;
    expect(requests).toBe(1);
    expect(extract).toHaveBeenCalledTimes(1);
    // Done: a later call starts over (and finds the engine installed).
    expect(store.install({})).not.toBe(first);
  });

  it("reinstalls over a complete install when forced, and keeps it if the new one fails", async () => {
    const { store } = makeStore();
    await store.install({});
    const marker = join(finalDir(), "bin", "sherpa-onnx-offline");
    await writeFile(marker, "broken engine");

    await store.install({ force: true });
    expect(requests).toBe(2);
    expect(await readFile(marker, "utf8")).toBe("content of bin/sherpa-onnx-offline");

    const failing = makeStore({ handshake: async () => false });
    await expect(failing.store.install({ force: true })).rejects.toMatchObject({
      code: "engine-failed-to-start",
    });
    expect(await rootEntries()).toEqual(["9.9.9"]);
    expect(await readFile(marker, "utf8")).toBe("content of bin/sherpa-onnx-offline");
  });

  it("does not download again when the engine is already installed", async () => {
    const { store } = makeStore();
    await store.install({});
    expect(requests).toBe(1);
    expect(await store.install({})).toBe(finalDir());
    expect(requests).toBe(1);
  });
});

describe.skipIf(process.platform !== "darwin")("extractWithTar", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "engine-tar-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("unpacks a .tar.bz2 with the system tar and keeps the executable bit", async () => {
    await mkdir(join(dir, "src", "top", "bin"), { recursive: true });
    await writeFile(join(dir, "src", "top", "bin", "tool"), "#!/bin/sh\n", { mode: 0o755 });
    execFileSync("/usr/bin/tar", ["-cjf", join(dir, "a.tar.bz2"), "-C", join(dir, "src"), "top"]);
    await mkdir(join(dir, "out"));

    await extractWithTar(join(dir, "a.tar.bz2"), join(dir, "out"), new AbortController().signal);

    expect(statSync(join(dir, "out", "top", "bin", "tool")).mode & 0o111).toBe(0o111);
  });

  it("rejects without unpacking when the signal is already aborted", async () => {
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src", "f"), "x");
    execFileSync("/usr/bin/tar", ["-cjf", join(dir, "a.tar.bz2"), "-C", join(dir, "src"), "f"]);
    await mkdir(join(dir, "out"));
    const controller = new AbortController();
    controller.abort();
    await expect(
      extractWithTar(join(dir, "a.tar.bz2"), join(dir, "out"), controller.signal),
    ).rejects.toThrow(/tar was stopped/);
    expect(await readdir(join(dir, "out"))).toEqual([]);
  });

  it("fails on a file that is not an archive", async () => {
    await writeFile(join(dir, "bad.tar.bz2"), "not an archive");
    await mkdir(join(dir, "out"));
    await expect(
      extractWithTar(join(dir, "bad.tar.bz2"), join(dir, "out"), new AbortController().signal),
    ).rejects.toThrow(/tar exited/);
  });
});
