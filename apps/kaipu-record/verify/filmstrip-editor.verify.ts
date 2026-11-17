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
 *   - AC6      no new image is decoded while the take plays (object URLs minted during playback);
 *   - AC7      a continuous scroll (a step every 60 ms, under the 120 ms rest) mints none, and the
 *              tiles are right once the view rests;
 *   - AC12     no tile ever shows an image that is not decoded (checked at every `src` change).
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
const ASSET_ID = "e2e0a5e7-0000-4000-8000-00000000d844";
const NAME = `filmstrip-editor-${SIDE}`;

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
    const imgs = [...document.querySelectorAll<HTMLImageElement>(selector)].filter((img) => {
      const r = img.getBoundingClientRect();
      return r.width > 0 && r.right > 0 && r.left < window.innerWidth;
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
          const imgs = [...document.querySelectorAll<HTMLImageElement>(selector)].filter((img) => {
            const r = img.getBoundingClientRect();
            return r.width > 0 && r.right > 0 && r.left < window.innerWidth;
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

const minted = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { __minted: number }).__minted);

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
      await writeFile(
        path.join(meta, "Long take.json"),
        JSON.stringify({
          sidecarVersion: 2,
          assetId: ASSET_ID,
          title: "Long take",
          durationSeconds: duration,
          createdAt: 1_700_000_000_000,
        }),
      );
    },
  });
  const page = s.page;
  const result: Record<string, unknown> = { side: SIDE, take: TAKE, durationSeconds: duration };
  try {
    await page.addInitScript(() => {
      const w = window as unknown as { __minted: number };
      w.__minted = 0;
      const original = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (obj: Blob | MediaSource) => {
        w.__minted += 1;
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
    const restZoom = await msUntilAllOwn(page, restFrom, 30_000);
    result.ac1ac2Zoom = { msUntilAllOwn: restZoom, tiles: await readTiles(page) };
    await s.shot("zoom-2000");
    await markTiles(page, true);
    await s.shot("zoom-2000-marked");
    await markTiles(page, false);

    // ---- AC1/AC2 again at three places in the take, each one a jump the view then rests on
    const scroller = page.getByTestId("timeline-scroller");
    const jumps: Record<string, unknown>[] = [];
    for (const fraction of [0.5, 0.9, 0.1]) {
      await scroller.evaluate(
        (el, f) => (el.scrollLeft = (el.scrollWidth - el.clientWidth) * f),
        fraction,
      );
      const from = await page.evaluate(() => performance.now());
      const ms = await msUntilAllOwn(page, from, 30_000);
      jumps.push({ fraction, msUntilAllOwn: ms, tiles: await readTiles(page) });
      if (fraction === 0.5) {
        await s.shot("jump-50");
        await markTiles(page, true);
        await s.shot("jump-50-marked");
        await markTiles(page, false);
      }
    }
    result.ac1ac2Jumps = jumps;

    // ---- AC7: a scroll step every 60 ms mints no image while it lasts
    await scroller.evaluate((el) => (el.scrollLeft = (el.scrollWidth - el.clientWidth) * 0.3));
    await msUntilAllOwn(page, await page.evaluate(() => performance.now()), 30_000);
    const mintedBeforeScroll = await minted(page);
    const scrollStart = await page.evaluate(() => performance.now());
    for (let i = 0; i < 25; i++) {
      await scroller.evaluate((el) => (el.scrollLeft += 400));
      await page.waitForTimeout(60);
    }
    const mintedAfterScroll = await minted(page);
    const scrollEnd = await page.evaluate(() => performance.now());
    const restAfterScroll = await msUntilAllOwn(page, scrollEnd, 30_000);
    result.ac7 = {
      scrollMs: Math.round(scrollEnd - scrollStart),
      stepMs: 60,
      mintedDuringScroll: mintedAfterScroll - mintedBeforeScroll,
      msUntilAllOwnAfterRest: restAfterScroll,
    };

    // ---- AC12: no tile ever shows an image that is not decoded
    const swaps = await page.evaluate(
      ({ selector }) =>
        new Promise<{ srcChanges: number; notDecoded: number }>((resolve) => {
          let srcChanges = 0;
          let notDecoded = 0;
          const observer = new MutationObserver((records) => {
            for (const r of records) {
              if (r.attributeName !== "src") continue;
              srcChanges += 1;
              const img = r.target as HTMLImageElement;
              if (!(img.complete && img.naturalWidth > 0)) {
                // A src change is painted on the next frame; give it that frame to decode.
                requestAnimationFrame(() => {
                  if (!(img.complete && img.naturalWidth > 0)) notDecoded += 1;
                });
              }
            }
          });
          for (const img of document.querySelectorAll(selector)) {
            observer.observe(img, { attributes: true, attributeFilter: ["src"] });
          }
          const scroller = document.querySelector<HTMLElement>(
            '[data-testid="timeline-scroller"]',
          )!;
          let i = 0;
          const step = (): void => {
            scroller.scrollLeft += i % 2 === 0 ? 900 : -500;
            i += 1;
            if (i < 12) setTimeout(step, 350);
            else setTimeout(() => resolve({ srcChanges, notDecoded }), 2500);
          };
          step();
        }),
      { selector: TILES },
    );
    result.ac12 = swaps;

    // ---- AC6: play, and nothing is minted while it plays
    await scroller.evaluate((el) => (el.scrollLeft = 0));
    await msUntilAllOwn(page, await page.evaluate(() => performance.now()), 30_000);
    const mintedBeforePlay = await minted(page);
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page.waitForTimeout(4_000);
    const mintedDuringPlay = (await minted(page)) - mintedBeforePlay;
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    result.ac6 = { playMs: 4_000, mintedDuringPlay };
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
    await msUntilAllOwn(page, await page.evaluate(() => performance.now()), 30_000);
    await s.shot("wide");
    await markTiles(page, true);
    await s.shot("wide-marked");
    await markTiles(page, false);
    // The Clips row alone, for the crop.
    await page.locator("[data-ui-area='editorVideo.timeline']").screenshot({
      path: path.join(OUT, `${SIDE}-timeline-crop.png`),
    });
    result.window = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  } finally {
    result.error = result.error ?? null;
    await writeFile(path.join(OUT, `${SIDE}.json`), JSON.stringify(result, null, 2));
    console.log(`[verify] ${NAME}: ${JSON.stringify(result)}`);
    await s.finish();
  }
});
