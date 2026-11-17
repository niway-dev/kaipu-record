import { execFileSync } from "node:child_process";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { startScenario } from "./helpers";

/*
 * Real-app evidence for NIW2-844 layer 3 (the editor wiring behind `zoom-filmstrip`). Run on the
 * Mac mini only, against the owner's 54-minute take, never on the owner's own machine.
 *
 * One launch per SIDE, picked with KAIPU_VERIFY_SIDE:
 *   before  a build of origin/main (the flag does not exist there): today's Clips row.
 *   off     this branch, flag unset: must draw exactly today's row (AC11).
 *   on      this branch, KAIPU_FLAG_OVERRIDES={"zoom-filmstrip":true}.
 *
 * Each launch opens the take in the editor, zooms to 2,000% and reads the DOM:
 *   - AC1/AC2  every visible Clips tile reads a frame from inside its own span, and how long it
 *              took after the view came to rest (`data-filmstrip-own`, `data-filmstrip-span`);
 *   - AC6      no new image is decoded while the take plays (every `URL.createObjectURL` call the
 *              page makes during playback is counted, the filmstrip's or not);
 *   - AC7      a continuous scroll (a step every 60 ms, under the 120 ms rest) mints none, and the
 *              tiles are right once the view rests;
 *   - AC12     no tile ever shows an image that is not decoded (every tile is sampled on every
 *              animation frame while the view moves and zooms; `src` changes are counted too).
 * AC10 (a workspace switch) and the export half of AC6 are pinned by the unit tests only: the
 * scenario has one workspace and does not export a 54-minute take.
 *
 * `URL.createObjectURL` is wrapped before the page loads to count what the page mints (the opening
 * 24 frames are minted before the first measurement; the worker's frames are minted by the store
 * as they arrive). Output goes to $KAIPU_VERIFY_OUT (outside the worktree: `gh pr create` removes it).
 */
const SIDE = (process.env.KAIPU_VERIFY_SIDE ?? "on") as "before" | "off" | "on";
const EVIDENCE = path.join(homedir(), "kaipu-evidence", "niw2-844");
const TAKE = process.env.KAIPU_VERIFY_TAKE ?? path.join(EVIDENCE, "take", "take-1440p-10gb.mp4");
const OUT = process.env.KAIPU_VERIFY_OUT ?? path.join(EVIDENCE, "layer-3");
const WEBCAM = process.env.KAIPU_VERIFY_WEBCAM === "1";
const WEBCAM_FILE = process.env.KAIPU_VERIFY_WEBCAM_FILE ?? TAKE;
const ASSET_ID = "e2e0a5e7-0000-4000-8000-00000000d844";
const NAME = `filmstrip-editor-${SIDE}`;
/** Only the `on` side has frames of its own time to wait for; the others read the row as it is. */
const WAIT_MS = SIDE === "on" ? 30_000 : 1_000;

declare global {
  interface Window {
    lanesRect(body: HTMLElement): DOMRect;
  }
}

const TILES = "[data-ui-area='editorVideo.timeline'] img";

function probeDuration(file: string): number {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
    { encoding: "utf8" },
  );
  return Math.round(Number(out.trim()) * 1000) / 1000;
}

interface TileReading {
  count: number;
  /** Tiles that read a frame from inside their own span. */
  own: number;
  /** Tiles drawing an image at all. */
  withImage: number;
}

async function readTiles(page: Page): Promise<TileReading> {
  return page.evaluate((selector) => {
    const body = document.querySelector<HTMLElement>('[data-testid="timeline-scroller"]')!;
    const view = window.lanesRect(body);
    const imgs = [...document.querySelectorAll<HTMLImageElement>(selector)].filter((img) => {
      const r = img.getBoundingClientRect();
      return r.width > 0 && r.right > view.left && r.left < view.right;
    });
    return {
      count: imgs.length,
      own: imgs.filter((i) => i.dataset.filmstripOwn === "true").length,
      withImage: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
    };
  }, TILES);
}

/** Milliseconds from `from` until every visible tile reads its own frame, or null on timeout. */
async function msUntilAllOwn(page: Page, from: number, timeoutMs: number): Promise<number | null> {
  return page.evaluate(
    ({ selector, from, timeoutMs }) =>
      new Promise<number | null>((resolve) => {
        const check = (): void => {
          const view = window.lanesRect(
            document.querySelector<HTMLElement>('[data-testid="timeline-scroller"]')!,
          );
          const imgs = [...document.querySelectorAll<HTMLImageElement>(selector)].filter((img) => {
            const r = img.getBoundingClientRect();
            return r.width > 0 && r.right > view.left && r.left < view.right;
          });
          if (imgs.length > 0 && imgs.every((i) => i.dataset.filmstripOwn === "true")) {
            resolve(Math.round(performance.now() - from));
            return;
          }
          if (performance.now() - from > timeoutMs) {
            resolve(null);
            return;
          }
          setTimeout(check, 20);
        };
        check();
      }),
    { selector: TILES, from, timeoutMs },
  );
}

/** Waits until nothing has been minted for `quietMs`: no decode is still delivering frames. */
async function settled(page: Page, quietMs = 800): Promise<void> {
  await page.waitForFunction(
    (quiet) => {
      const times = (window as unknown as { __mintTimes: number[] }).__mintTimes;
      return times.length === 0 || performance.now() - times[times.length - 1] > quiet;
    },
    quietMs,
    { timeout: 60_000, polling: 100 },
  );
}

/** Mint times in `[from, to]`, as offsets from `from` (ms). */
async function mintsBetween(page: Page, from: number, to: number): Promise<number[]> {
  const times = await page.evaluate(
    () => (window as unknown as { __mintTimes: number[] }).__mintTimes,
  );
  return times.filter((t) => t >= from && t <= to).map((t) => Math.round(t - from));
}

/** The visible tiles that do not read a frame of their own time, with where they sit. */
async function notOwnTiles(page: Page): Promise<Record<string, unknown>[]> {
  return page.evaluate((selector) => {
    const body = document.querySelector<HTMLElement>('[data-testid="timeline-scroller"]')!;
    const view = window.lanesRect(body);
    const lane = document
      .querySelector<HTMLElement>("[data-ui-area='editorVideo.timeline'] img")
      ?.parentElement?.getBoundingClientRect();
    return [...document.querySelectorAll<HTMLImageElement>(selector)]
      .filter((img) => {
        const r = img.getBoundingClientRect();
        return r.width > 0 && r.right > view.left && r.left < view.right;
      })
      .filter((img) => img.dataset.filmstripOwn !== "true")
      .map((img) => {
        const r = img.getBoundingClientRect();
        return {
          leftInScroller: Math.round(r.left - view.left),
          rightInScroller: Math.round(r.right - view.left),
          widthPx: Math.round(r.width),
          scrollerWidth: Math.round(view.width),
          laneLeftInScroller: lane ? Math.round(lane.left - view.left) : null,
          span: img.dataset.filmstripSpan ?? null,
          frame: img.dataset.filmstripFrame ?? null,
        };
      });
  }, TILES);
}

/** Outline every tile (green: its own frame, red: not), for the marked shots. */
async function markTiles(page: Page, on: boolean): Promise<void> {
  await page.evaluate(
    ({ on, selector }) => {
      document.getElementById("__mark")?.remove();
      if (!on) return;
      const style = document.createElement("style");
      style.id = "__mark";
      style.textContent = `${selector}{outline:2px solid #ff9f0a !important;outline-offset:-2px}
${selector}[data-filmstrip-own="true"]{outline-color:#30d158 !important}
${selector}[data-filmstrip-own="false"]{outline-color:#ff453a !important}`;
      document.head.append(style);
    },
    { on, selector: TILES },
  );
}

test(`NIW2-844 layer 3: the editor filmstrip, side ${SIDE}`, async () => {
  test.setTimeout(900_000);
  await mkdir(OUT, { recursive: true });
  const duration = probeDuration(TAKE);
  const s = await startScenario(NAME, {
    ...(SIDE === "on" ? { env: { KAIPU_FLAG_OVERRIDES: '{"zoom-filmstrip":true}' } } : {}),
    seedVault: async (dir) => {
      const meta = path.join(dir, ".kaipu");
      await mkdir(meta, { recursive: true });
      await symlink(TAKE, path.join(dir, "Long take.mp4"));
      // A real media file stands in for the camera, with a nonzero start offset.
      if (WEBCAM) await symlink(WEBCAM_FILE, path.join(meta, "Long take.webcam.mp4"));
      await writeFile(
        path.join(meta, "Long take.json"),
        JSON.stringify({
          sidecarVersion: 2,
          assetId: ASSET_ID,
          title: "Long take",
          ...(WEBCAM
            ? {
                webcam: {
                  startOffsetMs: 5000,
                  offsetQuality: "exact",
                  width: WEBCAM_FILE === TAKE ? 2560 : 1280,
                  height: WEBCAM_FILE === TAKE ? 1440 : 720,
                  fps: WEBCAM_FILE === TAKE ? 60 : 30,
                },
              }
            : {}),
          durationSeconds: duration,
          createdAt: 1_700_000_000_000,
        }),
      );
    },
  });
  const page = s.page;
  const result: Record<string, unknown> = {
    side: SIDE,
    take: TAKE,
    durationSeconds: duration,
    webcamOffsetMs: WEBCAM ? 5000 : null,
    webcamFile: WEBCAM ? WEBCAM_FILE : null,
  };
  try {
    await page.addInitScript(() => {
      // The part of the scroller that shows tiles: right of the label column.
      (window as unknown as { lanesRect: (body: HTMLElement) => DOMRect }).lanesRect = (body) => {
        const rect = body.getBoundingClientRect();
        const corner = document.querySelector<HTMLElement>('[data-testid="lane-corner"]');
        const left = corner ? corner.getBoundingClientRect().right : rect.left;
        return new DOMRect(left, rect.top, rect.right - left, rect.height);
      };
      const w = window as unknown as { __minted: number; __mintTimes: number[] };
      w.__minted = 0;
      w.__mintTimes = [];
      const original = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (obj: Blob | MediaSource) => {
        w.__minted += 1;
        w.__mintTimes.push(performance.now());
        return original(obj);
      };
    });
    // The init script applies to later navigations, so load the app again once it is set.
    await page.reload();

    const dialog = page.getByRole("dialog", { name: /Onboarding|Introducción/ });
    if (
      await dialog.waitFor({ state: "visible", timeout: 10_000 }).then(
        () => true,
        () => false,
      )
    ) {
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
    }
    await page.evaluate((h) => (location.hash = h), `#/library/${ASSET_ID}`);
    await page.getByRole("button", { name: /Edit video|Editar video/ }).click();
    await page.waitForFunction(() => location.hash.startsWith("#/editor/video/"));
    await page.waitForSelector("video");
    await page.locator("[data-ui-area='editorVideo.transport']").waitFor({ state: "visible" });
    await expect
      .poll(async () => (await readTiles(page)).withImage, { timeout: 120_000 })
      .toBeGreaterThan(0);
    await s.shot("editor-fit");

    // ---- zoom to 2,000%: five presses of +, then the view rests
    const zoomIn = page.getByRole("button", { name: "Zoom in the timeline", exact: true });
    let restFrom = 0;
    for (let i = 0; i < 5; i++) {
      await zoomIn.click();
      restFrom = await page.evaluate(() => performance.now());
    }
    const zoomed = await page.evaluate(
      () => document.querySelector("[data-ui-area='editorVideo.transport']")?.textContent ?? "",
    );
    result.zoomLabel = /2000\s*%|2\s?000\s*%/.exec(zoomed)?.[0] ?? zoomed.slice(0, 80);
    const restZoom = await msUntilAllOwn(page, restFrom, WAIT_MS);
    result.ac1ac2Zoom = {
      msUntilAllOwn: restZoom,
      tiles: await readTiles(page),
      notOwn: await notOwnTiles(page),
    };
    await s.shot("zoom-2000");
    await markTiles(page, true);
    await s.shot("zoom-2000-marked");
    await markTiles(page, false);

    // ---- AC1/AC2 again at three places in the take, each one a jump the view then rests on
    const scroller = page.getByTestId("timeline-scroller");
    const jumps: Record<string, unknown>[] = [];
    for (const fraction of [0.25, 0.75, 0.97, 0.03]) {
      await scroller.evaluate(
        (el, f) => (el.scrollLeft = (el.scrollWidth - el.clientWidth) * f),
        fraction,
      );
      const from = await page.evaluate(() => performance.now());
      const ms = await msUntilAllOwn(page, from, WAIT_MS);
      const offsets = await mintsBetween(page, from, from + 5_000);
      jumps.push({
        fraction,
        msUntilAllOwn: ms,
        framesMinted: offsets.length,
        firstFrameAtMs: offsets[0] ?? null,
        lastFrameAtMs: offsets[offsets.length - 1] ?? null,
        tiles: await readTiles(page),
        notOwn: await notOwnTiles(page),
      });
      if (fraction === 0.25) {
        await s.shot("jump-25");
        await markTiles(page, true);
        await s.shot("jump-25-marked");
        await markTiles(page, false);
      }
    }
    result.ac1ac2Jumps = jumps;

    // ---- AC7: a scroll step every 60 ms (under the 120 ms rest) starts no decode while it lasts
    await scroller.evaluate((el) => (el.scrollLeft = (el.scrollWidth - el.clientWidth) * 0.3));
    await msUntilAllOwn(page, await page.evaluate(() => performance.now()), WAIT_MS);
    await settled(page);
    const scrollRun = await page.evaluate(
      () =>
        new Promise<{ start: number; end: number; maxGapMs: number }>((resolve) => {
          const body = document.querySelector<HTMLElement>('[data-testid="timeline-scroller"]')!;
          const start = performance.now();
          let last = start;
          let maxGap = 0;
          let i = 0;
          const timer = setInterval(() => {
            const now = performance.now();
            maxGap = Math.max(maxGap, now - last);
            last = now;
            body.scrollLeft += 400;
            i += 1;
            if (i >= 25) {
              clearInterval(timer);
              resolve({ start, end: performance.now(), maxGapMs: Math.round(maxGap) });
            }
          }, 60);
        }),
    );
    const mintTimes = await page.evaluate(
      () => (window as unknown as { __mintTimes: number[] }).__mintTimes,
    );
    const during = mintTimes.filter((t) => t >= scrollRun.start && t <= scrollRun.end);
    const restAfterScroll = await msUntilAllOwn(page, scrollRun.end, WAIT_MS);
    result.ac7 = {
      scrollMs: Math.round(scrollRun.end - scrollRun.start),
      stepMs: 60,
      maxGapBetweenStepsMs: scrollRun.maxGapMs,
      mintedDuringScroll: during.length,
      // Record any unexpected arrivals as offsets for diagnosis.
      mintedAfterFirstStepsMsOffsets: during.map((t) => Math.round(t - scrollRun.start)),
      msUntilAllOwnAfterRest: restAfterScroll,
    };

    // ---- AC12: a tile that showed an image never goes blank while the view moves and zooms
    result.ac12 = await page.evaluate(
      () =>
        new Promise<{ samples: number; srcChanges: number; blankTileSamples: number }>(
          (resolve) => {
            const root = document.querySelector("[data-ui-area='editorVideo.timeline']")!;
            const body = document.querySelector<HTMLElement>('[data-testid="timeline-scroller"]')!;
            const had = new Set<string>();
            let samples = 0;
            let blankTileSamples = 0;
            let srcChanges = 0;
            new MutationObserver((records) => {
              srcChanges += records.filter((r) => r.attributeName === "src").length;
            }).observe(root, { subtree: true, attributes: true, attributeFilter: ["src"] });
            let running = true;
            const sample = (): void => {
              for (const img of root.querySelectorAll<HTMLImageElement>(
                "img[data-filmstrip-span]",
              )) {
                // Keep continuity across React replacing an img in the same lane/clip/span.
                // Separate repeated source spans by their clip's layout position.
                const key = `${img.closest("[data-ui-area]")?.getAttribute("data-ui-area")}:${img.parentElement?.getAttribute("style")}:${img.getAttribute("data-filmstrip-span")}`;
                if (img.complete && img.naturalWidth > 0) had.add(key);
                else if (had.has(key)) blankTileSamples += 1;
              }
              samples += 1;
              if (running) requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
            let i = 0;
            const step = (): void => {
              body.scrollLeft += i % 2 === 0 ? 900 : -500;
              i += 1;
              if (i < 12) setTimeout(step, 350);
              else
                setTimeout(() => {
                  running = false;
                  resolve({ samples, srcChanges, blankTileSamples });
                }, 2500);
            };
            step();
          },
        ),
    );

    // ---- AC6: play, and nothing is minted while it plays
    await scroller.evaluate((el) => (el.scrollLeft = 0));
    await msUntilAllOwn(page, await page.evaluate(() => performance.now()), WAIT_MS);
    await settled(page);
    const playFrom = await page.evaluate(() => performance.now());
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page.waitForTimeout(4_000);
    const playTo = await page.evaluate(() => performance.now());
    const playMints = await mintsBetween(page, playFrom, playTo);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    result.ac6 = {
      playMs: Math.round(playTo - playFrom),
      mintedDuringPlay: playMints.length,
      offsetsMs: playMints,
    };
    await s.shot("after-play");

    // ---- AC11 (off) and the tile count in every side
    result.finalTiles = await readTiles(page);
    result.filmstripAttributes = await page.evaluate(
      () => document.querySelectorAll("[data-filmstrip-frame]").length,
    );

    // ---- a wide window: the default launch size is what every shot above used
    const handle = await s.app.browserWindow(page);
    await handle.evaluate((w) => w.setSize(1800, 1100));
    await page.waitForFunction(() => window.innerWidth === 1800);
    await msUntilAllOwn(page, await page.evaluate(() => performance.now()), WAIT_MS);
    await s.shot("wide");
    await markTiles(page, true);
    await s.shot("wide-marked");
    await markTiles(page, false);
    // The Clips row alone, for the crop.
    await page.locator("[data-ui-area='editorVideo.timeline']").screenshot({
      path: path.join(OUT, `${SIDE}-timeline-crop.png`),
    });
    result.window = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));

    // ---- what each side must show (the numbers above are in the JSON either way)
    if (SIDE === "on") {
      const ac12 = result.ac12 as { blankTileSamples: number };
      const ac7 = result.ac7 as {
        mintedDuringScroll: number;
        msUntilAllOwnAfterRest: number | null;
      };
      const ac6 = result.ac6 as { mintedDuringPlay: number };
      const zoom = result.ac1ac2Zoom as { notOwn: unknown[] };
      expect(restZoom, "AC1: every tile own after the zoom").not.toBeNull();
      expect(restZoom!, "AC1: within 500 ms of the view resting").toBeLessThanOrEqual(500);
      expect(zoom.notOwn, "AC1: no tile reads a frame from outside its span").toEqual([]);
      for (const jump of jumps as { fraction: number; msUntilAllOwn: number | null }[]) {
        expect(jump.msUntilAllOwn, `AC1 after the jump to ${jump.fraction}`).not.toBeNull();
        expect(jump.msUntilAllOwn!).toBeLessThanOrEqual(500);
      }
      expect(ac7.mintedDuringScroll, "AC7: a continuous scroll decodes nothing").toBe(0);
      expect(ac7.msUntilAllOwnAfterRest, "AC7: the tiles are right once it rests").not.toBeNull();
      expect(ac6.mintedDuringPlay, "AC6: nothing decodes while playing").toBe(0);
      expect(ac12.blankTileSamples, "AC12: no tile goes blank").toBe(0);
    } else {
      expect(result.filmstripAttributes, "AC11: today's row carries no filmstrip attribute").toBe(
        0,
      );
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    result.error = result.error ?? null;
    try {
      await writeFile(path.join(OUT, `${SIDE}.json`), JSON.stringify(result, null, 2));
      console.log(`[verify] ${NAME}: ${JSON.stringify(result)}`);
    } finally {
      await s.finish();
    }
  }
});
