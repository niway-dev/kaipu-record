#!/usr/bin/env bun
/**
 * CLI for `inspectCursorTrack` (src/shared/cursor-track-report.ts): checks a
 * recorded `.cursor.json` sidecar against a video, and optionally renders
 * overlay frames so the recorded cursor position can be eyeballed against the
 * predicted one.
 *
 * Usage:
 *   bun run cursor-track:check <recording-id | path-to.cursor.json> [--vault <dir>] [--frames [n]]
 *
 * See apps/documentation/src/content/docs/testing/cursor-track-check.md.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  parseCursorTrack,
  lastIndexAtOrBefore,
  type CursorTrack,
} from "../src/shared/cursor-track";
import { inspectCursorTrack, type CursorTrackMedia } from "../src/shared/cursor-track-report";

const DEFAULT_VAULT = join(homedir(), "Movies", "Kaipu Record");

interface Args {
  target: string;
  vault: string;
  frames: number | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { target: "", vault: DEFAULT_VAULT, frames: null };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--vault") {
      args.vault = argv[++i];
    } else if (a === "--frames") {
      const next = argv[i + 1];
      if (next !== undefined && /^\d+$/.test(next)) {
        args.frames = Number(next);
        i++;
      } else {
        args.frames = 4;
      }
    } else {
      positional.push(a);
    }
  }
  if (positional.length !== 1) {
    console.error(
      "Usage: bun run cursor-track:check <recording-id | path-to.cursor.json> [--vault <dir>] [--frames [n]]",
    );
    process.exit(2);
  }
  args.target = positional[0];
  return args;
}

interface Resolved {
  id: string;
  cursorPath: string;
  metaPath: string | null;
  mp4Path: string | null;
}

function resolve(args: Args): Resolved {
  if (args.target.endsWith(".cursor.json")) {
    const cursorPath = args.target;
    const id = basename(cursorPath).replace(/\.cursor\.json$/, "");
    const dir = dirname(cursorPath);
    return {
      id,
      cursorPath,
      metaPath: existsSync(join(dir, `${id}.json`)) ? join(dir, `${id}.json`) : null,
      mp4Path: existsSync(join(dir, "..", `${id}.mp4`)) ? join(dir, "..", `${id}.mp4`) : null,
    };
  }
  const id = args.target;
  const cursorPath = join(args.vault, ".kaipu", `${id}.cursor.json`);
  const metaPath = join(args.vault, ".kaipu", `${id}.json`);
  const mp4Path = join(args.vault, `${id}.mp4`);
  return {
    id,
    cursorPath,
    metaPath: existsSync(metaPath) ? metaPath : null,
    mp4Path: existsSync(mp4Path) ? mp4Path : null,
  };
}

function ffprobeMedia(mp4Path: string): CursorTrackMedia | null {
  try {
    const out = Bun.spawnSync([
      "ffprobe",
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      mp4Path,
    ]);
    if (out.exitCode !== 0) return null;
    const json = JSON.parse(out.stdout.toString());
    const stream = json.streams?.[0];
    const durationSec = Number(json.format?.duration);
    if (!stream || !Number.isFinite(durationSec)) return null;
    return { durationMs: durationSec * 1000, width: stream.width, height: stream.height };
  } catch {
    return null;
  }
}

const MARKER = { level: { ok: "✓", warn: "⚠", error: "✗" } } as const;

function pickTimestamps(track: CursorTrack, n: number): number[] {
  if (track.t.length === 0) return [];
  const first = track.t[0];
  const last = track.t[track.t.length - 1];
  if (n <= 1) return [first];
  const step = (last - first) / (n - 1);
  return Array.from({ length: n }, (_, i) => Math.round(first + i * step));
}

function extractFrames(
  id: string,
  track: CursorTrack,
  mp4Path: string,
  vault: string,
  media: CursorTrackMedia,
  n: number,
): void {
  if (!media.width || !media.height) {
    console.log("(--frames: could not determine media width/height, skipping overlays)");
    return;
  }
  const outDir = join(vault, ".kaipu", `${id}.cursor-check`);
  mkdirSync(outDir, { recursive: true });
  const timestamps = pickTimestamps(track, n);
  console.log("");
  console.log("frame overlays (open them: the recorded cursor must be inside every box):");
  for (const atMs of timestamps) {
    const idx = lastIndexAtOrBefore(track.t, atMs);
    const i = idx < 0 ? 0 : idx;
    const px = Math.round(track.x[i] * media.width);
    const py = Math.round(track.y[i] * media.height);
    const outPath = join(outDir, `t${atMs}.png`);
    const box = `drawbox=x=${px - 40}:y=${py - 40}:w=80:h=80:color=red@0.9:t=4`;
    const crop = `crop=480:360:${px - 240}:${py - 180}`;
    const res = Bun.spawnSync([
      "ffmpeg",
      "-y",
      "-ss",
      String(atMs / 1000),
      "-i",
      mp4Path,
      "-vf",
      `${box},${crop}`,
      "-frames:v",
      "1",
      outPath,
    ]);
    if (res.exitCode === 0) {
      console.log(`  ${outPath}`);
    } else {
      console.log(`  (ffmpeg failed for t=${atMs}ms)`);
    }
  }
}

function hasCommand(name: string): boolean {
  const res = Bun.spawnSync(["which", name]);
  return res.exitCode === 0;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const resolved = resolve(args);
  if (!existsSync(resolved.cursorPath)) {
    console.error(`No cursor track at ${resolved.cursorPath}`);
    process.exit(2);
  }
  const raw = readFileSync(resolved.cursorPath, "utf8");
  const track = parseCursorTrack(raw);
  if (!track) {
    console.error(`Failed to parse ${resolved.cursorPath} as a CursorTrack`);
    process.exit(2);
  }

  let media: CursorTrackMedia | null = null;
  let mediaSource = "none";
  if (resolved.mp4Path && hasCommand("ffprobe")) {
    media = ffprobeMedia(resolved.mp4Path);
    if (media) mediaSource = `ffprobe (${resolved.mp4Path})`;
  }
  if (!media && resolved.metaPath) {
    const meta = JSON.parse(readFileSync(resolved.metaPath, "utf8")) as {
      durationSeconds?: number;
    };
    if (typeof meta.durationSeconds === "number") {
      media = { durationMs: meta.durationSeconds * 1000 };
      mediaSource = `meta.durationSeconds (${resolved.metaPath}) — ffprobe unavailable, this is floored`;
    }
  }
  if (!media) mediaSource = "unavailable (no meta, no ffprobe)";

  const report = inspectCursorTrack(track, media ?? undefined);
  console.log(`cursor track: ${resolved.id}`);
  console.log(
    `  samples: ${report.samples}  clicks: ${report.clicks}  size: ${report.bytes} bytes`,
  );
  console.log(`  first: ${report.firstMs ?? "-"} ms  last: ${report.lastMs ?? "-"} ms`);
  console.log(
    `  media duration: ${media?.durationMs !== undefined ? `${media.durationMs} ms` : "-"} (source: ${mediaSource})`,
  );
  console.log("");
  for (const f of report.findings) {
    const marker = MARKER.level[f.level];
    const extra = f.data ? ` ${JSON.stringify(f.data)}` : "";
    console.log(`  ${marker} [${f.code}] ${f.message}${extra}`);
  }
  console.log("");
  console.log(report.ok ? "OK" : "FAILED (error findings present)");

  if (args.frames !== null) {
    if (!resolved.mp4Path) {
      console.log("(--frames: no .mp4 found, skipping overlays)");
    } else if (!hasCommand("ffmpeg")) {
      console.log("(--frames: ffmpeg not on PATH, skipping overlays)");
    } else {
      extractFrames(resolved.id, track, resolved.mp4Path, args.vault, media ?? {}, args.frames);
    }
  }

  process.exit(report.ok ? 0 : 1);
}

main();
