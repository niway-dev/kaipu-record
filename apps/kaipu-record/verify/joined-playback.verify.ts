import { test, expect, type Page } from "@playwright/test";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { dismissOnboarding, launchApp } from "../e2e/helpers/launch";
import { ensureFixtures } from "../ui-catalog/fixtures/make-fixtures";
import { ASSETS, joinedScene, seedCatalogVault } from "../ui-catalog/fixtures/seed-vault";
import { parseSession } from "../src/renderer/src/features/video-editor/session";
import { toLayout } from "../src/renderer/src/features/video-editor/timeline";
import { startScenario } from "./helpers";

/*
 * Does the preview stutter when playback crosses a cut from one recording to another joined
 * recording (NIW2-780, ADR 0058)? Opens the catalog's "Two recordings" item (clips A, B, A:
 * the opened recording, the joined one, the opened one again), plays 1.0 s before each cut to
 * 2.5 s after it, and logs every frame each preview `<video>` presents. The numbers are
 * evidence for a human; the only assertion is that both recordings really played.
 *
 * `KAIPU_PROOF_VIDEO=0` skips the window video: the screencast costs CPU and can add stutter
 * of its own, so run once with it (screenshots + video) and once without it (the numbers).
 */
const NAME = "joined-playback";
const OUT_DIR = path.resolve(__dirname, "..", "test-results", "verify", NAME);
/** The opened recording of the seeded item is 12 s long. */
const OPENED_SECONDS = 12;
const LEAD_SECONDS = 1.0;
const TAIL_SECONDS = 2.5;

interface FrameEntry {
  /** `opened` or the joined recording's source id (`data-recording`). */
  el: string;
  now: number;
  mediaTime: number;
  presentedFrames: number;
  presentationTime: number | null;
  /** Was this element the visible one (`style.visibility === "visible"`) when the frame landed. */
  active: boolean;
}
interface RafEntry {
  t: number;
  /** The visible element at this animation frame, or null. */
  visible: string | null;
}
interface Log {
  frames: FrameEntry[];
  raf: RafEntry[];
}

declare global {
  interface Window {
    __frames: FrameEntry[];
    __raf: RafEntry[];
  }
}

/** The saved scene's cuts, in timeline seconds, computed from the seeded layout. */
function seededCuts(): { aToB: number; bToA: number; total: number } {
  const session = parseSession(
    JSON.stringify({ version: 2, scene: joinedScene("present", OPENED_SECONDS) }),
    OPENED_SECONDS,
  );
  if (!session) throw new Error("the seeded joined scene does not parse");
  const layout = toLayout(session.scene.items);
  if (layout.length !== 3) throw new Error(`expected clips A, B, A, got ${layout.length}`);
  return {
    aToB: layout[0].timelineEnd,
    bToA: layout[1].timelineEnd,
    total: layout[2].timelineEnd,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

interface CutSummary {
  switchAtMs: number | null;
  maxGapMs: number;
  medianMs: number;
  stalls: number;
  framesVisible: number;
}

/**
 * Per cut: the instant the visible element changed (first animation frame that shows another
 * element than the one before), the largest gap between consecutive frames presented by the
 * visible element across it (a gap that starts or ends within 250 ms of the switch), the
 * median gap more than 500 ms away from it, and the animation frames where the visible
 * element showed nothing new for longer than twice that median. A freshly shown element
 * counts from the switch itself, because the flip is what put its picture on screen.
 */
function summarize(log: Log): CutSummary {
  const active = log.frames.filter((f) => f.active).sort((a, b) => a.now - b.now);
  let switchAt: number | null = null;
  for (let i = 1; i < log.raf.length; i++) {
    const prev = log.raf[i - 1].visible;
    const next = log.raf[i].visible;
    if (prev !== null && next !== null && prev !== next) {
      switchAt = log.raf[i].t;
      break;
    }
  }
  const gaps = active
    .slice(1)
    .map((f, i) => ({ start: active[i].now, end: f.now, ms: f.now - active[i].now }));
  const near = (g: { start: number; end: number }): boolean =>
    switchAt !== null && g.end >= switchAt - 250 && g.start <= switchAt + 250;
  const away = (g: { start: number; end: number }): boolean =>
    switchAt === null || g.end < switchAt - 500 || g.start > switchAt + 500;
  const medianMs = median(gaps.filter(away).map((g) => g.ms));
  const maxGapMs = Math.max(0, ...gaps.filter(near).map((g) => g.ms));

  const timesOf = new Map<string, number[]>();
  for (const f of [...log.frames].sort((x, y) => x.now - y.now)) {
    timesOf.set(f.el, [...(timesOf.get(f.el) ?? []), f.now]);
  }
  let stalls = 0;
  let lastSwitch = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < log.raf.length; i++) {
    const { t, visible } = log.raf[i];
    if (i > 0 && visible !== log.raf[i - 1].visible) lastSwitch = t;
    if (visible === null) continue;
    const lastFrame = (timesOf.get(visible) ?? []).filter((time) => time <= t).pop();
    if (t - Math.max(lastFrame ?? Number.NEGATIVE_INFINITY, lastSwitch) > 2 * medianMs) stalls += 1;
  }
  return { switchAtMs: switchAt, maxGapMs, medianMs, stalls, framesVisible: active.length };
}

const fmt = (n: number): string => (Number.isFinite(n) ? n.toFixed(1) : "n/a");

async function clockNow(page: Page): Promise<{ now: number; total: number }> {
  const text = await page.locator("[data-ui-area='editorVideo.transport']").evaluate((el) => {
    const time = (el.children[1] as HTMLElement).lastElementChild as HTMLElement;
    return (time.firstElementChild ?? time).textContent ?? "";
  });
  const [a, b] = text.split("/").map((part) => {
    const m = /(\d+):(\d+)\.(\d)/.exec(part.trim());
    if (!m) throw new Error(`cannot read the clock from "${text}"`);
    return Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 10;
  });
  return { now: a, total: b };
}

/** Click the timeline ruler at timeline second `seconds`, then correct once by what the clock says. */
async function seekTo(page: Page, seconds: number): Promise<number> {
  const ruler = page.getByTestId("ruler");
  const click = async (target: number): Promise<number> => {
    const box = await ruler.boundingBox();
    if (!box) throw new Error("ruler not found");
    const { total } = await clockNow(page);
    const x = box.x + (box.width * Math.min(Math.max(target, 0), total)) / total;
    await page.mouse.click(x, box.y + box.height / 2);
    await page.waitForTimeout(400);
    return (await clockNow(page)).now;
  };
  let now = await click(seconds);
  if (Math.abs(now - seconds) > 0.15) now = await click(seconds + (seconds - now));
  // Every preview element settled: no seek in flight.
  await page.waitForFunction(() =>
    [...document.querySelectorAll<HTMLVideoElement>('[data-testid="preview-content"] video')].every(
      (v) => !v.seeking,
    ),
  );
  return now;
}

async function installFrameLogger(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__frames = [];
    window.__raf = [];
    const videos = [
      ...document.querySelectorAll<HTMLVideoElement>('[data-testid="preview-content"] video'),
    ];
    const idOf = (v: HTMLVideoElement): string => v.dataset.recording ?? "opened";
    const isVisible = (v: HTMLVideoElement): boolean => v.style.visibility === "visible";
    for (const video of videos) {
      const watch: VideoFrameRequestCallback = (now, metadata) => {
        window.__frames.push({
          el: idOf(video),
          now,
          mediaTime: metadata.mediaTime,
          presentedFrames: metadata.presentedFrames,
          presentationTime: metadata.presentationTime ?? null,
          active: isVisible(video),
        });
        video.requestVideoFrameCallback(watch);
      };
      video.requestVideoFrameCallback(watch);
    }
    const tick = (t: number): void => {
      const shown = videos.find(isVisible);
      window.__raf.push({ t, visible: shown ? idOf(shown) : null });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function readLog(page: Page): Promise<Log> {
  return page.evaluate(() => ({ frames: window.__frames, raf: window.__raf }));
}

async function clearLog(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__frames.length = 0;
    window.__raf.length = 0;
  });
}

test("joined playback: frame gap at the cuts between two recordings", async () => {
  const cuts = seededCuts();
  console.log(
    `[verify] ${NAME}: layout A→B at ${cuts.aToB}s, B→A at ${cuts.bToA}s, total ${cuts.total}s`,
  );

  const seedVault = async (vaultDir: string): Promise<void> => {
    ensureFixtures();
    await seedCatalogVault(vaultDir, { now: Date.now(), content: "demo", joinedRecordings: true });
  };

  // With the window video by default; without it only the screenshots remain.
  const withVideo = process.env.KAIPU_PROOF_VIDEO !== "0";
  let page: Page;
  let shot: (name: string) => Promise<void>;
  let finish: () => Promise<void>;
  if (withVideo) {
    const scenario = await startScenario(NAME, { seedVault });
    ({ page, shot, finish } = scenario);
  } else {
    await rm(OUT_DIR, { recursive: true, force: true });
    await mkdir(OUT_DIR, { recursive: true });
    const launched = await launchApp({ seedVault });
    page = launched.page;
    let n = 0;
    shot = async (name) => {
      n += 1;
      await page.screenshot({
        path: path.join(OUT_DIR, `${String(n).padStart(2, "0")}-${name}.png`),
      });
    };
    finish = async () => {
      try {
        await launched.teardown();
      } catch (error) {
        console.error(`[verify] ${NAME}: closing the app failed`, error);
      }
      for (const f of (await readdir(OUT_DIR)).sort()) {
        console.log(`[verify] ${NAME}: ${f} (${(await stat(path.join(OUT_DIR, f))).size} bytes)`);
      }
    };
  }
  console.log(`[verify] ${NAME}: window video ${withVideo ? "on" : "off (KAIPU_PROOF_VIDEO=0)"}`);

  try {
    await dismissOnboarding(page);
    const gotIt = page.getByRole("button", { name: "Got it" });
    if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
    await page.evaluate((id) => {
      location.hash = `#/editor/video/${id}`;
    }, ASSETS.joinedDemo);
    await page.waitForFunction(() => location.hash.startsWith("#/editor/video/"));
    const play = page.getByRole("button", { name: "Play", exact: true });
    await expect(play).toBeVisible({ timeout: 30_000 });

    // Both recordings ready: the opened `<video>` and the joined one, each holding a frame.
    const ready = (): Promise<unknown> =>
      page.waitForFunction(
        () => {
          const v = [
            ...document.querySelectorAll<HTMLVideoElement>('[data-testid="preview-content"] video'),
          ];
          return v.length === 2 && v.every((el) => el.readyState >= 2);
        },
        undefined,
        { timeout: 30_000 },
      );
    try {
      await ready();
    } catch {
      // A standby element may only load its first frame once it is primed; seeking primes it.
      const states = await page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLVideoElement>('[data-testid="preview-content"] video'),
        ].map((el) => ({ id: el.dataset.recording ?? "opened", readyState: el.readyState })),
      );
      console.log(`[verify] ${NAME}: not both ready yet ${JSON.stringify(states)}`);
    }

    await installFrameLogger(page);

    const allFrames: FrameEntry[] = [];
    const measure = async (label: string, cutAt: number): Promise<void> => {
      const from = await seekTo(page, cutAt - LEAD_SECONDS);
      await clearLog(page);
      await play.click();
      await page.waitForTimeout((LEAD_SECONDS + TAIL_SECONDS) * 1000);
      await page.getByRole("button", { name: "Pause", exact: true }).click();
      const log = await readLog(page);
      const end = (await clockNow(page)).now;
      const summary = summarize(log);
      allFrames.push(...log.frames);
      await writeFile(
        path.join(OUT_DIR, `frames-${label}.json`),
        JSON.stringify({ cut: label, cutAt, from, end, summary, ...log }, null, 1),
      );
      console.log(
        `[verify] ${NAME}: cut=${label.toUpperCase().replace("-", "→")} ` +
          `maxGapMs=${fmt(summary.maxGapMs)} medianMs=${fmt(summary.medianMs)} stalls=${summary.stalls}`,
      );
      console.log(
        `[verify] ${NAME}: cut=${label} played ${from.toFixed(1)}s→${end.toFixed(1)}s, ` +
          `${summary.framesVisible} visible frames, switch at ${
            summary.switchAtMs === null ? "none seen" : `${fmt(summary.switchAtMs)} ms`
          }`,
      );
    };
    await measure("a-b", cuts.aToB);
    await measure("b-a", cuts.bToA);

    // Paused pictures just before and after each cut, taken after the timed runs so the
    // screenshots cannot disturb the numbers.
    for (const [label, cutAt] of [
      ["a-b", cuts.aToB],
      ["b-a", cuts.bToA],
    ] as const) {
      await seekTo(page, cutAt - 0.3);
      await shot(`before-${label}`);
      await seekTo(page, cutAt + 0.3);
      await shot(`after-${label}`);
    }

    // Both recordings really played: each element presented visible frames, and its
    // presented-frame counter moved.
    const log = { frames: allFrames };
    for (const id of new Set(log.frames.map((f) => f.el))) {
      const own = log.frames.filter((f) => f.el === id && f.active);
      const counters = own.map((f) => f.presentedFrames);
      console.log(
        `[verify] ${NAME}: ${id} presented ${own.length} visible frames ` +
          `(counter ${Math.min(...counters)}→${Math.max(...counters)})`,
      );
      expect(own.length, `${id} presented visible frames`).toBeGreaterThan(5);
      expect(Math.max(...counters), `${id} presented-frame counter moved`).toBeGreaterThan(
        Math.min(...counters),
      );
    }
    expect(new Set(log.frames.filter((f) => f.active).map((f) => f.el)).size).toBe(2);
  } finally {
    await finish();
  }
});
