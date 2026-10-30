#!/usr/bin/env bun
/**
 * CLI for `inspectWebcamTrack` (src/shared/webcam-track-report.ts): prints a take's screen and
 * webcam durations, the webcam's start offset and its quality, and its size and fps, from the
 * sidecar's `webcam` entry and ffprobe. The sibling of `cursor-track:check` (ADR 0032).
 *
 * Usage:
 *   bun run webcam-track:check <recording-id> [--vault <dir>]
 *
 * See apps/documentation/src/content/docs/testing/webcam-track-check.md.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { sanitizeWebcamTrackMeta } from "../src/shared/webcam-track";
import { inspectWebcamTrack, type WebcamTrackMedia } from "../src/shared/webcam-track-report";

const DEFAULT_VAULT = join(homedir(), "Movies", "Kaipu Record");

function parseArgs(argv: string[]): { id: string; vault: string } {
  let vault = DEFAULT_VAULT;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--vault") vault = argv[++i] ?? "";
    else positional.push(argv[i]);
  }
  if (positional.length !== 1 || !vault) {
    console.error("Usage: bun run webcam-track:check <recording-id> [--vault <dir>]");
    process.exit(2);
  }
  return { id: positional[0], vault };
}

/** `30/1` or `30000/1001` → frames per second. */
function parseRate(rate: unknown): number | undefined {
  if (typeof rate !== "string") return undefined;
  const [num, den] = rate.split("/").map(Number);
  return num && den ? num / den : undefined;
}

function ffprobe(path: string): WebcamTrackMedia | null {
  try {
    const out = Bun.spawnSync([
      "ffprobe",
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,avg_frame_rate",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      path,
    ]);
    if (out.exitCode !== 0) return null;
    const json = JSON.parse(out.stdout.toString());
    const stream = json.streams?.[0];
    const durationSec = Number(json.format?.duration);
    if (!stream || !Number.isFinite(durationSec)) return null;
    return {
      durationMs: Math.round(durationSec * 1000),
      width: stream.width,
      height: stream.height,
      fps: parseRate(stream.avg_frame_rate),
    };
  } catch {
    return null;
  }
}

const hasCommand = (name: string): boolean => Bun.spawnSync(["which", name]).exitCode === 0;
const ms = (value: number | undefined): string => (value === undefined ? "-" : `${value} ms`);
const MARKER = { warn: "⚠", error: "✗" } as const;

function main(): void {
  const { id, vault } = parseArgs(process.argv.slice(2));
  const metaPath = join(vault, ".kaipu", `${id}.json`);
  const screenPath = join(vault, `${id}.mp4`);
  const webcamPath = join(vault, ".kaipu", `${id}.webcam.mp4`);
  if (!existsSync(metaPath)) {
    console.error(`No sidecar at ${metaPath}`);
    process.exit(2);
  }
  const sidecar = JSON.parse(readFileSync(metaPath, "utf8")) as { webcam?: unknown };
  const meta = sanitizeWebcamTrackMeta(sidecar.webcam);
  const webcamFileExists = existsSync(webcamPath);
  const probe = hasCommand("ffprobe");
  if (!probe) console.log("(ffprobe not on PATH: durations unavailable)");
  const screen = probe && existsSync(screenPath) ? ffprobe(screenPath) : null;
  const webcam = probe && webcamFileExists ? ffprobe(webcamPath) : null;

  const report = inspectWebcamTrack({ meta, webcamFileExists, screen, webcam });
  console.log(`webcam track: ${id}`);
  console.log(`  screen duration: ${ms(screen?.durationMs)}  (${screenPath})`);
  console.log(`  webcam duration: ${ms(webcam?.durationMs)}  (${webcamPath})`);
  console.log(
    `  start offset:    ${meta ? `${meta.startOffsetMs} ms` : "-"}  quality: ${meta?.offsetQuality ?? "-"}`,
  );
  console.log(
    `  webcam size:     ${meta ? `${meta.width}x${meta.height} @ ${meta.fps} fps` : "-"}` +
      (webcam?.width
        ? `  (file: ${webcam.width}x${webcam.height} @ ${webcam.fps ?? "?"} fps)`
        : ""),
  );
  console.log("");
  for (const f of report.findings) {
    const extra = f.data ? ` ${JSON.stringify(f.data)}` : "";
    console.log(`  ${MARKER[f.level]} [${f.code}] ${f.message}${extra}`);
  }
  if (report.findings.length > 0) console.log("");
  console.log(report.ok ? "OK" : "FAILED (error findings present)");
  process.exit(report.ok ? 0 : 1);
}

main();
