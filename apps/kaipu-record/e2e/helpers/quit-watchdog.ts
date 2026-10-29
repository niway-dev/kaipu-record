import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * How long the teardown lets `app.quit()` run before it treats the app as hung.
 *
 * A healthy quit of the built app takes well under a second (the suite's passing tests
 * launch, act and quit in 3–5 s in total). The hang this bounds (NIW2-548) never
 * recovers on its own: on CI the test burned its full 120 s timeout and then the worker
 * teardown burned another 120 s on top, four minutes per occurrence. Fifteen seconds is
 * long enough that a slow runner cannot trip it and short enough that, with the ~3 s stack
 * sample that follows, a hung test still fails and retries inside its own budget.
 */
export const QUIT_DEADLINE_MS = 15_000;

export interface QuitWatchdogDeps {
  /** Ask the app to quit and resolve once its process is gone (`ElectronApplication.close`). */
  close: () => Promise<void>;
  deadlineMs: number;
  /** A stack of the app's main process, taken while it is still hung. May reject. */
  sample: () => Promise<string>;
  /** Kill the process for good; only called after `deadlineMs` has passed. */
  kill: () => void;
  /** Whatever the app wrote to stderr since launch. */
  stderr: () => string;
  /** Keep a piece of evidence with the test's report. May reject. */
  attach: (name: string, body: string) => Promise<void>;
}

/**
 * Close the app, or — when `app.quit()` does not finish within the deadline — capture what
 * it was doing, kill it, and FAIL.
 *
 * The failure is the point. A silent kill would make the suite green while shipping an
 * app that cannot quit, and would throw away the one moment the defect can be observed.
 * Failing keeps the retry (so one hang does not block a release) and the report carries
 * the main process's stack and stderr, which the 120 s timeout never produced.
 */
export async function closeOrReport(deps: QuitWatchdogDeps): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"hung">((resolve) => {
    timer = setTimeout(() => resolve("hung"), deps.deadlineMs);
  });
  try {
    const outcome = await Promise.race([deps.close().then(() => "closed" as const), deadline]);
    if (outcome === "closed") return;
  } finally {
    clearTimeout(timer);
  }

  const stack = await deps
    .sample()
    .catch(
      (error: unknown) =>
        `sample failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  try {
    await deps.attach("quit-hang-stack", stack);
    await deps.attach("quit-hang-stderr", deps.stderr() || "(Electron wrote nothing to stderr)");
  } catch {
    // Evidence is best effort; the kill and the failure below are not.
  }
  deps.kill();
  throw new Error(
    `[e2e] app.quit() did not finish within ${deps.deadlineMs} ms, so Electron was killed. ` +
      "Every assertion may have passed: this is the quit hang (NIW2-548), not the test. " +
      "The main process's stack and stderr are attached as quit-hang-stack / quit-hang-stderr.",
  );
}

/**
 * The call stacks of every thread of `pid`, from macOS's `sample` (2 s at the default
 * 1 ms interval). Elsewhere there is no sampler to call, which the text says.
 */
export async function sampleProcess(pid: number): Promise<string> {
  if (process.platform !== "darwin") return `no stack sampler on ${process.platform}`;
  const dir = await mkdtemp(path.join(tmpdir(), "kaipu-e2e-sample-"));
  const file = path.join(dir, `electron-${pid}.sample.txt`);
  try {
    await execFileAsync("sample", [String(pid), "2", "-file", file], { timeout: 20_000 });
    return await readFile(file, "utf-8");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
