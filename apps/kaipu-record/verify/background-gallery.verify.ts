import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { dismissOnboarding, launchApp } from "../e2e/helpers/launch";

/*
 * The background gallery and starter look (NIW2-676), in the real app: a FRESH scene (none, 0/0/0),
 * then `Sunset` picked (on this branch it brings padding 60, corners 10, shadow 64; before it, the
 * pick was invisible), then `Aurora` (one of the eight new presets), and the Balanced MP4 of that
 * scene, whose four corner pixels are sampled with ffmpeg and compared with the preset's paint.
 *
 * The same file runs on the tree below this change: there is no `Aurora` swatch, so that part is
 * skipped and only the "before" shots of the fresh pick are taken.
 *
 * Shots and the exported file go to `test-results/verify/background-gallery/`; numbers are logged as
 * `[verify] background-gallery: ...` lines for the PR.
 */
const NAME = "background-gallery";
const OUT_DIR = path.resolve(__dirname, "..", "test-results", "verify", NAME);
const ASSET_ID = "e2e0a5e7-0000-4000-8000-00000000d676";
const SECONDS = 3;

function fixture(): string {
  const file = path.join(os.tmpdir(), "kaipu-verify-background-gallery-source.mp4");
  if (existsSync(file)) return file;
  const run = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=0x00c800:size=1280x720:rate=30:duration=${SECONDS}`,
      "-vf",
      "drawbox=x=0:y=0:w=160:h=90:color=red:t=fill,format=yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      "12",
      "-pix_fmt",
      "yuv420p",
      file,
    ],
    { encoding: "utf8" },
  );
  if (run.status !== 0) throw new Error(`ffmpeg failed: ${run.stderr}`);
  return file;
}

async function seedVault(vaultDir: string): Promise<void> {
  const meta = path.join(vaultDir, ".kaipu");
  await mkdir(meta, { recursive: true });
  const stem = "Gallery take";
  await copyFile(fixture(), path.join(vaultDir, `${stem}.mp4`));
  await writeFile(
    path.join(meta, `${stem}.json`),
    JSON.stringify({
      sidecarVersion: 2,
      assetId: ASSET_ID,
      title: stem,
      durationSeconds: SECONDS,
      createdAt: 1_700_000_000_000,
    }),
  );
}

async function skipOnboarding(page: Page): Promise<void> {
  await dismissOnboarding(page);
  const gotIt = page.getByRole("button", { name: /Got it/ });
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
}

async function exported(vaultDir: string, extension: string): Promise<string[]> {
  return (await readdir(vaultDir)).filter((f) => f.endsWith(extension)).sort();
}

/** The 0.3 s frame of a video as raw rgb24, through ffmpeg: `pixel(x, y)` samples it. */
function frameOf(file: string, width: number, height: number): (x: number, y: number) => number[] {
  const run = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-ss",
      "0.3",
      "-i",
      file,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-",
    ],
    { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
  );
  if (run.status !== 0 || run.stdout.length < width * height * 3) {
    throw new Error(`ffmpeg failed: ${run.stderr}`);
  }
  return (x, y) => [...run.stdout.subarray((y * width + x) * 3, (y * width + x) * 3 + 3)];
}

function sizeOf(file: string): [number, number] {
  const run = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0",
      file,
    ],
    { encoding: "utf8" },
  );
  const [w, h] = run.stdout.trim().split(",").map(Number);
  return [w!, h!];
}

test("background gallery: the starter look and a new preset, picture and file", async () => {
  test.skip(process.platform === "linux", "WebCodecs H.264 encoding unavailable on Linux");
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  const { page, vaultDir, teardown } = await launchApp({ seedVault, launchAppDir: true });
  const log = (line: string): void => console.log(`[verify] ${NAME}: ${line}`);
  const shot = (name: string): Promise<Buffer> =>
    page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });

  try {
    await skipOnboarding(page);
    await page.evaluate((h) => (location.hash = h), `#/library/${ASSET_ID}`);
    await page.getByRole("button", { name: "Edit video" }).click();
    await page.waitForFunction(() => location.hash.startsWith("#/editor/video/"));
    await page.locator("[data-ui-area='editorVideo.transport']").waitFor({ state: "visible" });
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              document.querySelector<HTMLVideoElement>("[data-ui-area='editorVideo.preview'] video")
                ?.videoWidth ?? 0,
          ),
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0);
    log(`window ${await page.evaluate(() => `${innerWidth}x${innerHeight}`)}`);

    const section = page.locator("[data-ui-area='editorVideo.background']");
    await expect(section).toBeVisible();
    const swatches = section.locator("button[aria-pressed]");
    log(`swatches ${await swatches.count()}`);
    const sliders = async (): Promise<string> =>
      JSON.stringify(
        await Promise.all(
          ["Padding", "Corners", "Shadow"].map((name) =>
            section.getByRole("slider", { name }).inputValue(),
          ),
        ),
      );

    await shot("fresh-scene");
    await section.screenshot({ path: path.join(OUT_DIR, "panel-fresh.png") });
    log(`fresh sliders ${await sliders()}`);

    await section.getByRole("button", { name: "Sunset", exact: true }).click();
    await page.waitForTimeout(600);
    await shot("sunset-picked");
    await section.screenshot({ path: path.join(OUT_DIR, "panel-sunset.png") });
    log(`after Sunset sliders [padding, corners, shadow] ${await sliders()}`);

    const aurora = section.getByRole("button", { name: "Aurora", exact: true });
    if ((await aurora.count()) === 0) {
      log("no Aurora swatch in this build: the new presets are not here");
      return;
    }
    await aurora.click();
    await page.waitForTimeout(600);
    await shot("aurora-picked");
    await section.screenshot({ path: path.join(OUT_DIR, "panel-aurora.png") });
    log(`after Aurora sliders ${await sliders()}`);
    const box = await section.boundingBox();
    const last = await swatches.last().boundingBox();
    log(`panel box ${JSON.stringify(box)} last swatch ${JSON.stringify(last)}`);
    const overflow = await section.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    log(`panel overflow ${JSON.stringify(overflow)}`);

    await page.getByRole("button", { name: "Export", exact: true }).click();
    const sheet = page.getByRole("alertdialog");
    await sheet
      .getByRole("radio", { name: /^Balanced/ })
      .first()
      .click();
    const before = await exported(vaultDir, ".mp4");
    await sheet.getByRole("button", { name: /^Export( |$)/ }).click();
    await expect
      .poll(async () => (await exported(vaultDir, ".mp4")).length, { timeout: 120_000 })
      .toBeGreaterThan(before.length);
    const made = (await exported(vaultDir, ".mp4")).filter((f) => !before.includes(f));
    expect(made).toHaveLength(1);
    const out = path.join(OUT_DIR, "aurora-balanced.mp4");
    await copyFile(path.join(vaultDir, made[0]!), out);
    const [w, h] = sizeOf(out);
    log(`aurora-balanced.mp4 ${w}x${h} (${(await stat(out)).size} bytes)`);
    const pixel = frameOf(out, w, h);
    for (const [name, x, y] of [
      ["top-left", 0, 0],
      ["top-right", w - 1, 0],
      ["bottom-left", 0, h - 1],
      ["bottom-right", w - 1, h - 1],
    ] as const) {
      log(`corner ${name} rgb ${JSON.stringify(pixel(x, y))}`);
    }
    log("paint aurora from #2de2e6 = [45,226,230], to #7b2ff7 = [123,47,247]");
    await page.waitForTimeout(1_500);
  } finally {
    await teardown();
  }
});
