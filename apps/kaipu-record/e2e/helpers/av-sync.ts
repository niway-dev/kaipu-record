import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * A/V sync measurement for a file with paired events: a white flash in the video and a beep in
 * the audio that start on the same instant (the fixtures in `verify/fixtures/av-sync/`).
 *
 * Both tracks are decoded by ffmpeg, which applies the MP4 edit lists and skips the AAC
 * encoder's priming samples the way players do, so the offset is what a viewer sees.
 * `rawTimeline` ignores the edit lists and shows the packet timeline instead.
 */

/** One `ametadata`/`metadata` print: the frame's presentation time and the printed value. */
export interface TimedValue {
  t: number;
  value: number;
}

/** Parses ffmpeg `metadata=print` / `ametadata=print` output for one key. Pure. */
export function parseMetadataPrint(output: string, key: string): TimedValue[] {
  const escaped = key.replace(/\./g, "\\.");
  const pattern = new RegExp(`pts_time:([-\\d.]+)\\s*\\n${escaped}=(-?[\\w.]+)`, "g");
  const values: TimedValue[] = [];
  for (const match of output.matchAll(pattern)) {
    const raw = match[2]!;
    const value = raw === "-inf" || raw === "inf" ? Number.NEGATIVE_INFINITY : Number(raw);
    values.push({ t: Number(match[1]), value });
  }
  return values;
}

/**
 * Times at which `values` rise above `threshold`, keeping only rises at least `minGapSec` after
 * the previous one (a beep's own envelope ripples stay one event). Pure.
 */
export function risingEdges(values: TimedValue[], threshold: number, minGapSec = 0): number[] {
  const edges: number[] = [];
  let above = false;
  for (const { t, value } of values) {
    const isAbove = value > threshold;
    if (isAbove && !above) {
      const last = edges.at(-1);
      if (last === undefined || t - last >= minGapSec) edges.push(t);
    }
    above = isAbove;
  }
  return edges;
}

/** Flash onsets: frames whose mean luma is above the midpoint between the darkest and brightest frame. */
export function flashOnsets(luma: TimedValue[]): number[] {
  const ys = luma.map((v) => v.value);
  return risingEdges(luma, (Math.min(...ys) + Math.max(...ys)) / 2);
}

/**
 * Beep onsets: the first 0.5 ms window whose RMS level is above half the loudest window's
 * (−6.02 dB). AAC pre-echo before an onset stays far below that, so it does not move the edge.
 */
export function beepOnsets(rmsDb: TimedValue[]): number[] {
  const peak = Math.max(...rmsDb.map((v) => v.value).filter(Number.isFinite));
  return risingEdges(rmsDb, peak - 6.02, 0.5);
}

export interface AvSyncReport {
  flashes: number[];
  beeps: number[];
  /** Audio onset minus video onset per event, in milliseconds. Positive = audio late. */
  offsetsMs: number[];
  videoFrames: number;
  firstVideoSec: number;
  firstAudioSec: number;
  lastAudioSec: number;
}

/** Pairs flashes with beeps in order. Throws when the counts differ: the file lost an event. Pure. */
export function pairEvents(flashes: number[], beeps: number[]): number[] {
  if (flashes.length !== beeps.length || flashes.length === 0) {
    throw new Error(
      `expected one beep per flash, got ${flashes.length} flashes [${flashes.join(", ")}] ` +
        `and ${beeps.length} beeps [${beeps.join(", ")}]`,
    );
  }
  return flashes.map((f, i) => Math.round((beeps[i]! - f) * 10_000) / 10);
}

/** Mean luma per video frame and RMS level per 0.5 ms of audio, both as a player times them. */
async function readLevels(
  file: string,
  rawTimeline: boolean,
): Promise<{ luma: TimedValue[]; rms: TimedValue[] }> {
  const pre = rawTimeline ? ["-ignore_editlist", "1"] : [];
  const big = { maxBuffer: 256 * 1024 * 1024 };
  const video = await run(
    "ffmpeg",
    [
      "-v",
      "error",
      ...pre,
      "-i",
      file,
      "-map",
      "0:v:0",
      "-vf",
      "signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-",
      "-f",
      "null",
      "-",
    ],
    big,
  );
  const audio = await run(
    "ffmpeg",
    [
      "-v",
      "error",
      ...pre,
      "-i",
      file,
      "-map",
      "0:a:0",
      "-af",
      "aformat=sample_fmts=flt:channel_layouts=mono,asetnsamples=n=24:p=0," +
        "astats=metadata=1:reset=1," +
        "ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
      "-f",
      "null",
      "-",
    ],
    big,
  );
  return {
    luma: parseMetadataPrint(video.stdout, "lavfi.signalstats.YAVG"),
    rms: parseMetadataPrint(audio.stdout, "lavfi.astats.Overall.RMS_level"),
  };
}

export async function measureAvSync(
  file: string,
  options: { rawTimeline?: boolean } = {},
): Promise<AvSyncReport> {
  const { luma, rms } = await readLevels(file, options.rawTimeline ?? false);
  const flashes = flashOnsets(luma);
  const beeps = beepOnsets(rms);
  return {
    flashes,
    beeps,
    offsetsMs: pairEvents(flashes, beeps),
    videoFrames: luma.length,
    firstVideoSec: luma[0]?.t ?? Number.NaN,
    firstAudioSec: rms[0]?.t ?? Number.NaN,
    lastAudioSec: rms.at(-1)?.t ?? Number.NaN,
  };
}

export interface AudioStartReport {
  firstVideoSec: number;
  firstAudioSec: number;
  /** The first 0.5 ms window above `thresholdDb`: where a continuous input becomes audible. */
  firstLoudSec: number;
  /** Total time below `thresholdDb` after `firstLoudSec`: gaps inside a continuous input. */
  silentAfterStartMs: number;
  durationVideoSec: number;
}

/**
 * Where the audio of a take fed with a continuous tone starts, and whether it has holes. Pure
 * over the levels, so a recording with dropped samples at the start shows a late `firstLoudSec`
 * and one with dropped samples later shows `silentAfterStartMs`.
 */
export function audioStartFromLevels(
  luma: TimedValue[],
  rms: TimedValue[],
  thresholdDb = -40,
): AudioStartReport {
  const loud = rms.find((v) => v.value > thresholdDb);
  const firstLoudSec = loud?.t ?? Number.NaN;
  // The last 50 ms are the encoder's tail, not the input: leave them out.
  const end = (rms.at(-1)?.t ?? 0) - 0.05;
  const quietWindows = rms.filter((v) => v.t > firstLoudSec && v.t < end && v.value <= thresholdDb);
  return {
    firstVideoSec: luma[0]?.t ?? Number.NaN,
    firstAudioSec: rms[0]?.t ?? Number.NaN,
    firstLoudSec,
    silentAfterStartMs: quietWindows.length * 0.5,
    durationVideoSec: (luma.at(-1)?.t ?? Number.NaN) - (luma[0]?.t ?? Number.NaN),
  };
}

export async function measureAudioStart(file: string): Promise<AudioStartReport> {
  const { luma, rms } = await readLevels(file, false);
  return audioStartFromLevels(luma, rms);
}
