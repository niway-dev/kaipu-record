import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModelCatalogEntry, ModelFile } from "./catalog";
import {
  ModelStore,
  ModelStoreError,
  type DownloadProgress,
  type ModelStoreOptions,
} from "./model-store";

const sha = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

interface Route {
  body: Buffer;
  /** Pause after the first half of the body until this resolves. */
  hold?: Promise<void>;
  /** Redirect to this path instead of serving the body. */
  redirectTo?: string;
  /** Send the body chunked, with no content-length header. */
  chunked?: boolean;
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("ModelStore", () => {
  let server: Server;
  let baseUrl: string;
  let routes: Map<string, Route>;
  let root: string;

  beforeEach(async () => {
    routes = new Map();
    server = createServer((req, res) => {
      const route = routes.get(req.url ?? "");
      if (!route) {
        res.writeHead(404).end();
        return;
      }
      if (route.redirectTo) {
        res.writeHead(302, { location: `${baseUrl}${route.redirectTo}` }).end();
        return;
      }
      res.writeHead(200, route.chunked ? {} : { "content-length": route.body.length });
      const half = Math.floor(route.body.length / 2);
      res.write(route.body.subarray(0, half));
      void (route.hold ?? Promise.resolve()).then(() => {
        res.end(route.body.subarray(half));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    root = await mkdtemp(join(tmpdir(), "model-store-"));
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  });

  /** A small catalog entry whose files are served by the local server. */
  function makeEntry(
    id: string,
    contents: Record<string, Buffer>,
  ): ModelCatalogEntry & { files: ModelFile[] } {
    const files = Object.entries(contents).map(([name, body]) => {
      routes.set(`/${id}/${name}`, { body });
      return {
        name,
        url: `${baseUrl}/${id}/${name}`,
        sha256: sha(body),
        sizeBytes: body.length,
      };
    });
    return {
      id,
      label: id,
      languages: ["en"],
      sizeBytes: files.reduce((sum, f) => sum + f.sizeBytes, 0),
      files,
      revision: "r".repeat(40),
      license: { name: "CC-BY-4.0", attribution: "test", url: "https://example.test/license" },
      capabilities: { wordTimestamps: true },
      engine: "sherpa-onnx-transducer",
    };
  }

  const smallFiles = () => ({
    "encoder.int8.onnx": Buffer.alloc(6000, 1),
    "decoder.int8.onnx": Buffer.alloc(2000, 2),
    "joiner.int8.onnx": Buffer.alloc(1000, 3),
    "tokens.txt": Buffer.from("a 0\nb 1\n"),
  });

  function makeStore(catalog: ModelCatalogEntry[], extra: Partial<ModelStoreOptions> = {}) {
    return new ModelStore({
      rootDir: root,
      catalog,
      allowInsecureHttpForTests: true,
      ...extra,
    });
  }

  it("downloads, verifies and renames into place", async () => {
    const entry = makeEntry("m1", smallFiles());
    const store = makeStore([entry]);
    expect(store.status("m1")).toEqual({ state: "missing" });
    expect(store.locate("m1")).toBeNull();

    const dir = await store.download("m1", () => {});

    expect(dir).toBe(join(root, "m1"));
    expect(store.locate("m1")).toBe(join(root, "m1"));
    expect(store.status("m1")).toEqual({ state: "ready", dir: join(root, "m1") });
    expect((await readdir(join(root, "m1"))).toSorted()).toEqual(
      Object.keys(smallFiles()).toSorted(),
    );
    expect(existsSync(join(root, "m1.partial"))).toBe(false);
    expect(await store.verify("m1")).toEqual({ ok: true });
  });

  it("follows HTTP redirects", async () => {
    const entry = makeEntry("m1", smallFiles());
    const first = entry.files[0];
    routes.set("/redirected", { body: routes.get(`/m1/${first.name}`)!.body });
    routes.set(`/m1/${first.name}`, { body: Buffer.alloc(0), redirectTo: "/redirected" });
    const store = makeStore([entry]);

    await store.download("m1", () => {});

    expect(store.locate("m1")).not.toBeNull();
  });

  it("refuses a redirect to a host the allow-list rejects, and leaves nothing behind", async () => {
    const entry = makeEntry("m1", smallFiles());
    // The request goes to the allowed local server, but the response says it was served from an
    // http host that is not the one insecure host the test store allows (as after a redirect).
    const fetchImpl: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      Object.defineProperty(response, "url", { value: "http://example.test/m1/file" });
      return response;
    };
    const store = makeStore([entry], { fetchImpl });

    await expect(store.download("m1", () => {})).rejects.toMatchObject({
      code: "network",
      message: expect.stringContaining("Refusing a non-https download URL"),
    });

    expect(existsSync(join(root, "m1"))).toBe(false);
    expect(existsSync(join(root, "m1.partial"))).toBe(false);
  });

  it("reports the destination directory", () => {
    const store = makeStore([makeEntry("m1", smallFiles())]);
    expect(store.destination("m1")).toBe(join(root, "m1"));
  });

  it("leaves no directory and no partial after a hash mismatch", async () => {
    const entry = makeEntry("m1", smallFiles());
    // Same size, different bytes: the size check passes and the hash must catch it.
    entry.files[1] = { ...entry.files[1], sha256: sha(Buffer.from("something else")) };
    const store = makeStore([entry]);

    await expect(store.download("m1", () => {})).rejects.toMatchObject({
      code: "hash-mismatch",
    });

    expect(existsSync(join(root, "m1"))).toBe(false);
    expect(existsSync(join(root, "m1.partial"))).toBe(false);
    expect(store.locate("m1")).toBeNull();
    expect(store.status("m1")).toMatchObject({ state: "failed" });
  });

  it("fails with size-mismatch when the server sends a different length", async () => {
    const entry = makeEntry("m1", smallFiles());
    entry.files[0] = { ...entry.files[0], sizeBytes: entry.files[0].sizeBytes + 10 };
    entry.sizeBytes += 10;
    const store = makeStore([entry]);

    await expect(store.download("m1", () => {})).rejects.toMatchObject({
      code: "size-mismatch",
    });

    expect(existsSync(join(root, "m1"))).toBe(false);
    expect(existsSync(join(root, "m1.partial"))).toBe(false);
  });

  it("fails with size-mismatch when a body with no content-length runs past the expected size", async () => {
    const entry = makeEntry("m1", smallFiles());
    const first = entry.files[0];
    routes.set(`/m1/${first.name}`, {
      body: Buffer.alloc(first.sizeBytes + 500, 1),
      chunked: true,
    });
    const store = makeStore([entry]);

    await expect(store.download("m1", () => {})).rejects.toMatchObject({
      code: "size-mismatch",
      message: expect.stringContaining("larger than the expected"),
    });

    expect(existsSync(join(root, "m1"))).toBe(false);
    expect(existsSync(join(root, "m1.partial"))).toBe(false);
  });

  it("fails with network when the server answers an error status", async () => {
    const entry = makeEntry("m1", smallFiles());
    routes.delete(`/m1/${entry.files[2].name}`);
    const store = makeStore([entry]);

    await expect(store.download("m1", () => {})).rejects.toMatchObject({ code: "network" });

    expect(existsSync(join(root, "m1.partial"))).toBe(false);
  });

  it("fails with network when the connection cannot be made", async () => {
    const entry = makeEntry("m1", smallFiles());
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    const store = makeStore([entry]);

    await expect(store.download("m1", () => {})).rejects.toMatchObject({ code: "network" });

    // Re-listen so afterEach can close the server it expects.
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  });

  it("cancels mid-stream and leaves nothing behind", async () => {
    const entry = makeEntry("m1", smallFiles());
    routes.get(`/m1/${entry.files[0].name}`)!.hold = new Promise(() => {});
    const store = makeStore([entry]);
    const firstProgress = deferred();

    const pending = store.download("m1", () => firstProgress.resolve());
    const assertion = expect(pending).rejects.toMatchObject({ code: "cancelled" });
    await firstProgress.promise;
    const startedAt = Date.now();
    store.cancel("m1");
    await assertion;

    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(existsSync(join(root, "m1"))).toBe(false);
    expect(existsSync(join(root, "m1.partial"))).toBe(false);
    expect(store.locate("m1")).toBeNull();
    expect(store.status("m1")).toEqual({ state: "missing" });
  });

  it("cancels through an AbortSignal", async () => {
    const entry = makeEntry("m1", smallFiles());
    routes.get(`/m1/${entry.files[0].name}`)!.hold = new Promise(() => {});
    const store = makeStore([entry]);
    const controller = new AbortController();
    const firstProgress = deferred();

    const pending = store.download("m1", () => firstProgress.resolve(), controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({ code: "cancelled" });
    await firstProgress.promise;
    controller.abort();
    await assertion;

    expect(existsSync(join(root, "m1.partial"))).toBe(false);
    expect(store.locate("m1")).toBeNull();
  });

  it("rejects without starting when the signal is already aborted", async () => {
    const store = makeStore([makeEntry("m1", smallFiles())]);
    const controller = new AbortController();
    controller.abort();

    await expect(store.download("m1", () => {}, controller.signal)).rejects.toMatchObject({
      code: "cancelled",
    });
    expect(existsSync(join(root, "m1.partial"))).toBe(false);
  });

  it("shares one promise between concurrent downloads of the same id", async () => {
    const entry = makeEntry("m1", smallFiles());
    const release = deferred();
    routes.get(`/m1/${entry.files[0].name}`)!.hold = release.promise;
    const store = makeStore([entry]);
    const firstProgress = deferred();

    const a = store.download("m1", () => firstProgress.resolve());
    const b = store.download("m1", () => {});
    expect(b).toBe(a);
    expect(store.status("m1")).toMatchObject({ state: "downloading", totalBytes: entry.sizeBytes });
    await firstProgress.promise;
    release.resolve();

    expect(await a).toBe(join(root, "m1"));
    expect(store.status("m1")).toMatchObject({ state: "ready" });
  });

  it("rejects busy for a different id while one downloads", async () => {
    const one = makeEntry("m1", smallFiles());
    const two = makeEntry("m2", smallFiles());
    const release = deferred();
    routes.get(`/m1/${one.files[0].name}`)!.hold = release.promise;
    const store = makeStore([one, two]);
    const firstProgress = deferred();

    const running = store.download("m1", () => firstProgress.resolve());
    await firstProgress.promise;

    await expect(store.download("m2", () => {})).rejects.toMatchObject({ code: "busy" });
    release.resolve();
    await running;
    expect(existsSync(join(root, "m2.partial"))).toBe(false);
  });

  it("resolves immediately when the model is already installed", async () => {
    const entry = makeEntry("m1", smallFiles());
    const store = makeStore([entry]);
    await store.download("m1", () => {});
    routes.clear();

    expect(await store.download("m1", () => {})).toBe(join(root, "m1"));
  });

  it("cleans stale partial directories on construction", async () => {
    await mkdir(join(root, "old.partial"), { recursive: true });
    await writeFile(join(root, "old.partial", "encoder.int8.onnx"), "half");
    await mkdir(join(root, "keep"), { recursive: true });

    makeStore([makeEntry("m1", smallFiles())]);

    expect(existsSync(join(root, "old.partial"))).toBe(false);
    expect(existsSync(join(root, "keep"))).toBe(true);
  });

  it("cleanStale removes a partial left after construction", async () => {
    const store = makeStore([makeEntry("m1", smallFiles())]);
    await mkdir(join(root, "m1.partial"), { recursive: true });

    store.cleanStale();

    expect(existsSync(join(root, "m1.partial"))).toBe(false);
  });

  it("locate refuses a directory with a missing or wrong-size file", async () => {
    const entry = makeEntry("m1", smallFiles());
    const store = makeStore([entry]);
    await store.download("m1", () => {});
    expect(store.locate("m1")).not.toBeNull();

    await writeFile(join(root, "m1", "joiner.int8.onnx"), "truncated");
    expect(store.locate("m1")).toBeNull();
    expect(await store.verify("m1")).toMatchObject({ ok: false, fileName: "joiner.int8.onnx" });

    await rm(join(root, "m1", "joiner.int8.onnx"));
    expect(store.locate("m1")).toBeNull();
    expect(store.status("m1")).toEqual({ state: "missing" });
  });

  it("verify catches same-size corruption that locate cannot see", async () => {
    const entry = makeEntry("m1", smallFiles());
    const store = makeStore([entry]);
    await store.download("m1", () => {});

    await writeFile(join(root, "m1", "tokens.txt"), Buffer.alloc(entry.files[3].sizeBytes, 9));

    expect(store.locate("m1")).not.toBeNull();
    expect(await store.verify("m1")).toMatchObject({ ok: false, fileName: "tokens.txt" });
  });

  it("remove deletes the installed directory and any partial", async () => {
    const entry = makeEntry("m1", smallFiles());
    const store = makeStore([entry]);
    await store.download("m1", () => {});
    await mkdir(join(root, "m1.partial"), { recursive: true });

    await store.remove("m1");

    expect(existsSync(join(root, "m1"))).toBe(false);
    expect(existsSync(join(root, "m1.partial"))).toBe(false);
    expect(store.status("m1")).toEqual({ state: "missing" });
  });

  it("remove cancels a running download of that model first", async () => {
    const entry = makeEntry("m1", smallFiles());
    routes.get(`/m1/${entry.files[0].name}`)!.hold = new Promise(() => {});
    const store = makeStore([entry]);
    const firstProgress = deferred();
    const pending = store.download("m1", () => firstProgress.resolve());
    const assertion = expect(pending).rejects.toMatchObject({ code: "cancelled" });
    await firstProgress.promise;

    await store.remove("m1");
    await assertion;

    expect(existsSync(join(root, "m1.partial"))).toBe(false);
  });

  it("remove does not delete the partial directory of a download that started meanwhile", async () => {
    const entry = makeEntry("m1", smallFiles());
    const hold = deferred();
    routes.get(`/m1/${entry.files[0].name}`)!.hold = hold.promise;
    // remove() is held while it deletes the install, so a download of the same model can start
    // and write its first bytes before remove() reaches the partial directory.
    const deleting = deferred();
    const release = deferred();
    const store = makeStore([entry], {
      rmImpl: async (path, options) => {
        if (path === join(root, "m1")) {
          deleting.resolve();
          await release.promise;
        }
        await rm(path, options);
      },
    });

    const removing = store.remove("m1");
    await deleting.promise;
    const firstProgress = deferred();
    const download = store.download("m1", () => firstProgress.resolve());
    await firstProgress.promise;
    release.resolve();
    await removing;
    hold.resolve();

    await expect(download).resolves.toBe(join(root, "m1"));
    expect(store.status("m1")).toEqual({ state: "ready", dir: join(root, "m1") });
  });

  it("fails with insufficient-disk-space before fetching anything", async () => {
    const entry = makeEntry("m1", smallFiles());
    let requests = 0;
    server.on("request", () => requests++);
    // Free space is 1.1x the model: below the 1.2x requirement.
    const statfsImpl = async () => ({ bavail: Math.floor(entry.sizeBytes * 1.1), bsize: 1 });
    const store = makeStore([entry], { statfsImpl });

    await expect(store.download("m1", () => {})).rejects.toMatchObject({
      code: "insufficient-disk-space",
    });

    expect(requests).toBe(0);
    expect(existsSync(join(root, "m1.partial"))).toBe(false);
  });

  it("proceeds when free space is at least 1.2x the model", async () => {
    const entry = makeEntry("m1", smallFiles());
    const statfsImpl = async () => ({ bavail: Math.ceil(entry.sizeBytes * 1.2), bsize: 1 });
    const store = makeStore([entry], { statfsImpl });

    await store.download("m1", () => {});

    expect(store.locate("m1")).not.toBeNull();
  });

  it("throttles progress and always reports the end", async () => {
    const entry = makeEntry("m1", smallFiles());
    const release = deferred();
    routes.get(`/m1/${entry.files[0].name}`)!.hold = release.promise;
    let clock = 0;
    const store = makeStore([entry], { now: () => clock });
    const events: DownloadProgress[] = [];
    const firstProgress = deferred();

    const pending = store.download("m1", (p) => {
      events.push(p);
      firstProgress.resolve();
    });
    await firstProgress.promise;
    // The clock has not moved, so nothing else may be reported until it does.
    release.resolve();
    await pending;

    // First event while streaming, then only the final one.
    expect(events).toHaveLength(2);
    expect(events[0].id).toBe("m1");
    expect(events[0].fileName).toBe("encoder.int8.onnx");
    expect(events[0].totalBytes).toBe(entry.sizeBytes);
    expect(events[1].receivedBytes).toBe(entry.sizeBytes);
  });

  it("reports again once the throttle interval has passed", async () => {
    const entry = makeEntry("m1", smallFiles());
    const release = deferred();
    routes.get(`/m1/${entry.files[0].name}`)!.hold = release.promise;
    let clock = 0;
    const store = makeStore([entry], { now: () => clock });
    const events: DownloadProgress[] = [];
    const firstProgress = deferred();

    const pending = store.download("m1", (p) => {
      events.push(p);
      firstProgress.resolve();
    });
    await firstProgress.promise;
    const afterFirst = events.length;
    clock = 1000;
    release.resolve();
    await pending;

    expect(events.length).toBeGreaterThan(afterFirst);
    for (let i = 1; i < events.length; i++) {
      expect(events[i].receivedBytes).toBeGreaterThanOrEqual(events[i - 1].receivedBytes);
    }
    expect(events.at(-1)?.receivedBytes).toBe(entry.sizeBytes);
  });

  it("refuses http URLs unless the test option is set", async () => {
    const entry = makeEntry("m1", smallFiles());
    const store = new ModelStore({ rootDir: root, catalog: [entry] });

    await expect(store.download("m1", () => {})).rejects.toMatchObject({ code: "network" });
    expect(existsSync(join(root, "m1.partial"))).toBe(false);
  });

  it("refuses http URLs that are not 127.0.0.1 even with the test option", async () => {
    const entry = makeEntry("m1", smallFiles());
    entry.files[0] = { ...entry.files[0], url: "http://example.com/enc" };
    const store = makeStore([entry]);

    await expect(store.download("m1", () => {})).rejects.toMatchObject({ code: "network" });
  });

  it("rejects an unknown model id", async () => {
    const store = makeStore([makeEntry("m1", smallFiles())]);
    await expect(store.download("nope", () => {})).rejects.toThrow(/unknown model/i);
    expect(() => store.destination("nope")).toThrow(/unknown model/i);
  });

  it("exposes ModelStoreError with a code", () => {
    const error = new ModelStoreError("busy", "x");
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("busy");
    expect(error.name).toBe("ModelStoreError");
  });

  it("writes the file bytes unchanged", async () => {
    const files = smallFiles();
    const store = makeStore([makeEntry("m1", files)]);
    await store.download("m1", () => {});
    for (const [name, body] of Object.entries(files)) {
      expect(sha(await readFile(join(root, "m1", name)))).toBe(sha(body));
    }
  });
});
