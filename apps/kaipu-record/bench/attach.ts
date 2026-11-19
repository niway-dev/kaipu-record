import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { parseAttachArgs, USAGE } from "./args";
import { gitHead, gitRoot, readTick, readWatchedFiles, totalBytes } from "./collect";
import { PhaseTracker } from "./phases";
import { rootMatch } from "./discover";
import { RunRecorder, SAMPLES_HEADER, SYSTEM_HEADER, TICK_INTERVAL_MS } from "./recorder";
import { runJsonSchema } from "./schema";
import { outputCheckpoints, renderSummary } from "./summary";

/** A stuck output longer than this while the file exists violates the invariant. */
const MAX_STALL_MS = 30_000;

const mono = (): number => Number(process.hrtime.bigint() / 1_000_000n);

async function main(): Promise<number> {
  const args = parseAttachArgs(process.argv.slice(2), homedir());
  if ("error" in args) {
    console.error(`${args.error}\n\n${USAGE}`);
    return 1;
  }
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  const benchDir = dirname(fileURLToPath(import.meta.url));
  const root = args.match ?? rootMatch((await gitRoot(benchDir)) ?? process.cwd());
  const ref = await gitHead(benchDir);

  const startedAt = new Date();
  const stamp = startedAt.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runDir = resolve(args.out ?? `${benchDir}/runs`, `${stamp}-field`);
  mkdirSync(runDir, { recursive: true });
  const samplesPath = `${runDir}/samples.csv`;
  const systemPath = `${runDir}/system.csv`;
  writeFileSync(samplesPath, `${SAMPLES_HEADER}\n`);
  writeFileSync(systemPath, `${SYSTEM_HEADER}\n`);

  const phases = new PhaseTracker(mono);
  const t0 = mono();
  const recorder = new RunRecorder({
    machine: args.machine,
    ref,
    watched: args.watch !== null,
    maxStallMs: MAX_STALL_MS,
    phaseAt: (t) => phases.phaseAt(t),
  });

  console.log(`bench:attach: looking for the dev Electron under ${root}`);
  console.log(
    `Sampling every second${args.watch ? `, watching ${args.watch} (sizes only)` : ""}. Type a label + Enter for a phase mark; Ctrl+C to finish.`,
  );

  let stopping = false;
  let attached = false;
  let warnedEmpty = false;
  let lastError: string | null = null;
  let wake: () => void = () => {};

  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    phases.mark(line);
    if (line.trim()) console.log(`  phase: ${phases.current()}`);
  });

  const tick = async (): Promise<void> => {
    const began = mono();
    const reading = await readTick(root);
    const files = args.watch ? readWatchedFiles(args.watch) : new Map<string, number>();
    if (reading.error) {
      if (reading.error !== lastError) console.error(`  ${reading.error}`);
      lastError = reading.error;
    } else {
      lastError = null;
    }
    // A failed read says nothing about the app; recording it would mark every process exited.
    if (reading.error && attached) return;
    if (reading.processes.length === 0 && !attached) {
      if (!reading.error && !warnedEmpty) {
        console.log("  no dev Electron found yet; waiting (start `bun run dev`)");
        warnedEmpty = true;
      }
      return;
    }
    if (!attached) console.log(`  attached to ${reading.processes.length} processes`);
    attached = true;
    // An empty tick after attaching is recorded too: it is how a vanished app gets `exited`.
    const { sampleRows, systemRow } = recorder.addTick({
      tMs: began - t0,
      processes: reading.processes,
      system: reading.system,
      outputBytes: totalBytes(files),
      outputFiles: files,
      costMs: mono() - began,
    });
    if (sampleRows.length > 0) appendFileSync(samplesPath, `${sampleRows.join("\n")}\n`);
    appendFileSync(systemPath, `${systemRow}\n`);
  };

  const stopped = new Promise<void>((done) => {
    const stop = (): void => {
      stopping = true;
      wake();
      done();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    if (args.duration !== null) setTimeout(stop, args.duration * 1000);
  });

  // Fixed-rate loop: a slow tick shortens the next wait instead of piling up.
  const loopDone = (async () => {
    while (!stopping) {
      const began = mono();
      await tick();
      const wait = Math.max(0, TICK_INTERVAL_MS - (mono() - began));
      await new Promise<void>((r) => {
        wake = r;
        setTimeout(r, wait);
      });
    }
  })();

  await stopped;
  rl.close();
  // The tick in flight finishes before the final read, so the two never interleave.
  await loopDone;

  // Final read: the lifetime peak of every process still alive, before anything exits.
  // Recorded even when empty (processes that went away are marked exited), unless the
  // read itself failed: a failed `footprint` call also returns no processes.
  if (attached) {
    let live = await readTick(root);
    if (live.error) live = await readTick(root);
    if (live.error) {
      console.error(
        `  final read failed (${live.error}); not recorded, so processes keep their last known state`,
      );
    } else {
      const files = args.watch ? readWatchedFiles(args.watch) : new Map<string, number>();
      const { sampleRows, systemRow } = recorder.addTick({
        tMs: mono() - t0,
        processes: live.processes,
        system: live.system,
        outputBytes: totalBytes(files),
        outputFiles: files,
        costMs: 0,
      });
      if (sampleRows.length > 0) appendFileSync(samplesPath, `${sampleRows.join("\n")}\n`);
      appendFileSync(systemPath, `${systemRow}\n`);
    }
  }

  const endedAt = new Date();
  const run = recorder.finish({
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: mono() - t0,
    phases: phases.marks(),
  });
  const checked = runJsonSchema.safeParse(run);
  if (!checked.success) {
    console.error("run.json failed its own schema:", checked.error.message);
    return 2;
  }
  writeFileSync(`${runDir}/run.json`, `${JSON.stringify(run, null, 2)}\n`);
  console.log(`\n${renderSummary(run, outputCheckpoints(recorder.outputSamples(), 6))}`);
  console.log(`Run folder: ${runDir}`);
  return run.processes.length === 0 ? 3 : 0;
}

process.exit(await main());
