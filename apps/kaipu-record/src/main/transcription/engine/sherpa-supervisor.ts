import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

/** What `sherpa-onnx-offline` prints on stdout for one input file (one JSON line each). */
export interface CliResult {
  text: string;
  tokens: string[];
  /** Start of each token in seconds, from the start of that file. */
  timestamps: number[];
  /** Duration of each token in seconds. */
  durations?: number[];
  ys_log_probs?: number[];
}

export type SherpaErrorCode =
  | "deadline"
  | "cancelled"
  | "exit"
  | "bad-output"
  | "output-too-large"
  | "spawn-failed";

export class SherpaError extends Error {
  readonly code: SherpaErrorCode;
  /** The last bytes of the child's stderr (at most `STDERR_TAIL_BYTES`). */
  readonly stderrTail: string;
  readonly exitCode: number | null;

  constructor(
    code: SherpaErrorCode,
    message: string,
    details: { stderrTail?: string; exitCode?: number | null } = {},
  ) {
    super(message);
    this.name = "SherpaError";
    this.code = code;
    this.stderrTail = details.stderrTail ?? "";
    this.exitCode = details.exitCode ?? null;
  }
}

/** More stdout than this is a broken engine, not a transcript: one hour is a few MB. */
export const MAX_STDOUT_BYTES = 64 * 1024 * 1024;
export const STDERR_TAIL_BYTES = 2048;
/** After SIGTERM on cancel, how long the child gets before SIGKILL. */
export const TERM_GRACE_MS = 1000;
/** If a SIGKILLed child still has not exited after this, settle anyway (it cannot be waited on). */
const EXIT_BACKSTOP_MS = 5000;

export interface RunBatchOptions {
  cliPath: string;
  /**
   * The engine library directory. The CLI finds `libonnxruntime.dylib` through its own `@rpath`
   * (`@loader_path/../lib`), so this is only a fallback search path.
   */
  libDir?: string;
  modelDir: string;
  /** 16 kHz mono WAV files; the CLI prints one JSON line per file, in this order. */
  wavPaths: string[];
  threads?: number;
  /** The whole batch, model load included. On expiry the child is SIGKILLed. */
  deadlineMs: number;
  signal: AbortSignal;
  /** Called once with the child's pid right after it starts. */
  onSpawn?: (pid: number) => void;
  /** Test seam. */
  spawnImpl?: typeof nodeSpawn;
}

export function buildCliArgs(modelDir: string, wavPaths: string[], threads: number): string[] {
  return [
    `--tokens=${modelDir}/tokens.txt`,
    `--encoder=${modelDir}/encoder.int8.onnx`,
    `--decoder=${modelDir}/decoder.int8.onnx`,
    `--joiner=${modelDir}/joiner.int8.onnx`,
    "--model-type=nemo_transducer",
    `--num-threads=${threads}`,
    ...wavPaths,
  ];
}

function parseCliLine(line: string): CliResult | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const result = value as Partial<CliResult>;
  if (
    typeof result.text !== "string" ||
    !Array.isArray(result.tokens) ||
    !Array.isArray(result.timestamps)
  ) {
    return undefined;
  }
  return result as CliResult;
}

/**
 * Runs `sherpa-onnx-offline` once over a batch of WAV files and returns one result per file.
 *
 * Not `runHelperProcess`: that is one-shot, caps stdout at 16 MB and cannot be cancelled. This
 * streams stdout line by line (memory stays bounded; past `MAX_STDOUT_BYTES` the child is killed),
 * enforces a deadline, and honors an AbortSignal (SIGTERM, then SIGKILL after `TERM_GRACE_MS`).
 *
 * The promise settles only after the child has exited (or, for a child that cannot be reaped,
 * after a 5 s backstop), so on every path no child is left running.
 */
export function runBatch(options: RunBatchOptions): Promise<CliResult[]> {
  const { cliPath, libDir, modelDir, wavPaths, deadlineMs, signal, onSpawn } = options;
  const spawnImpl = options.spawnImpl ?? nodeSpawn;
  const threads = options.threads ?? 4;

  return new Promise<CliResult[]>((resolve, reject) => {
    if (signal.aborted) {
      reject(new SherpaError("cancelled", "Transcription was cancelled before the engine started"));
      return;
    }

    const results: CliResult[] = [];
    const decoder = new StringDecoder("utf8");
    let pending = "";
    let stdoutBytes = 0;
    let stderrTail: Buffer = Buffer.alloc(0);
    let failure: SherpaError | undefined;
    let settled = false;
    let exited = false;
    let child: ChildProcess;
    let deadlineTimer: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    let backstopTimer: NodeJS.Timeout | undefined;

    const tail = () => stderrTail.toString("utf8").trim();
    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      if (deadlineTimer) clearTimeout(deadlineTimer);
      if (killTimer) clearTimeout(killTimer);
      if (backstopTimer) clearTimeout(backstopTimer);
      signal.removeEventListener("abort", onAbort);
      action();
    };
    const fail = (error: SherpaError) => {
      settle(() => reject(error));
    };

    /** Records the first cause, signals the child, and lets the exit event reject. */
    const kill = (cause: SherpaError, signalName: NodeJS.Signals) => {
      if (failure) return;
      failure = cause;
      if (exited) {
        fail(cause);
        return;
      }
      if (deadlineTimer) clearTimeout(deadlineTimer);
      child.kill(signalName);
      if (signalName === "SIGTERM") {
        killTimer = setTimeout(() => child.kill("SIGKILL"), TERM_GRACE_MS);
      }
      backstopTimer = setTimeout(
        () => fail(cause),
        EXIT_BACKSTOP_MS + (signalName === "SIGTERM" ? TERM_GRACE_MS : 0),
      );
    };

    const takeLine = (line: string) => {
      if (failure || line.trim() === "") return;
      if (results.length >= wavPaths.length) {
        kill(
          new SherpaError("bad-output", "The engine printed more results than input files", {
            stderrTail: tail(),
          }),
          "SIGKILL",
        );
        return;
      }
      const parsed = parseCliLine(line);
      if (!parsed) {
        kill(
          new SherpaError("bad-output", "The engine printed a line that is not a result", {
            stderrTail: tail(),
          }),
          "SIGKILL",
        );
        return;
      }
      results.push(parsed);
    };

    function onAbort() {
      kill(new SherpaError("cancelled", "Transcription was cancelled"), "SIGTERM");
    }

    try {
      child = spawnImpl(cliPath, buildCliArgs(modelDir, wavPaths, threads), {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: libDir ? { ...process.env, DYLD_FALLBACK_LIBRARY_PATH: libDir } : process.env,
      });
    } catch (error) {
      reject(
        new SherpaError("spawn-failed", `Could not start the engine: ${(error as Error).message}`),
      );
      return;
    }

    child.on("error", (error) => {
      // `error` fires for a failed spawn (no pid) and, rarely, for a failed kill.
      if (child.pid === undefined) {
        exited = true;
        fail(
          new SherpaError("spawn-failed", `Could not start the engine: ${error.message}`, {
            stderrTail: tail(),
          }),
        );
      }
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      if (failure) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        pending = "";
        kill(
          new SherpaError(
            "output-too-large",
            `The engine printed more than ${MAX_STDOUT_BYTES} bytes`,
            { stderrTail: tail() },
          ),
          "SIGKILL",
        );
        return;
      }
      pending += decoder.write(chunk);
      let newline = pending.indexOf("\n");
      while (newline !== -1 && !failure) {
        takeLine(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        newline = pending.indexOf("\n");
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrTail = Buffer.concat([stderrTail, chunk]);
      if (stderrTail.length > STDERR_TAIL_BYTES) {
        stderrTail = stderrTail.subarray(stderrTail.length - STDERR_TAIL_BYTES);
      }
    });

    // `exit` fires when the process is gone, even if a grandchild holds a pipe open; `close`
    // fires after stdout is fully read. A failure settles on `exit`; success waits for `close`.
    child.on("exit", () => {
      exited = true;
      if (failure) fail(failure);
    });

    child.on("close", (code, killedBy) => {
      exited = true;
      if (failure) {
        fail(failure);
        return;
      }
      pending += decoder.end();
      if (pending.trim() !== "") takeLine(pending);
      pending = "";
      if (failure) {
        fail(failure);
        return;
      }
      if (code !== 0) {
        fail(
          new SherpaError(
            "exit",
            killedBy
              ? `The engine was killed by ${killedBy}`
              : `The engine exited with code ${code}`,
            { stderrTail: tail(), exitCode: code },
          ),
        );
        return;
      }
      if (results.length !== wavPaths.length) {
        fail(
          new SherpaError(
            "bad-output",
            `Expected ${wavPaths.length} results, the engine printed ${results.length}`,
            { stderrTail: tail(), exitCode: code },
          ),
        );
        return;
      }
      settle(() => resolve(results));
    });

    if (child.pid !== undefined) onSpawn?.(child.pid);
    signal.addEventListener("abort", onAbort, { once: true });
    deadlineTimer = setTimeout(
      () =>
        kill(
          new SherpaError("deadline", `The engine did not finish within ${deadlineMs} ms`, {
            stderrTail: tail(),
          }),
          "SIGKILL",
        ),
      deadlineMs,
    );
  });
}
