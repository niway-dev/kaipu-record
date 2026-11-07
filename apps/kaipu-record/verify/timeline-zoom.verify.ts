import { spawnSync } from "node:child_process";
import { existsSync, renameSync, rmSync } from "node:fs";
import { copyFile, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, expect, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { launchApp } from "../e2e/helpers/launch";

/*
 * Timeline zoom (NIW2-667), in the real app: a long recording at 1x, at 4x and at 16x, the
 * transport bar at the editor's 1180 px floor and at 1440 px in English and Spanish, and the
 * proof the maths agrees with the real layout (a click lands the playhead under the pointer, a
 * trim moves by the 4x amount, the wheel zooms around the pointer, playback follows).
 *
 * Self-contained and tolerant of a tree from before the change (no zoom control there): the
 * same file shoots "before" and "after". The recording is generated with ffmpeg (a test card
 * with a running clock, so a frame says which second it is) and cached in the temp dir.
 *
 * Numbers are logged as `[verify] timeline-zoom: ...` lines; the PR quotes them.
 */
const NAME = "timeline-zoom";
const OUT_DIR = path.resolve(__dirname, "..", "test-results", "verify", NAME);
const ASSET_ID = "e2e0a5e7-0000-4000-8000-00000000d667";
const SHORT = 163; // 2:43, the recording the owner uses to try the editor
const LONG = 605; // 10:05, for the widest time label

function fixture(seconds: number): string {
  const file = path.join(os.tmpdir(), `kaipu-verify-long-${seconds}.mp4`);
  if (existsSync(file)) return file;
  // ffmpeg writes to a sibling and the file is renamed into place only when it exits 0, so an
  // interrupted run never leaves a truncated fixture that every later run would reuse. The
  // `.mp4` ending keeps the muxer ffmpeg infers from the extension.
  const part = `${file}.part.mp4`;
  const run = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=size=1280x720:rate=30:duration=${seconds}`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:duration=${seconds}`,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "34",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "48k",
      "-shortest",
      part,
    ],
    { encoding: "utf8" },
  );
  if (run.status !== 0) {
    rmSync(part, { force: true });
    throw new Error(`ffmpeg failed: ${run.stderr}`);
  }
  renameSync(part, file);
  return file;
}

/** A vault with one long recording and a saved edit that puts something on every lane. */
function seedLong(seconds: number): (vaultDir: string) => Promise<void> {
  return async (vaultDir) => {
    const meta = path.join(vaultDir, ".kaipu");
    await mkdir(meta, { recursive: true });
    const stem = "Long take";
    const media = path.join(vaultDir, `${stem}.mp4`);
    await copyFile(fixture(seconds), media);
    await writeFile(
      path.join(meta, `${stem}.json`),
      JSON.stringify({
        sidecarVersion: 2,
        assetId: ASSET_ID,
        title: stem,
        durationSeconds: seconds,
        createdAt: 1_700_000_000_000,
      }),
    );
    await writeFile(
      path.join(meta, `${stem}.edit.json`),
      JSON.stringify({
        version: 1,
        scene: {
          items: [{ id: "clip-1", kind: "clip", sourceStart: 0, sourceEnd: seconds }],
          overlays: [
            {
              id: "box-1",
              kind: "box",
              start: 12,
              end: 40,
              color: "#ff3b6b",
              x: 0.12,
              y: 0.18,
              w: 0.3,
              h: 0.22,
              stroke: 3,
              seed: 7,
            },
          ],
          zoomSegments: [
            {
              id: "zoom-1",
              start: 30,
              end: 46,
              scale: 2,
              smoothing: 70,
              mode: "fixed",
              origin: "manual",
              trigger: null,
              anchor: { x: 0.5, y: 0.5 },
            },
            {
              id: "zoom-2",
              start: 100,
              end: 118,
              scale: 3,
              smoothing: 70,
              mode: "fixed",
              origin: "manual",
              trigger: null,
              anchor: { x: 0.3, y: 0.4 },
            },
          ],
          redactions: [
            {
              id: "blur-1",
              kind: "blur",
              start: 60,
              end: 75,
              rect: { x: 0.55, y: 0.55, w: 0.3, h: 0.2 },
              intensity: 70,
              style: "gaussian",
            },
          ],
          zoomSensitivity: 55,
          audioMuted: false,
          mutedRanges: [
            { id: "mute-1", sourceStart: 20, sourceEnd: 26 },
            { id: "mute-2", sourceStart: 120, sourceEnd: 127 },
          ],
          webcam: null,
        },
      }),
    );
    const source = await stat(media);
    await writeFile(
      path.join(meta, `${stem}.edit.meta.json`),
      JSON.stringify({
        sourceSizeBytes: source.size,
        sourceMtimeMs: source.mtimeMs,
        assetIds: [],
        savedAt: 1_700_000_000_000 + 3_600_000,
        exportedSavedAt: null,
      }),
    );
  };
}

async function sizeWindow(
  app: ElectronApplication,
  page: Page,
  [width, height]: [number, number],
): Promise<void> {
  const handle = await app.browserWindow(page);
  await handle.evaluate((w, [wd, ht]) => w.setSize(wd, ht), [width, height]);
  await page.waitForFunction((wd) => window.innerWidth === wd, width);
}

async function openEditor(page: Page): Promise<void> {
  // The e2e helper only knows the English labels; this scenario also runs in Spanish.
  const skip = page.getByRole("button", { name: /Skip setup|Omitir configuración/ });
  if (
    await skip.waitFor({ state: "visible", timeout: 10_000 }).then(
      () => true,
      () => false,
    )
  ) {
    await skip.click();
    await page
      .getByRole("dialog", { name: /Onboarding|Introducción/ })
      .waitFor({ state: "detached" });
  }
  const gotIt = page.getByRole("button", { name: /Got it|Entendido/ });
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
  await page.evaluate((h) => (location.hash = h), `#/library/${ASSET_ID}`);
  await page.getByRole("button", { name: /Edit video|Editar video/ }).click();
  await page.waitForFunction(() => location.hash.startsWith("#/editor/video/"));
  await page.waitForSelector("video");
  await page.locator("[data-ui-area='editorVideo.transport']").waitFor({ state: "visible" });
}

const ZOOM_IN = /Zoom in the timeline|Acercar la línea de tiempo/;
const FIT = /Fit the whole recording|Ajustar toda la grabación/;

async function readNumbers(bar: Locator): Promise<string> {
  return bar.evaluate((el) => {
    const [left, centre, right] = Array.from(el.children) as HTMLElement[];
    const time = centre.lastElementChild as HTMLElement;
    const buttons = Array.from(right.children) as HTMLElement[];
    const first = buttons[0].getBoundingClientRect();
    const rightBox = right.getBoundingClientRect();
    const t = time.getBoundingClientRect();
    const slider = el.querySelector<HTMLElement>("input[type='range']");
    const sliderBox = slider?.getBoundingClientRect();
    const shown = (node: Element | null | undefined): boolean | null =>
      node ? getComputedStyle(node).display !== "none" : null;
    const buttons2 = Array.from(right.querySelectorAll("button")) as HTMLElement[];
    const fitButton = buttons2.find((b) => /^(FIT|Fit|Ajustar)$/.test(b.textContent ?? ""));
    const leftBox = left.getBoundingClientRect();
    return JSON.stringify({
      barWidth: Math.round(el.getBoundingClientRect().width),
      rightColumn: Math.round(rightBox.width),
      rightCluster: Math.round(rightBox.right - first.left),
      timeLabel: Math.round(t.width),
      // Negative = clear space between the label and the first right-hand button.
      overlap: Math.round(t.right - first.left),
      oneLine: Math.round(el.getBoundingClientRect().height),
      sliderShown: shown(slider),
      sliderWidth: sliderBox ? Math.round(sliderBox.width) : null,
      fitShown: shown(fitButton),
      totalShown: shown(time.firstElementChild)
        ? getComputedStyle(time.firstElementChild!).position !== "absolute"
        : null,
      leftColumn: Math.round(leftBox.width),
      leftClipped: left.scrollWidth - left.clientWidth,
    });
  });
}

const timeText = (page: Page): Promise<string> =>
  page.locator("[data-ui-area='editorVideo.transport']").evaluate((el) => {
    const time = (el.children[1] as HTMLElement).lastElementChild as HTMLElement;
    return (time.firstElementChild ?? time).textContent ?? "";
  });

function parseClock(text: string): { now: number; total: number } {
  const [a, b] = text.split("/").map((part) => {
    const m = /(\d+):(\d+)\.(\d)/.exec(part.trim())!;
    return Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 10;
  });
  return { now: a, total: b };
}

for (const locale of ["en", "es"] as const) {
  test(`timeline zoom: transport bar widths and shots in ${locale}`, async () => {
    await mkdir(OUT_DIR, { recursive: true });
    for (const f of await readdir(OUT_DIR)) {
      if (f.startsWith(`${locale}-`)) await rm(path.join(OUT_DIR, f));
    }
    const { app, page, teardown } = await launchApp({
      settings: { locale },
      seedVault: seedLong(LONG),
    });
    try {
      await openEditor(page);
      const bar = page.locator("[data-ui-area='editorVideo.transport']");
      const footer = page.locator("[data-ui-area='editorVideo.timeline']");
      const hasZoom = (await page.getByRole("button", { name: ZOOM_IN }).count()) > 0;

      const shot = async (name: string, size?: [number, number]): Promise<void> => {
        if (size) await sizeWindow(app, page, size);
        await page.waitForTimeout(900);
        await page.screenshot({ path: path.join(OUT_DIR, `${locale}-${name}-window.png`) });
        await bar.screenshot({ path: path.join(OUT_DIR, `${locale}-${name}-bar.png`) });
        await footer.screenshot({ path: path.join(OUT_DIR, `${locale}-${name}-timeline.png`) });
        console.log(
          `[verify] ${NAME}: ${locale} ${name} ${await readNumbers(bar)} zoom=${hasZoom}`,
        );
      };

      // 10:05 recording, both counts (2 zooms, 1 privacy region): the widest bar there is.
      await shot("default");
      for (const width of [1440, 1180, 1280, 1366, 1536, 1600, 1920]) {
        await shot(String(width), [width, 900]);
      }
    } finally {
      try {
        await teardown();
      } catch (error) {
        console.error(`[verify] ${NAME}: closing the app failed`, error);
      }
    }
  });
}

test("timeline zoom: a 2:43 recording at 1x, 4x and 16x, and the pointer lands on the right time", async () => {
  await mkdir(OUT_DIR, { recursive: true });
  for (const f of await readdir(OUT_DIR)) {
    if (f.startsWith("walk-")) await rm(path.join(OUT_DIR, f));
  }
  const { app, page, teardown } = await launchApp({ seedVault: seedLong(SHORT) });
  try {
    await openEditor(page);
    await sizeWindow(app, page, [1440, 900]);
    const bar = page.locator("[data-ui-area='editorVideo.transport']");
    const footer = page.locator("[data-ui-area='editorVideo.timeline']");
    const scroller = page.getByTestId("timeline-scroller");
    const hasZoom = (await page.getByRole("button", { name: ZOOM_IN }).count()) > 0;

    const shoot = async (name: string): Promise<void> => {
      await page.waitForTimeout(900);
      await page.screenshot({ path: path.join(OUT_DIR, `walk-${name}-window.png`) });
      await footer.screenshot({ path: path.join(OUT_DIR, `walk-${name}-timeline.png`) });
      await bar.screenshot({ path: path.join(OUT_DIR, `walk-${name}-bar.png`) });
    };

    await shoot("1x");
    // At fit the timeline must be laid out exactly as before zoom existed: the same lane
    // edges and the same footer height, before and after (compare the two runs' numbers).
    console.log(
      `[verify] ${NAME}: walk 1x layout ${JSON.stringify(
        await page.evaluate(() => {
          const ruler = document.querySelector('[data-testid="ruler"]')!.getBoundingClientRect();
          const footerBox = document
            .querySelector("[data-ui-area='editorVideo.timeline']")!
            .getBoundingClientRect();
          const labels = Array.from(
            document.querySelectorAll("[data-ui-area='editorVideo.timeline'] span"),
          )
            .filter((el) => el.querySelector("svg") && el.textContent)
            .map((el) => Math.round(el.getBoundingClientRect().left));
          return {
            laneLeft: Number(ruler.left.toFixed(2)),
            laneRight: Number(ruler.right.toFixed(2)),
            footerHeight: Math.round(footerBox.height),
            labelLefts: labels,
          };
        }),
      )}`,
    );
    if (!hasZoom) {
      console.log(`[verify] ${NAME}: walk no zoom control in this tree (before)`);
      return;
    }

    // The real geometry, read from the DOM: where the lane starts, how wide the content is,
    // how far it is scrolled. Independent of the app's own view state.
    const geometry = async (): Promise<{
      laneLeft: number;
      scale: number;
      scroll: number;
      laneWidth: number;
      zoom: number;
      duration: number;
    }> =>
      page.evaluate(() => {
        const body = document.querySelector<HTMLElement>('[data-testid="timeline-scroller"]')!;
        const ruler = document.querySelector<HTMLElement>('[data-testid="ruler"]')!;
        const rect = ruler.getBoundingClientRect();
        const time = document.querySelector("[data-ui-area='editorVideo.transport']")!.children[1]
          .lastElementChild!.textContent!;
        const total = /\/\s*(\d+):(\d+)\.(\d)/.exec(time)!;
        const duration = Number(total[1]) * 60 + Number(total[2]) + Number(total[3]) / 10;
        const bodyRect = body.getBoundingClientRect();
        const laneLeft = bodyRect.left + (rect.left - bodyRect.left + body.scrollLeft);
        return {
          laneLeft,
          scale: rect.width / duration,
          scroll: body.scrollLeft,
          laneWidth: body.clientWidth - (laneLeft - bodyRect.left),
          zoom: Number(body.dataset.zoom),
          duration,
        };
      });

    const playheadX = (): Promise<number> =>
      page.evaluate(() => {
        const layer = document.querySelector('[data-testid="timeline-scroller"] > div:last-child')!;
        const head = layer.lastElementChild as HTMLElement;
        return head.getBoundingClientRect().left + 1; // the 2 px line's centre
      });

    // --- 4x ---------------------------------------------------------------------------
    for (let i = 0; i < 4; i++) await page.getByRole("button", { name: ZOOM_IN }).click();
    await shoot("4x");
    const g4 = await geometry();
    console.log(`[verify] ${NAME}: walk 4x geometry ${JSON.stringify(g4)}`);

    const rulerBox = (await page.getByTestId("ruler").boundingBox())!;
    const y = rulerBox.y + rulerBox.height / 2;
    const checks: { name: string; pointer: number; expected: number; got: number; head: number }[] =
      [];
    const click = async (name: string, x: number): Promise<void> => {
      const g = await geometry();
      await page.mouse.click(x, y);
      await page.waitForTimeout(250);
      const clock = parseClock(await timeText(page));
      const expected = (x - g.laneLeft + g.scroll) / g.scale;
      checks.push({
        name,
        pointer: Math.round(x),
        expected: Number(expected.toFixed(2)),
        got: clock.now,
        head: Math.round(await playheadX()),
      });
    };
    const bodyBox = (await scroller.boundingBox())!;
    const visibleLeft = g4.laneLeft;
    await click("4x scroll centre-left", visibleLeft + 120);
    await click("4x scroll centre-right", visibleLeft + g4.laneWidth - 90);
    // Scrolled well off zero, then again.
    await scroller.evaluate((el) => (el.scrollLeft = 1700));
    await page.waitForTimeout(200);
    await click("4x scroll 1700", visibleLeft + 400);
    await scroller.evaluate((el) => (el.scrollLeft = el.scrollWidth));
    await page.waitForTimeout(200);
    await click("4x scroll max", visibleLeft + g4.laneWidth - 40);
    for (const c of checks) {
      console.log(`[verify] ${NAME}: walk click ${JSON.stringify(c)}`);
      // Under the pointer to a tenth (the clock shows tenths) and the playhead line on it.
      expect(Math.abs(c.got - c.expected)).toBeLessThanOrEqual(0.15);
      expect(Math.abs(c.head - c.pointer)).toBeLessThanOrEqual(3);
    }

    // --- a trim at 4x ------------------------------------------------------------------
    // Select the clip by a click in view (a locator click would scroll its centre into view
    // and take the end of the clip out of it), then scroll to the end where the handle is.
    await scroller.evaluate((el) => (el.scrollLeft = 0));
    await page.waitForTimeout(250);
    const clipBox = (await footer.locator("button").first().boundingBox())!;
    await page.mouse.click(visibleLeft + 80, clipBox.y + clipBox.height / 2);
    const end = page.locator('[data-trim-handle="end"]');
    await end.waitFor({ state: "attached" });
    await scroller.evaluate((el) => (el.scrollLeft = el.scrollWidth));
    await page.waitForTimeout(250);
    await end.waitFor({ state: "visible" });
    const before = parseClock(await timeText(page)).total;
    const handle = (await end.boundingBox())!;
    const hx = handle.x + handle.width / 2;
    const hy = handle.y + handle.height / 2;
    const g = await geometry();
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await page.mouse.move(hx - 120, hy, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const after = parseClock(await timeText(page)).total;
    const expectedDelta = 120 / g.scale;
    console.log(
      `[verify] ${NAME}: walk trim ${JSON.stringify({
        pixels: 120,
        scale: Number(g.scale.toFixed(2)),
        before,
        after,
        movedBy: Number((before - after).toFixed(2)),
        expectedBy: Number(expectedDelta.toFixed(2)),
        at1xItWouldBe: Number((120 / (g.laneWidth / g.duration)).toFixed(2)),
      })}`,
    );
    expect(Math.abs(before - after - expectedDelta)).toBeLessThanOrEqual(0.3);
    await page.keyboard.press("Control+z").catch(() => {});
    await page.keyboard.press("Meta+z").catch(() => {});

    // --- the wheel zooms around the pointer ------------------------------------------------
    await page.getByRole("button", { name: FIT }).click();
    await page.getByRole("button", { name: ZOOM_IN }).click();
    const wx = bodyBox.x + 500;
    const gw0 = await geometry();
    const t0 = (wx - gw0.laneLeft + gw0.scroll) / gw0.scale;
    await page.mouse.move(wx, y);
    await page.keyboard.down("Meta");
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -40);
    await page.keyboard.up("Meta");
    await page.waitForTimeout(300);
    const gw1 = await geometry();
    const t1 = (wx - gw1.laneLeft + gw1.scroll) / gw1.scale;
    console.log(
      `[verify] ${NAME}: walk wheel ${JSON.stringify({
        zoomBefore: Number(gw0.zoom.toFixed(2)),
        zoomAfter: Number(gw1.zoom.toFixed(2)),
        timeUnderPointerBefore: Number(t0.toFixed(2)),
        timeUnderPointerAfter: Number(t1.toFixed(2)),
      })}`,
    );
    expect(gw1.zoom).toBeGreaterThan(gw0.zoom + 0.5);
    expect(Math.abs(t1 - t0)).toBeLessThanOrEqual(0.3);

    // --- follow while playing ----------------------------------------------------------------
    await page.getByRole("button", { name: FIT }).click();
    for (let i = 0; i < 4; i++) await page.getByRole("button", { name: ZOOM_IN }).click();
    await scroller.evaluate((el) => (el.scrollLeft = 0));
    await page.waitForTimeout(250);
    const g5 = await geometry();
    // Put the playhead just left of the 80% mark, then play.
    await page.mouse.click(g5.laneLeft + g5.laneWidth * 0.74, y);
    await page.waitForTimeout(200);
    const startScroll = (await geometry()).scroll;
    await page.getByRole("button", { name: /^(Play|Reproducir)$/ }).click();
    await page.waitForTimeout(6500);
    const g6 = await geometry();
    const headNow = await playheadX();
    console.log(
      `[verify] ${NAME}: walk follow ${JSON.stringify({
        scrollBefore: Math.round(startScroll),
        scrollAfter: Math.round(g6.scroll),
        playheadXAfter: Math.round(headNow),
        laneLeft: Math.round(g6.laneLeft),
        laneRight: Math.round(g6.laneLeft + g6.laneWidth),
      })}`,
    );
    await page.getByRole("button", { name: /^(Pause|Pausar)$/ }).click();
    expect(g6.scroll).toBeGreaterThan(startScroll + 50);
    expect(headNow).toBeGreaterThanOrEqual(g6.laneLeft - 2);
    expect(headNow).toBeLessThanOrEqual(g6.laneLeft + g6.laneWidth + 2);
    await shoot("4x-following");

    // --- 16x ---------------------------------------------------------------------------------
    await page.getByRole("button", { name: FIT }).click();
    for (let i = 0; i < 8; i++) await page.getByRole("button", { name: ZOOM_IN }).click();
    await scroller.evaluate((el) => (el.scrollLeft = el.scrollWidth * 0.4));
    await shoot("16x");
    const tiles = await footer.locator("img").count();
    console.log(
      `[verify] ${NAME}: walk 16x ${JSON.stringify({ zoom: (await geometry()).zoom, tiles })}`,
    );
    // Back to 1x: the editor must look as it did before.
    await page.getByRole("button", { name: FIT }).click();
    await shoot("fit-again");
  } finally {
    try {
      await teardown();
    } catch (error) {
      console.error(`[verify] ${NAME}: closing the app failed`, error);
    }
    for (const f of (await readdir(OUT_DIR)).sort()) {
      console.log(`[verify] ${NAME}: ${f} (${(await stat(path.join(OUT_DIR, f))).size} bytes)`);
    }
  }
});
