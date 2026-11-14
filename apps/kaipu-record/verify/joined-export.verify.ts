import { test, expect, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { dismissOnboarding, launchApp, localIdForAssetId } from "../e2e/helpers/launch";
import { ffprobeAvailable } from "../e2e/helpers/ffprobe";
import { ensureFixtures, joinedLetterFilters } from "../ui-catalog/fixtures/make-fixtures";
import { ASSETS, joinedScene, seedCatalogVault } from "../ui-catalog/fixtures/seed-vault";
import { parseSession } from "../src/renderer/src/features/video-editor/session";
import { toLayout } from "../src/renderer/src/features/video-editor/timeline";
import enMessages from "../../../packages/i18n/messages/en.json";

/*
 * Does the MP4 export carry every clip of a scene whose Clips sequence joins another Library
 * recording (NIW2-781, ADR 0058)? Exports the catalog's seeded joined scenes through the real
 * UI, then reads the file back with ffprobe / ffmpeg: duration, size, audio stream, one frame
 * per clip, audio level per span. Nothing here looks at the preview; the file is the evidence.
 *
 * Seeds (ui-catalog/fixtures/seed-vault.ts): "Two recordings" clips A (0-5 s of the opened
 * 12 s recording), B (the whole 7 s joined recording "Checkout bug"), A (5-12 s). The opened
 * recording is dark grey (0x1c1d21); the joined one has a blue ground (0x1d4ed8) and a "B".
 * "Different aspect" joins a 1080x1080 recording; "Missing recording" joins one that is gone.
 */
const NAME = "joined-export";
const OUT_DIR = path.resolve(__dirname, "..", "test-results", "verify", NAME);
const OPENED_SECONDS = 12;
const JOINED_SECONDS = 7;
const run = promisify(execFile);

interface Span {
  label: "A1" | "B" | "A2";
  start: number;
  end: number;
  mid: number;
}

/** The seeded scene's clips on the timeline, from the same layout the editor builds. */
function seededSpans(kind: "present" | "square"): { spans: Span[]; total: number } {
  const session = parseSession(
    JSON.stringify({ version: 2, scene: joinedScene(kind, OPENED_SECONDS) }),
    OPENED_SECONDS,
  );
  if (!session) throw new Error("the seeded joined scene does not parse");
  const layout = toLayout(session.scene.items);
  if (layout.length !== 3) throw new Error(`expected clips A, B, A, got ${layout.length}`);
  const labels = ["A1", "B", "A2"] as const;
  const spans = layout.map((entry, i) => ({
    label: labels[i],
    start: entry.timelineStart,
    end: entry.timelineEnd,
    mid: (entry.timelineStart + entry.timelineEnd) / 2,
  }));
  return { spans, total: layout[2].timelineEnd };
}

async function ffmpegOnPath(): Promise<boolean> {
  try {
    await run("ffmpeg", ["-version"]);
    return true;
  } catch {
    return false;
  }
}

interface ProbeInfo {
  width: number;
  height: number;
  durationSec: number;
  videoDurationSec: number;
  videoCodec: string;
  audioCodec: string | null;
}

async function probe(file: string): Promise<ProbeInfo> {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_streams",
    "-show_format",
    "-of",
    "json",
    file,
  ]);
  const json = JSON.parse(stdout) as {
    streams: Array<{
      codec_type: string;
      codec_name: string;
      width?: number;
      height?: number;
      duration?: string;
    }>;
    format: { duration?: string };
  };
  const video = json.streams.find((s) => s.codec_type === "video");
  const audio = json.streams.find((s) => s.codec_type === "audio");
  if (!video) throw new Error("the exported file has no video stream");
  return {
    width: video.width ?? 0,
    height: video.height ?? 0,
    durationSec: Number(json.format.duration ?? video.duration),
    videoDurationSec: Number(video.duration ?? json.format.duration),
    videoCodec: video.codec_name,
    audioCodec: audio?.codec_name ?? null,
  };
}

/** Extract one PNG frame at `seconds` into OUT_DIR. */
async function extractFrame(mp4: string, seconds: number, name: string): Promise<string> {
  const out = path.join(OUT_DIR, `${name}.png`);
  await run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    seconds.toFixed(3),
    "-i",
    mp4,
    "-frames:v",
    "1",
    out,
  ]);
  return out;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * The average colour of a region of a PNG, as fractions of its size (x, y, w, h in 0..1):
 * ffmpeg crops it and scales it to one pixel, and the raw RGB bytes come back.
 */
async function averageColor(
  png: string,
  region: { x: number; y: number; w: number; h: number },
): Promise<Rgb> {
  const crop = `crop=iw*${region.w}:ih*${region.h}:iw*${region.x}:ih*${region.y}`;
  const { stdout } = await run(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      png,
      "-vf",
      `${crop},scale=1:1:flags=area`,
      "-pix_fmt",
      "rgb24",
      "-f",
      "rawvideo",
      "-",
    ],
    { encoding: "buffer", maxBuffer: 1024 },
  );
  if (stdout.length < 3) throw new Error(`no pixel came back for ${png}`);
  return { r: stdout[0], g: stdout[1], b: stdout[2] };
}

/** Mean level in dB of `[start, start + length)` of a file's audio (ffmpeg volumedetect). */
async function meanDb(file: string, start: number, length: number): Promise<number> {
  const { stderr } = await run("ffmpeg", [
    "-hide_banner",
    "-nostats",
    "-ss",
    start.toFixed(3),
    "-t",
    length.toFixed(3),
    "-i",
    file,
    "-vn",
    "-af",
    "volumedetect",
    "-f",
    "null",
    "-",
  ]);
  const match = /mean_volume:\s*(-?[\d.]+|-inf) dB/.exec(stderr);
  if (!match) throw new Error(`volumedetect printed no mean_volume:\n${stderr.slice(-400)}`);
  return match[1] === "-inf" ? Number.NEGATIVE_INFINITY : Number(match[1]);
}

async function seedWithJoined(vaultDir: string): Promise<void> {
  ensureFixtures();
  await seedCatalogVault(vaultDir, { now: Date.now(), content: "demo", joinedRecordings: true });
}

const OPENED_GROUND = "0x1c1d21";
const JOINED_GROUND = "0x1d4ed8";

/**
 * One recording for the audio-routing proof, in the style of make-fixtures.ts (H.264, one
 * keyframe per second, AAC, faststart). `audio` adds a 440 Hz sine; without it the file has no
 * audio stream at all (`-an`), like a recording made with no microphone.
 */
async function makeRecording(
  out: string,
  opts: { seconds: number; ground: "opened" | "joined"; audio: boolean },
): Promise<void> {
  const opened = opts.ground === "opened";
  const letter = opened ? [] : joinedLetterFilters(1920, 1080);
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${opened ? OPENED_GROUND : JOINED_GROUND}:s=1920x1080:r=30:d=${opts.seconds}`,
  ];
  if (opts.audio) {
    args.push("-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${opts.seconds}`);
  }
  if (letter.length > 0) args.push("-vf", letter.join(","));
  args.push(
    "-t",
    String(opts.seconds),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-threads",
    "1",
    "-pix_fmt",
    "yuv420p",
    "-g",
    "30",
    "-keyint_min",
    "30",
    "-sc_threshold",
    "0",
  );
  if (opts.audio) args.push("-ac", "2", "-c:a", "aac", "-b:a", "64k");
  else args.push("-an");
  args.push("-movflags", "+faststart", out);
  await run("ffmpeg", args);
}

/**
 * The catalog vault, with the media of "Two recordings" (the opened one, 12 s) and "Checkout
 * bug" (the joined one, 7 s) replaced by files made here: one has a sine tone and the other no
 * audio stream. The catalog fixtures stay silent, so no catalog screenshot changes. The sidecars
 * keep their durations (12 and 7); the edit's meta record is rewritten with the new file's size
 * and mtime, which is what the editor checks before it trusts a saved edit.
 */
async function seedAudioRouting(
  vaultDir: string,
  which: "opened-sound" | "joined-sound",
): Promise<void> {
  await seedWithJoined(vaultDir);
  const work = await mkdtemp(path.join(tmpdir(), "kaipu-audio-routing-"));
  try {
    const opened = path.join(work, "opened.mp4");
    const joined = path.join(work, "joined.mp4");
    await makeRecording(opened, {
      seconds: OPENED_SECONDS,
      ground: "opened",
      audio: which === "opened-sound",
    });
    await makeRecording(joined, {
      seconds: JOINED_SECONDS,
      ground: "joined",
      audio: which === "joined-sound",
    });
    await copyFile(opened, path.join(vaultDir, "Two recordings.mp4"));
    await copyFile(joined, path.join(vaultDir, "Checkout bug.mp4"));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  const metaFile = path.join(vaultDir, ".kaipu", "Two recordings.edit.meta.json");
  const meta = JSON.parse(await readFile(metaFile, "utf8")) as Record<string, unknown>;
  const media = await stat(path.join(vaultDir, "Two recordings.mp4"));
  meta.sourceSizeBytes = media.size;
  meta.sourceMtimeMs = media.mtimeMs;
  await writeFile(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
}

/** Open the seeded item in the editor with the video loaded. */
async function openItem(page: Page, assetId: string): Promise<void> {
  await dismissOnboarding(page);
  const gotIt = page.getByRole("button", { name: "Got it" });
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
  await page.evaluate((id) => {
    location.hash = `#/editor/video/${id}`;
  }, assetId);
  await page.waitForFunction(() => location.hash.startsWith("#/editor/video/"));
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect
    .poll(() => page.evaluate(() => document.querySelector("video")?.videoWidth ?? 0), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
}

/** Open the export sheet and press its primary action (default preset). */
async function startExport(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: /^Export( |$)/ })
    .click();
}

/** Launch, export one seeded item with the default preset, keep the MP4 in OUT_DIR. */
async function exportItem(
  assetId: string,
  outName: string,
  seedVault: (vaultDir: string) => Promise<void> = seedWithJoined,
): Promise<string> {
  const launched = await launchApp({ seedVault });
  try {
    await openItem(launched.page, assetId);
    await startExport(launched.page);
    const ready = launched.page.getByRole("region", { name: "Your export is ready" });
    await expect(ready).toBeVisible({ timeout: 240_000 });
    await ready.getByRole("button", { name: /in your Library$/ }).click();
    await expect
      .poll(() => launched.page.evaluate(() => location.hash), { timeout: 15_000 })
      .toMatch(/^#\/library\/.+/);
    const newAssetId = (await launched.page.evaluate(() => location.hash)).replace(
      "#/library/",
      "",
    );
    const newId = await localIdForAssetId(launched.vaultDir, newAssetId);
    const copy = path.join(OUT_DIR, outName);
    await copyFile(path.join(launched.vaultDir, `${newId}.mp4`), copy);
    return copy;
  } finally {
    try {
      await launched.teardown();
    } catch (error) {
      console.error(`[verify] ${NAME}: closing the app failed`, error);
    }
  }
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
});

let twoRecordingsMp4: Promise<string> | null = null;
const twoRecordingsExport = (): Promise<string> => {
  twoRecordingsMp4 ??= exportItem(ASSETS.joinedDemo, "two-recordings.mp4");
  return twoRecordingsMp4;
};

async function requireTools(): Promise<boolean> {
  if (process.platform === "linux") {
    test.skip(true, "WebCodecs H.264 encoding unavailable on Linux");
    return false;
  }
  if (!(await ffprobeAvailable()) || !(await ffmpegOnPath())) {
    test.info().annotations.push({ type: "skip", description: "ffprobe/ffmpeg not on PATH" });
    test.skip(true, "ffprobe/ffmpeg not on PATH");
    return false;
  }
  return true;
}

test("Two recordings exports both recordings in sequence", async () => {
  test.setTimeout(420_000);
  if (!(await requireTools())) return;
  const { spans, total } = seededSpans("present");
  const mp4 = await twoRecordingsExport();
  const info = await probe(mp4);

  // The file is as long as the three clips together (frame and AAC rounding aside).
  expect(info.videoCodec).toBe("h264");
  expect(Math.abs(info.durationSec - total)).toBeLessThan(0.6);
  // The opened recording is 1920x1080.
  expect({ width: info.width, height: info.height }).toEqual({ width: 1920, height: 1080 });
  expect(info.audioCodec, "the export has an audio stream").not.toBeNull();

  // One frame at the middle of each clip. The opened recording is dark grey and the joined one
  // a blue ground, so the average colour of the central half of the frame tells them apart.
  const samples: Record<string, Rgb> = {};
  for (const span of spans) {
    const png = await extractFrame(mp4, span.mid, `frame-${span.label}`);
    samples[span.label] = await averageColor(png, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
  }
  const blueness = (c: Rgb): number => c.b - c.r;
  expect(blueness(samples.A1), "A1 is the grey recording").toBeLessThan(40);
  expect(blueness(samples.A2), "A2 is the grey recording").toBeLessThan(40);
  expect(blueness(samples.B), "B is the blue recording").toBeGreaterThan(100);

  await writeFile(
    path.join(OUT_DIR, "report.json"),
    JSON.stringify({ case: "two-recordings", total, spans, probe: info, samples }, null, 2),
  );
  console.log(
    `[verify] ${NAME}: two-recordings duration=${info.durationSec.toFixed(2)}s (timeline ${total}s) ` +
      `size=${info.width}x${info.height} audio=${info.audioCodec} samples=${JSON.stringify(samples)}`,
  );
});

/**
 * Layer 3 criterion: a recording without an audio track contributes silence for its clips
 * instead of dropping the whole export's audio. Clips A1 and A2 read the opened recording, B
 * the joined one; `which` says which of the two has a sine tone, the other has no audio stream.
 */
async function proveAudioRouting(which: "opened-sound" | "joined-sound"): Promise<void> {
  const { spans, total } = seededSpans("present");
  const mp4 = await exportItem(ASSETS.joinedDemo, `${which}.mp4`, (dir) =>
    seedAudioRouting(dir, which),
  );
  const info = await probe(mp4);
  const means: Record<string, number> = {};
  for (const span of spans) {
    means[span.label] = await meanDb(mp4, span.start + 0.3, span.end - span.start - 0.6);
  }
  // Both cases share one report, keyed by case (the cases run in order in one worker).
  const reportFile = path.join(OUT_DIR, "report-audio-routing.json");
  const previous = await readFile(reportFile, "utf8").catch(() => "{}");
  await writeFile(
    reportFile,
    JSON.stringify(
      { ...JSON.parse(previous), [which]: { total, spans, probe: info, meanDb: means } },
      null,
      2,
    ),
  );
  console.log(
    `[verify] ${NAME}: ${which} probe=${JSON.stringify(info)} meanDb=${JSON.stringify(means)}`,
  );

  expect(info.audioCodec, "the export has an audio stream").not.toBeNull();
  expect(
    Math.abs(info.durationSec - info.videoDurationSec),
    "the audio is as long as the video",
  ).toBeLessThan(0.2);
  const loud = which === "opened-sound" ? (["A1", "A2"] as const) : (["B"] as const);
  const quiet = which === "opened-sound" ? (["B"] as const) : (["A1", "A2"] as const);
  for (const label of loud) expect(means[label], `${label} span is audible`).toBeGreaterThan(-40);
  for (const label of quiet) expect(means[label], `${label} span is silent`).toBeLessThan(-70);
}

test("Two recordings: opened with sound, joined without an audio track", async () => {
  test.setTimeout(420_000);
  if (!(await requireTools())) return;
  await proveAudioRouting("opened-sound");
});

test("Two recordings: opened without an audio track, joined with sound", async () => {
  test.setTimeout(420_000);
  if (!(await requireTools())) return;
  await proveAudioRouting("joined-sound");
});

test("Different aspect fits the square recording inside the 16:9 frame", async () => {
  test.setTimeout(420_000);
  if (!(await requireTools())) return;
  const { spans } = seededSpans("square");
  const mp4 = await exportItem(ASSETS.differentAspectDemo, "different-aspect.mp4");
  const info = await probe(mp4);
  // The output is still the opened recording's 16:9.
  expect({ width: info.width, height: info.height }).toEqual({ width: 1920, height: 1080 });

  const b = spans.find((s) => s.label === "B")!;
  const png = await extractFrame(mp4, b.mid, "frame-square-B");
  // The square is 1080 wide in 1920: bars of 420 px (22%) each side. Sample the far left strip
  // in five vertical tiles, and the centre.
  const tiles: Rgb[] = [];
  for (let i = 0; i < 5; i++) {
    tiles.push(await averageColor(png, { x: 0.01, y: 0.1 + i * 0.16, w: 0.08, h: 0.14 }));
  }
  const centre = await averageColor(png, { x: 0.35, y: 0.3, w: 0.3, h: 0.4 });
  const luma = (c: Rgb): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  for (const tile of tiles) expect(luma(tile), "the bar is dark").toBeLessThan(70);
  const lumas = tiles.map(luma);
  expect(Math.max(...lumas) - Math.min(...lumas), "the bar is uniform").toBeLessThan(12);
  expect(centre.b - centre.r, "the centre is the blue footage").toBeGreaterThan(100);

  await writeFile(
    path.join(OUT_DIR, "report-different-aspect.json"),
    JSON.stringify({ case: "different-aspect", probe: info, tiles, centre }, null, 2),
  );
  console.log(
    `[verify] ${NAME}: different-aspect ${info.width}x${info.height} ` +
      `bar=${JSON.stringify(tiles[0])} centre=${JSON.stringify(centre)}`,
  );
});

test("Missing recording stops the export and names the recording", async () => {
  test.setTimeout(180_000);
  if (process.platform === "linux")
    test.skip(true, "WebCodecs H.264 encoding unavailable on Linux");
  const launched = await launchApp({ seedVault: seedWithJoined });
  try {
    const before = (await readdir(launched.vaultDir)).filter((f) => f.endsWith(".mp4")).sort();
    await openItem(launched.page, ASSETS.joinedMissingDemo);
    await startExport(launched.page);

    const template = (enMessages as { videoEditor: Record<string, string> }).videoEditor
      .exportRecordingMissing;
    // The seed's missing recording is titled "Old standup".
    const message = template.replace("{title}", "Old standup");
    const card = launched.page.locator("[data-ui-area='shell.exportCard']");
    await expect(card).toContainText(message, { timeout: 30_000 });
    await expect(card).toContainText(
      (enMessages as { videoEditor: Record<string, string> }).videoEditor.exportError,
    );
    await card.screenshot({ path: path.join(OUT_DIR, "missing-recording-error-card.png") });
    await launched.page.screenshot({ path: path.join(OUT_DIR, "missing-recording-window.png") });

    // Nothing was written: give a stray encode time to show up, then compare the vault.
    await launched.page.waitForTimeout(3_000);
    const after = (await readdir(launched.vaultDir)).filter((f) => f.endsWith(".mp4")).sort();
    expect(after, "no new MP4 in the vault").toEqual(before);
    await writeFile(
      path.join(OUT_DIR, "report-missing.json"),
      JSON.stringify({ case: "missing-recording", message, before, after }, null, 2),
    );
  } finally {
    try {
      await launched.teardown();
    } catch (error) {
      console.error(`[verify] ${NAME}: closing the app failed`, error);
    }
  }
});
