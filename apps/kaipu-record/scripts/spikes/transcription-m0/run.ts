/**
 * NIW2-818 M0: runs Parakeet v3 through `sherpa-onnx-offline` on one 16 kHz mono WAV with a
 * chosen segmentation, and prints metrics as JSON. It never prints or saves transcript text
 * unless `--save-words` names a file, which must stay outside the repository.
 *
 *   bun run.ts --audio r20.wav --runtime <sherpa dir> --model <model dir> \
 *     --strategy single|fixed|energy --batch 4 [--rule spec|midpoint|midpoint-dedupe] \
 *     [--reference words.json] [--save-words words.json]
 *
 * Defaults are the configuration the ADR chose: --strategy fixed --batch 4 --rule midpoint-dedupe.
 * An unknown --strategy or --rule value is an error.
 *
 * See README.md for how the 5, 20 and 60 minute inputs were made.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SAMPLE_RATE, frameLevelsDb, readWav, writeWav } from "./audio";
import { adjacentDuplicates, compareWords, timingError } from "./compare";
import { ENERGY_DEFAULTS, FIXED_DEFAULTS, planEnergy, planFixed, type Plan } from "./segment";
import { groupTokens, reconcile, type CliResult, type ReconcileRule, type Word } from "./words";

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? process.argv[i + 1] : fallback;
  if (value === undefined) throw new Error(`missing --${name}`);
  return value;
}

const STRATEGIES = ["single", "fixed", "energy"];
const RULES: string[] = ["spec", "midpoint", "midpoint-dedupe"];

// Validated before anything else is read, so a typo fails here and never falls through to
// another strategy or rule.
const strategy = arg("strategy", "fixed");
if (!STRATEGIES.includes(strategy)) {
  throw new Error(`unknown --strategy "${strategy}"; allowed: ${STRATEGIES.join(", ")}`);
}
const ruleArg = arg("rule", "midpoint-dedupe");
if (!RULES.includes(ruleArg)) {
  throw new Error(`unknown --rule "${ruleArg}"; allowed: ${RULES.join(", ")}`);
}
const rule = ruleArg as ReconcileRule;

const audioPath = arg("audio");
const runtime = arg("runtime");
const model = arg("model");
const batchSize = Number(arg("batch", "4"));
const threads = Number(arg("threads", "4"));
const referencePath = process.argv.includes("--reference") ? arg("reference") : null;
const saveWords = process.argv.includes("--save-words") ? arg("save-words") : null;
const truthPath = process.argv.includes("--truth") ? arg("truth") : null;
const marksPath = process.argv.includes("--marks") ? arg("marks") : null;

const windowMs = Number(arg("window-ms", String(FIXED_DEFAULTS.windowMs)));
const overlapMs = Number(arg("overlap-ms", String(FIXED_DEFAULTS.overlapMs)));
const maxSegmentMs = Number(arg("max-segment-ms", String(ENERGY_DEFAULTS.maxSegmentMs)));

const samples = readWav(audioPath);
const durationMs = (samples.length / SAMPLE_RATE) * 1000;

const t0 = performance.now();
const plan: Plan =
  strategy === "single"
    ? { segments: [{ id: 0, startMs: 0, endMs: durationMs }], seams: [] }
    : strategy === "fixed"
      ? planFixed(samples, { windowMs, overlapMs })
      : planEnergy(samples, {
          ...ENERGY_DEFAULTS,
          maxSegmentMs,
          overlapMs: Math.min(overlapMs, ENERGY_DEFAULTS.overlapMs),
        });
const planMs = performance.now() - t0;

const scratch = mkdtempSync(join(tmpdir(), "niw2-818-m0-"));
const wordsBySegment = new Map<number, Word[]>();
const batchMs: number[] = [];
let peakRssBytes = 0;
let cliWallMs = 0;
let emptyResults = 0;

try {
  for (let b = 0; b < plan.segments.length; b += batchSize) {
    const batch = plan.segments.slice(b, b + batchSize);
    const files = batch.map((segment) => {
      const path = join(scratch, `s${segment.id}.wav`);
      const from = Math.round((segment.startMs / 1000) * SAMPLE_RATE);
      const to = Math.min(samples.length, Math.round((segment.endMs / 1000) * SAMPLE_RATE));
      writeWav(path, samples.subarray(from, to));
      return path;
    });
    const started = performance.now();
    const run = spawnSync(
      "/usr/bin/time",
      [
        "-l",
        join(runtime, "bin", "sherpa-onnx-offline"),
        `--tokens=${join(model, "tokens.txt")}`,
        `--encoder=${join(model, "encoder.int8.onnx")}`,
        `--decoder=${join(model, "decoder.int8.onnx")}`,
        `--joiner=${join(model, "joiner.int8.onnx")}`,
        "--model-type=nemo_transducer",
        `--num-threads=${threads}`,
        ...files,
      ],
      {
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
        env: { ...process.env, DYLD_LIBRARY_PATH: join(runtime, "lib") },
      },
    );
    const elapsed = performance.now() - started;
    if (run.status !== 0) throw new Error(`CLI exited ${run.status}: ${run.stderr.slice(-400)}`);
    batchMs.push(Math.round(elapsed));
    cliWallMs += elapsed;
    const rss = /(\d+)\s+maximum resident set size/.exec(run.stderr);
    if (rss) peakRssBytes = Math.max(peakRssBytes, Number(rss[1]));
    const lines = run.stdout.split("\n").filter((l) => l.startsWith("{"));
    if (lines.length !== files.length) {
      throw new Error(`expected ${files.length} JSON lines, got ${lines.length}`);
    }
    batch.forEach((segment, i) => {
      const result = JSON.parse(lines[i]!) as CliResult;
      const words = groupTokens(result, segment);
      if (words.length === 0) emptyResults++;
      wordsBySegment.set(segment.id, words);
    });
    for (const file of files) rmSync(file);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const merged = reconcile(plan.segments, plan.seams, wordsBySegment, rule);

// Segments that held speech energy and produced no words.
const levels = frameLevelsDb(samples, 20);
const sortedLevels = Float32Array.from(levels).sort();
const speechThreshold =
  sortedLevels[Math.floor(sortedLevels.length * 0.1)]! + ENERGY_DEFAULTS.marginDb;
const emptyWithSpeech = plan.segments.filter((segment) => {
  if ((wordsBySegment.get(segment.id) ?? []).length > 0) return false;
  const from = Math.floor(segment.startMs / 20);
  const to = Math.floor(segment.endMs / 20);
  let voiced = 0;
  for (let f = from; f < to && f < levels.length; f++) if (levels[f]! > speechThreshold) voiced++;
  return voiced * 20 >= 1000;
}).length;

const metrics: Record<string, unknown> = {
  audio: audioPath.split("/").pop(),
  durationSec: Math.round(durationMs / 1000),
  strategy,
  rule: strategy === "single" ? null : rule,
  batchSize: strategy === "single" ? null : batchSize,
  threads,
  runtime: runtime.split("/").slice(-1)[0],
  segments: plan.segments.length,
  seams: plan.seams.length,
  batches: batchMs.length,
  planMs: Math.round(planMs),
  cliWallSec: Math.round(cliWallMs / 100) / 10,
  realTimeFactor: Math.round((cliWallMs / durationMs) * 1000) / 1000,
  peakRssMB: Math.round(peakRssBytes / 1e6),
  words: merged.length,
  emptyResults,
  emptyWithSpeech,
  meanBatchSec:
    Math.round(batchMs.reduce((a, b) => a + b, 0) / Math.max(1, batchMs.length) / 100) / 10,
};

if (referencePath) {
  const reference = JSON.parse(readFileSync(referencePath, "utf8")) as Word[];
  metrics.vsReference = compareWords(reference, merged);
}
if (truthPath) {
  const truth = (JSON.parse(readFileSync(truthPath, "utf8")) as string[]).map(
    (text) => ({ text }) as Word,
  );
  metrics.vsTruth = compareWords(truth, merged);
}
if (marksPath) {
  metrics.timing = timingError(
    JSON.parse(readFileSync(marksPath, "utf8")) as {
      text: string;
      startMs: number;
      endMs: number;
    }[],
    merged,
  );
}
metrics.adjacentDuplicates = adjacentDuplicates(merged);
if (saveWords) writeFileSync(saveWords, JSON.stringify(merged));

console.log(JSON.stringify(metrics, null, 2));
