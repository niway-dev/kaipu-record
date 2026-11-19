import { afterEach, describe, expect, it } from "vitest";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { getEventListeners } from "node:events";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCliArgs,
  runBatch,
  SherpaError,
  STDERR_TAIL_BYTES,
  type CliResult,
  type SherpaErrorCode,
} from "./sherpa-supervisor";

const directories: string[] = [];
const pids: number[] = [];
afterEach(async () => {
  for (const pid of pids.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

/** Whether a process still exists (a zombie counts: the supervisor must wait for the exit). */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A stand-in CLI: a shell wrapper that `exec`s node on `body`, so the pid is the node process. */
async function fakeCli(body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kaipu-fake-sherpa-"));
  directories.push(dir);
  const script = join(dir, "fake.cjs");
  const cli = join(dir, "sherpa-onnx-offline");
  await writeFile(
    script,
    `const wavs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const line = (i) => JSON.stringify({ lang: "", text: "file " + i, tokens: ["a", "b"], timestamps: [0, 0.5], durations: [0.4, 0.4], ys_log_probs: [-0.1, -0.2], words: [] }) + "\\n";
${body}`,
  );
  await writeFile(cli, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
  await chmod(cli, 0o755);
  return cli;
}

const WAVS = ["/tmp/a.wav", "/tmp/b.wav", "/tmp/c.wav"];

function run(cliPath: string, overrides: Partial<Parameters<typeof runBatch>[0]> = {}) {
  const controller = new AbortController();
  let pid: number | undefined;
  const promise = runBatch({
    cliPath,
    modelDir: "/models/parakeet",
    wavPaths: WAVS,
    deadlineMs: 10_000,
    signal: controller.signal,
    onSpawn: (value) => {
      pid = value;
      pids.push(value);
    },
    ...overrides,
  });
  return { promise, controller, pid: () => pid };
}

async function rejection(promise: Promise<unknown>): Promise<SherpaError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(SherpaError);
    return error as SherpaError;
  }
  throw new Error("expected the batch to reject");
}

describe("buildCliArgs", () => {
  it("passes the model files, the model type, threads and the wavs in order", () => {
    expect(buildCliArgs("/m", ["/a.wav", "/b.wav"], 4)).toEqual([
      "--tokens=/m/tokens.txt",
      "--encoder=/m/encoder.int8.onnx",
      "--decoder=/m/decoder.int8.onnx",
      "--joiner=/m/joiner.int8.onnx",
      "--model-type=nemo_transducer",
      "--num-threads=4",
      "/a.wav",
      "/b.wav",
    ]);
  });
});

describe("runBatch with a fake CLI", () => {
  it("returns one parsed result per file, in order, and the child has exited", async () => {
    const cli = await fakeCli(
      `console.error("loading model"); wavs.forEach((_, i) => process.stdout.write(line(i)));`,
    );
    const { promise, pid } = run(cli);
    const results: CliResult[] = await promise;
    expect(results.map((r) => r.text)).toEqual(["file 0", "file 1", "file 2"]);
    expect(results[0]).toMatchObject({
      tokens: ["a", "b"],
      timestamps: [0, 0.5],
      durations: [0.4, 0.4],
    });
    expect(alive(pid()!)).toBe(false);
  });

  it("hands the CLI the documented arguments", async () => {
    const cli = await fakeCli(
      `const expected = ["--tokens=/models/parakeet/tokens.txt","--model-type=nemo_transducer","--num-threads=2"];
const ok = expected.every((a) => process.argv.includes(a)) && wavs.join() === ${JSON.stringify(WAVS.join())};
wavs.forEach((_, i) => process.stdout.write(ok ? line(i) : "bad\\n"));`,
    );
    const { promise } = run(cli, { threads: 2 });
    expect(await promise).toHaveLength(3);
  });

  it("copes with a result line split across chunks and multi-byte text", async () => {
    const cli = await fakeCli(
      `const text = JSON.stringify({ text: "caf\\u00e9 \\u65e5\\u672c", tokens: ["x"], timestamps: [0] }) + "\\n";
const bytes = Buffer.from(text.repeat(wavs.length));
let i = 0;
const timer = setInterval(() => {
  process.stdout.write(bytes.subarray(i, i + 7));
  i += 7;
  if (i >= bytes.length) { clearInterval(timer); }
}, 1);`,
    );
    const { promise } = run(cli);
    expect((await promise).map((r) => r.text)).toEqual(Array(3).fill("café 日本"));
  });

  it("rejects bad-output when it prints fewer lines than files", async () => {
    const cli = await fakeCli(`process.stdout.write(line(0));`);
    const { promise, pid } = run(cli);
    const error = await rejection(promise);
    expect(error.code).toBe<SherpaErrorCode>("bad-output");
    expect(error.message).toContain("Expected 3 results");
    expect(alive(pid()!)).toBe(false);
  });

  it("rejects bad-output, and kills the child, on more lines than files", async () => {
    const cli = await fakeCli(
      `for (let i = 0; i < 4; i++) process.stdout.write(line(i)); setInterval(() => {}, 1000);`,
    );
    const { promise, pid } = run(cli);
    expect((await rejection(promise)).code).toBe("bad-output");
    expect(alive(pid()!)).toBe(false);
  });

  it("rejects bad-output on garbage, and kills a child that would keep running", async () => {
    const cli = await fakeCli(
      `process.stdout.write("not json at all\\n"); setInterval(() => {}, 1000);`,
    );
    const { promise, pid } = run(cli);
    expect((await rejection(promise)).code).toBe("bad-output");
    expect(alive(pid()!)).toBe(false);
  });

  it("rejects bad-output for JSON that is not a result", async () => {
    const cli = await fakeCli(`wavs.forEach(() => process.stdout.write('{"hello":1}\\n'));`);
    const { promise } = run(cli);
    expect((await rejection(promise)).code).toBe("bad-output");
  });

  it("rejects exit with the exit code and the stderr tail on a non-zero exit", async () => {
    const cli = await fakeCli(`console.error("model file missing"); process.exit(3);`);
    const { promise, pid } = run(cli);
    const error = await rejection(promise);
    expect(error.code).toBe("exit");
    expect(error.exitCode).toBe(3);
    expect(error.stderrTail).toContain("model file missing");
    expect(alive(pid()!)).toBe(false);
  });

  it("keeps only the last 2 KB of stderr", async () => {
    const cli = await fakeCli(
      `process.stderr.write("HEAD".repeat(2000) + "TAIL-MARK"); setTimeout(() => process.exit(1), 50);`,
    );
    const { promise } = run(cli);
    const error = await rejection(promise);
    expect(error.stderrTail.length).toBeLessThanOrEqual(STDERR_TAIL_BYTES);
    expect(error.stderrTail.endsWith("TAIL-MARK")).toBe(true);
  });

  it("rejects exit when the child is killed by a signal it was not sent by us", async () => {
    const cli = await fakeCli(`process.kill(process.pid, "SIGSEGV"); setInterval(() => {}, 1000);`);
    const { promise } = run(cli);
    const error = await rejection(promise);
    expect(error.code).toBe("exit");
    expect(error.message).toContain("SIGSEGV");
  });

  it("kills the child at the deadline and rejects deadline", async () => {
    const cli = await fakeCli(`setInterval(() => {}, 1000);`);
    const started = Date.now();
    const { promise, pid } = run(cli, { deadlineMs: 300 });
    const error = await rejection(promise);
    expect(error.code).toBe("deadline");
    expect(Date.now() - started).toBeLessThan(2500);
    expect(alive(pid()!)).toBe(false);
  });

  it("kills the child on abort and rejects cancelled well within 1.5 s", async () => {
    const cli = await fakeCli(`setInterval(() => {}, 1000);`);
    const { promise, controller, pid } = run(cli);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const started = Date.now();
    controller.abort();
    const error = await rejection(promise);
    expect(error.code).toBe("cancelled");
    expect(Date.now() - started).toBeLessThan(1500);
    expect(alive(pid()!)).toBe(false);
  });

  it("escalates to SIGKILL when the child ignores SIGTERM", async () => {
    // The child writes `ready` once its SIGTERM handler is installed; aborting earlier would let
    // the default handler kill it and the test would not reach the SIGKILL path.
    const cli = await fakeCli(
      `process.on("SIGTERM", () => {});
require("fs").writeFileSync(require("path").join(__dirname, "ready"), "1");
setInterval(() => {}, 1000);`,
    );
    const { promise, controller, pid } = run(cli);
    const ready = join(dirname(cli), "ready");
    const waitStart = Date.now();
    while (!existsSync(ready)) {
      if (Date.now() - waitStart > 10_000) throw new Error("the fake engine never became ready");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const started = Date.now();
    controller.abort();
    const error = await rejection(promise);
    const elapsed = Date.now() - started;
    expect(error.code).toBe("cancelled");
    expect(elapsed).toBeGreaterThanOrEqual(900);
    expect(elapsed).toBeLessThan(2000);
    expect(alive(pid()!)).toBe(false);
  });

  it("rejects cancelled without spawning when the signal is already aborted", async () => {
    const cli = await fakeCli(`wavs.forEach((_, i) => process.stdout.write(line(i)));`);
    const controller = new AbortController();
    controller.abort();
    let spawned = false;
    const error = await rejection(
      runBatch({
        cliPath: cli,
        modelDir: "/m",
        wavPaths: WAVS,
        deadlineMs: 5000,
        signal: controller.signal,
        onSpawn: () => {
          spawned = true;
        },
      }),
    );
    expect(error.code).toBe("cancelled");
    expect(spawned).toBe(false);
  });

  it("rejects output-too-large on a flood, and kills the child", async () => {
    const cli = await fakeCli(
      `const chunk = "x".repeat(1 << 20);
(function pump() { while (process.stdout.write(chunk)) {} process.stdout.once("drain", pump); })();`,
    );
    const { promise, pid } = run(cli, { maxStdoutBytes: 1 << 20 });
    const error = await rejection(promise);
    expect(error.code).toBe("output-too-large");
    expect(alive(pid()!)).toBe(false);
  });

  it("rejects spawn-failed when the binary does not exist", async () => {
    const { promise } = run("/nowhere/sherpa-onnx-offline");
    expect((await rejection(promise)).code).toBe("spawn-failed");
  });

  it("rejects spawn-failed when spawn throws", async () => {
    const { promise } = run("/x", {
      spawnImpl: (() => {
        throw new Error("EAGAIN");
      }) as never,
    });
    const error = await rejection(promise);
    expect(error.code).toBe("spawn-failed");
    expect(error.message).toContain("EAGAIN");
  });

  it("does not leave an abort listener behind after success", async () => {
    const cli = await fakeCli(`wavs.forEach((_, i) => process.stdout.write(line(i)));`);
    const controller = new AbortController();
    const results = await runBatch({
      cliPath: cli,
      modelDir: "/m",
      wavPaths: WAVS,
      deadlineMs: 5000,
      signal: controller.signal,
    });
    expect(results).toHaveLength(3);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });
});

/**
 * The real-engine test needs three things and skips when any is missing:
 * - the engine, installed by `bun run fetch:speech-engine` into `resources/native/sherpa-onnx`;
 * - a Parakeet model directory, named by `KAIPU_TEST_PARAKEET_DIR` (it holds `encoder.int8.onnx`);
 * - a 16 kHz mono WAV of speech, named by `KAIPU_TEST_WAV` (see `scripts/spikes/transcription-m0`).
 */
const realEngine = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../resources/native/sherpa-onnx",
);
const realModel = process.env.KAIPU_TEST_PARAKEET_DIR ?? "";
const fixture = process.env.KAIPU_TEST_WAV ?? "";
const haveReal =
  process.platform === "darwin" &&
  process.arch === "arm64" &&
  existsSync(join(realEngine, "bin", "sherpa-onnx-offline")) &&
  realModel !== "" &&
  fixture !== "" &&
  existsSync(join(realModel, "encoder.int8.onnx")) &&
  existsSync(fixture);

describe("runBatch with the real engine", () => {
  it.skipIf(!haveReal)(
    "transcribes a 30 s file into aligned tokens and timestamps",
    async () => {
      const controller = new AbortController();
      let pid: number | undefined;
      const results = await runBatch({
        cliPath: join(realEngine, "bin", "sherpa-onnx-offline"),
        libDir: join(realEngine, "lib"),
        modelDir: realModel,
        wavPaths: [fixture],
        deadlineMs: 120_000,
        signal: controller.signal,
        onSpawn: (value) => {
          pid = value;
        },
      });
      expect(results).toHaveLength(1);
      const [result] = results;
      expect(typeof result.text).toBe("string");
      expect(result.text.length).toBeGreaterThan(0);
      expect(result.tokens.length).toBeGreaterThan(0);
      expect(result.tokens.length).toBe(result.timestamps.length);
      expect(result.durations).toHaveLength(result.tokens.length);
      expect(alive(pid!)).toBe(false);
    },
    130_000,
  );
});
