/**
 * NIW2-818 M0: how long and how much memory it takes to decode a long recording's audio to
 * 16 kHz mono int16 PCM in a Chromium renderer with mediabunny (WebCodecs), and whether it
 * blocks the main thread. Runs the real `decodeAudioToPcm` from the M1 branch.
 *
 *   bun run.ts --audio-dir <M1 .../features/transcription/audio> --media <file.mp4> \
 *     [--runs 2] [--out /tmp/niw2-818-decode-bench]
 *
 * Prints one JSON object per run. The report carries size and ffprobe numbers only, never
 * the media path or its contents.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type BrowserContext, chromium } from "@playwright/test";
import { startServer } from "./server";

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? process.argv[i + 1] : fallback;
  if (value === undefined) throw new Error(`missing --${name}`);
  return value;
}

const audioDir = resolve(arg("audio-dir"));
const mediaPath = resolve(arg("media"));
const runs = Number(arg("runs", "2"));
const outDir = resolve(arg("out", "/tmp/niw2-818-decode-bench"));

const build = spawnSync(
  "bun",
  [join(import.meta.dir, "build.ts"), "--audio-dir", audioDir, "--out", outDir],
  {
    stdio: "inherit",
  },
);
if (build.status !== 0) throw new Error("bundle build failed");

const probe = spawnSync(
  "ffprobe",
  [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_type,codec_name,sample_rate,channels",
    "-of",
    "json",
    mediaPath,
  ],
  { encoding: "utf8" },
);
const info = JSON.parse(probe.stdout) as {
  format: { duration: string };
  streams: { codec_type: string; codec_name: string; sample_rate?: string; channels?: number }[];
};
const audio = info.streams.find((stream) => stream.codec_type === "audio");
const durationS = Number(info.format.duration);
const sizeBytes = statSync(mediaPath).size;

/** RSS in KB of every process whose command line carries the profile dir (whole Chrome tree). */
function treeRssKb(profileDir: string): number {
  const out = spawnSync("ps", ["-axo", "rss=,command="], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).stdout;
  let total = 0;
  for (const line of out.split("\n")) {
    if (!line.includes(profileDir)) continue;
    total += Number(line.trim().split(/\s+/)[0]);
  }
  return total;
}

function rssKb(pid: number): number {
  const out = spawnSync("ps", ["-o", "rss=", "-p", String(pid)], {
    encoding: "utf8",
  }).stdout.trim();
  return Number(out) || 0;
}

const server = startServer(outDir, mediaPath);
const results: unknown[] = [];
try {
  for (let run = 1; run <= runs; run++) {
    const profileDir = mkdtempSync(join(tmpdir(), "niw2-818-profile-"));
    let context: BrowserContext | undefined;
    let sampler: ReturnType<typeof setInterval> | undefined;
    try {
      context = await chromium.launchPersistentContext(profileDir, {
        channel: "chrome",
        headless: true,
        args: ["--headless=new", "--js-flags=--expose-gc"],
      });
      const browser = context.browser()!;
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(`http://127.0.0.1:${server.port}/`);

      const cdp = await browser.newBrowserCDPSession();
      const info2 = (await cdp.send("SystemInfo.getProcessInfo")) as {
        processInfo: { type: string; id: number }[];
      };
      const renderers = info2.processInfo.filter((p) => p.type === "renderer").map((p) => p.id);

      let peakRendererKb = 0;
      let peakTreeKb = 0;
      const timelineMb: number[] = [];
      sampler = setInterval(() => {
        let now = 0;
        for (const pid of renderers) now = Math.max(now, rssKb(pid));
        peakRendererKb = Math.max(peakRendererKb, now);
        timelineMb.push(Math.round(now / 1024));
        peakTreeKb = Math.max(peakTreeKb, treeRssKb(profileDir));
      }, 100);
      const baselineRendererKb = Math.max(...renderers.map(rssKb));
      const baselineTreeKb = treeRssKb(profileDir);

      const result = await page.evaluate(
        (url) => (window as any).runDecode(url),
        `http://127.0.0.1:${server.port}/media.mp4`,
      );
      clearInterval(sampler);
      // Diagnostic after the timed part: does the memory go away once V8 collects (lazy GC), or
      // stay (retained)? Not part of the timing or the peak.
      const rssBeforeGcKb = Math.max(...renderers.map(rssKb));
      await page.evaluate(() => (globalThis as any).gc?.());
      await new Promise((done) => setTimeout(done, 1500));
      const rssAfterGcKb = Math.max(...renderers.map(rssKb));
      const r = result as {
        wallMs: number;
        decodedMs: number;
        bytes: number;
        peakJsHeapBytes: number | null;
      };
      results.push({
        run,
        chromeVersion: browser.version(),
        rendererPidCount: renderers.length,
        inputDurationS: durationS,
        inputSizeBytes: sizeBytes,
        audio,
        wallSeconds: r.wallMs / 1000,
        decodedAudioSeconds: r.decodedMs / 1000,
        speedupVsRealTime: durationS / (r.wallMs / 1000),
        pcmBytes: r.bytes,
        expectedPcmBytes: durationS * 32000,
        pcmBytesOffSeconds: (r.bytes - durationS * 32000) / 32000,
        baselineRendererRssMb: baselineRendererKb / 1024,
        peakRendererRssMb: peakRendererKb / 1024,
        baselineChromeTreeRssMb: baselineTreeKb / 1024,
        peakChromeTreeRssMb: peakTreeKb / 1024,
        rendererRssAfterDecodeMb: rssBeforeGcKb / 1024,
        rendererRssAfterForcedGcMb: rssAfterGcKb / 1024,
        /** Renderer RSS in MB every 100 ms, thinned to one point per second. */
        rendererRssPerSecondMb: timelineMb.filter((_, i) => i % 10 === 0),
        ...(result as object),
      });
    } finally {
      // A failed run must not leave the sampler ticking or the Chrome profile behind.
      if (sampler) clearInterval(sampler);
      await context?.close();
      rmSync(profileDir, { recursive: true, force: true });
    }
  }
} finally {
  void server.stop(true);
}
for (const r of results) console.log(JSON.stringify(r));
