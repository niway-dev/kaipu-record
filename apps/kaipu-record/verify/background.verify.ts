import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { launchApp } from "../e2e/helpers/launch";

/*
 * Backgrounds (NIW2-668), in the real app: the editor with `none` (today's picture), then with
 * `magenta`, padding 48, corners 16, shadow 24, and every export that carries it — the MP4 at
 * Balanced and at Vertical (Fit), and the GIF — written to
 * `test-results/verify/background/` so a script can sample the real pixels of the files. The GIF
 * is skipped, with a log line, in a build whose export sheet does not offer it (GIF export is on
 * hold in the product); a build that turns `GIF_EXPORT_ENABLED` on proves it too.
 *
 * The same file runs on a tree from before the change (`VERIFY_BACKGROUND=0`: no Background
 * section there, so it only exports the plain scene): the "before" a plain scene must still
 * match frame for frame.
 *
 * The recording is generated with ffmpeg: a flat green 1280×720 frame with a red 160×90 square
 * in its top-left corner, so a sample says which part of the picture it landed on.
 *
 * Numbers are logged as `[verify] background: ...` lines; the PR quotes them.
 */
const NAME = "background";
const OUT_DIR = path.resolve(__dirname, "..", "test-results", "verify", NAME);
const ASSET_ID = "e2e0a5e7-0000-4000-8000-00000000d669";
const SECONDS = 3;
const WITH_BACKGROUND = process.env["VERIFY_BACKGROUND"] !== "0";

function fixture(): string {
  const file = path.join(os.tmpdir(), "kaipu-verify-background-source.mp4");
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
  const stem = "Background take";
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
  const skip = page.getByRole("button", { name: /Skip setup/ });
  if (
    await skip.waitFor({ state: "visible", timeout: 10_000 }).then(
      () => true,
      () => false,
    )
  ) {
    await skip.click();
    await page.getByRole("dialog", { name: /Onboarding/ }).waitFor({ state: "detached" });
  }
  const gotIt = page.getByRole("button", { name: /Got it/ });
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
}

async function exported(vaultDir: string, extension: string): Promise<string[]> {
  return (await readdir(vaultDir)).filter((f) => f.endsWith(extension)).sort();
}

test("background: the editor, the MP4 (Balanced and Vertical) and the GIF", async () => {
  test.skip(process.platform === "linux", "WebCodecs H.264 encoding unavailable on Linux");
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  const { page, vaultDir, teardown } = await launchApp({ seedVault, launchAppDir: true });
  const log = (line: string): void => console.log(`[verify] ${NAME}: ${line}`);
  const shot = (name: string): Promise<Buffer> =>
    page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });

  /** Open the sheet, pick a preset, export, wait for the new file and keep a copy of it. */
  async function exportMp4(label: string, preset: RegExp, fit = false): Promise<void> {
    const before = await exported(vaultDir, ".mp4");
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const sheet = page.getByRole("alertdialog");
    await sheet.getByRole("radio", { name: preset }).first().click();
    if (fit) await sheet.getByRole("radio", { name: /^Fit/ }).click();
    await shot(`sheet-${label}`);
    await sheet.getByRole("button", { name: /^Export( |$)/ }).click();
    await expect
      .poll(async () => (await exported(vaultDir, ".mp4")).length, { timeout: 120_000 })
      .toBeGreaterThan(before.length);
    const made = (await exported(vaultDir, ".mp4")).filter((f) => !before.includes(f));
    expect(made).toHaveLength(1);
    await copyFile(path.join(vaultDir, made[0]!), path.join(OUT_DIR, `${label}.mp4`));
    log(`${label}.mp4 (${(await stat(path.join(OUT_DIR, `${label}.mp4`))).size} bytes)`);
    // Let the "ready" card settle before the next export reaches for the title bar.
    await page.waitForTimeout(1_500);
  }

  async function exportGif(label: string): Promise<void> {
    const before = await exported(vaultDir, ".gif");
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const sheet = page.getByRole("alertdialog");
    await expect(sheet).toBeVisible();
    // GIF export is on hold in the product (`GIF_EXPORT_ENABLED`, owner 2026-10-13): the sheet
    // offers no format choice then. A build that turns it on is the one that can prove the GIF.
    const gif = sheet.getByRole("radio", { name: "GIF" });
    if ((await gif.count()) === 0) {
      log(`${label}.gif skipped: the export sheet offers no GIF in this build (export on hold)`);
      await sheet.getByRole("button", { name: "Cancel" }).click();
      return;
    }
    await gif.click();
    await sheet.getByRole("button", { name: "Export GIF" }).click();
    await expect
      .poll(async () => (await exported(vaultDir, ".gif")).length, { timeout: 120_000 })
      .toBeGreaterThan(before.length);
    const made = (await exported(vaultDir, ".gif")).filter((f) => !before.includes(f));
    expect(made).toHaveLength(1);
    await copyFile(path.join(vaultDir, made[0]!), path.join(OUT_DIR, `${label}.gif`));
    log(`${label}.gif (${(await stat(path.join(OUT_DIR, `${label}.gif`))).size} bytes)`);
    await page.waitForTimeout(1_500);
  }

  async function previewGeometry(label: string): Promise<void> {
    const geometry = await page.evaluate(() => {
      const box = (id: string): number[] | null => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 100) / 100);
      };
      const picture = document.querySelector<HTMLElement>('[data-testid="preview-picture"]');
      return {
        frame: box("preview-frame"),
        picture: box("preview-picture"),
        radius: picture?.style.borderRadius ?? null,
        shadow: picture ? getComputedStyle(picture).boxShadow : null,
      };
    });
    log(`${label} preview ${JSON.stringify(geometry)}`);
  }

  try {
    await skipOnboarding(page);
    await page.evaluate((h) => (location.hash = h), `#/library/${ASSET_ID}`);
    await page.getByRole("button", { name: "Edit video" }).click();
    await page.waitForFunction(() => location.hash.startsWith("#/editor/video/"));
    // The editor's own preview, not the recording page's <video> that is on screen until the
    // route changes.
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
    await shot("editor-plain");
    await previewGeometry("plain");

    // The plain scene: what a build from before the background exports, frame for frame.
    await exportMp4("plain-balanced", /^Balanced/);
    await exportMp4("plain-vertical", /Reels/, true);
    await exportGif("plain");

    if (!WITH_BACKGROUND) return;

    // The sheet offers the plain export again: same preset, same scene.
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const offered = page.getByRole("alertdialog").getByRole("button", {
      name: /Open the existing Balanced file/,
    });
    await expect(offered).toBeVisible();
    log("plain scene: the sheet offers the existing Balanced export");
    await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();

    const section = page.locator("[data-ui-area='editorVideo.background']");
    await expect(section).toBeVisible();
    for (const name of ["Padding", "Corners", "Shadow"]) {
      await expect(section.getByRole("slider", { name })).toBeDisabled();
    }
    await shot("inspector-none");
    await section.getByRole("button", { name: "Magenta", exact: true }).click();
    await section.getByRole("slider", { name: "Padding" }).fill("48");
    await section.getByRole("slider", { name: "Corners" }).fill("16");
    await section.getByRole("slider", { name: "Shadow" }).fill("24");
    await page.waitForTimeout(500);
    await shot("editor-magenta");
    await previewGeometry("magenta");

    // Not offered any more once a background is set: the fingerprint is a different one.
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await expect(
      page
        .getByRole("alertdialog")
        .getByRole("button", { name: /Open the existing Balanced file/ }),
    ).toHaveCount(0);
    log("with a background: the sheet does not offer the plain Balanced export");
    await shot("sheet-no-reuse");
    await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();

    await exportMp4("magenta-balanced", /^Balanced/);
    await exportMp4("magenta-vertical", /Reels/, true);
    await exportGif("magenta");
  } finally {
    await teardown();
  }
});
