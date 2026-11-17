import { execFileSync } from "node:child_process";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { startScenario } from "./helpers";

/*
 * Where the 500 ms of AC1 goes (NIW2-844 layer 3). Run on the Mac mini only, against the owner's
 * 54-minute take, with `zoom-filmstrip` on. It opens the take, zooms to 2,000% (the first zoom
 * after editor-open prewarming), then jumps to ten places in the take, each one
 * waiting for the previous request to settle (WARM requests), then once more after the file has
 * closed for being idle.
 *
 * Every number comes from timestamps taken inside the page, never from a poll over CDP:
 *   - the worker is wrapped before the page loads: each `postMessage` and every message that comes
 *     back is stamped on arrival (`ev`), and a frame carries the worker's own `decodeMs`/`encodeMs`;
 *   - a MutationObserver stamps every tile `src` swap, so "mint to swap" is the publish throttle,
 *     the React commit and `img.decode()` together;
 *   - `scroll` and `click` are stamped in the capture phase: the last one before the first request
 *     is where the view came to rest.
 * An engine built with the debug patch also posts `debug` messages (request received, file ready,
 * slots planned, pass start) and stamps each frame with the worker's clock; without it those
 * stages are reported as null. The patch is not part of the product.
 *
 * Output: $KAIPU_VERIFY_OUT/<label>.json (default latency.json) (outside the worktree: `gh pr create` removes it).
 */
const EVIDENCE = path.join(homedir(), "kaipu-evidence", "niw2-844");
const TAKE = process.env.KAIPU_VERIFY_TAKE ?? path.join(EVIDENCE, "take", "take-1440p-10gb.mp4");
const OUT = process.env.KAIPU_VERIFY_OUT ?? path.join(EVIDENCE, "layer-3");
const LABEL = process.env.KAIPU_VERIFY_LABEL ?? "latency";
const WEBCAM = process.env.KAIPU_VERIFY_WEBCAM === "1";
const WEBCAM_FILE = process.env.KAIPU_VERIFY_WEBCAM_FILE ?? TAKE;
const ASSET_ID = "e2e0a5e7-0000-4000-8000-00000000d844";
const JUMPS = [0.12, 0.31, 0.47, 0.58, 0.66, 0.83, 0.9, 0.18, 0.4, 0.72];
const BUDGET_MS = 500;

interface Ev {
  t: number;
  k: string;
  [key: string]: unknown;
}

function probeDuration(file: string): number {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
    { encoding: "utf8" },
  );
  return Math.round(Number(out.trim()) * 1000) / 1000;
}

const r1 = (n: number): number => Math.round(n * 10) / 10;
const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return r1(s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};

/** Everything one measurement window says, relative to the moment the view came to rest. */
function analyse(evs: Ev[], label: string, origin: number, visibleAtEnd: number[]) {
  const iMark = evs.findIndex((e) => e.k === "mark" && e.label === label);
  const mark = evs[iMark];
  const next = evs.findIndex((e, i) => i > iMark && e.k === "mark");
  const win = evs.slice(iMark + 1, next < 0 ? undefined : next);
  const abs = (at: unknown): number => (at as number) - origin; // worker clock to page clock
  const requests = win.filter((e) => e.k === "post" && e.type === "request");
  const first = requests[0];
  if (!first) {
    // Nothing was asked for: the margin of an earlier request already covers this place. The tiles
    // are timed from the last scroll or click, by the swaps the page made.
    const lastInput = [...win].filter((e) => e.k === "scroll" || e.k === "click").pop();
    const t0 = lastInput?.t ?? mark.t;
    const own = (mark.own ?? {}) as Record<string, string>;
    const at = visibleAtEnd.map((tid) => {
      let since: number | null = own[tid] === "true" ? 0 : null;
      for (const e of win.filter((x) => x.k === "swap" && x.id === tid)) {
        if (e.own === "true") since = since ?? r1(Math.max(0, e.t - t0));
        else since = null;
      }
      return since;
    });
    const known = at.filter((v): v is number => v !== null);
    return {
      label,
      noRequest: true,
      tiles: visibleAtEnd.length,
      allOwnAtMs: known.length === at.length ? Math.max(...known) : null,
      withinBudget: known.filter((v) => v <= BUDGET_MS).length,
    };
  }
  const rest = [...win]
    .filter((e) => (e.k === "scroll" || e.k === "click") && e.t <= first.t)
    .pop();
  const t0 = rest?.t ?? first.t;
  const rel = (t: number): number => r1(t - t0);
  const id = first.requestId;
  const dbg = (what: string): Ev | undefined =>
    win.find((e) => e.k === "msg" && e.type === "debug" && e.what === what && e.requestId === id);
  const recv = dbg("recv");
  const ready = dbg("ready");
  const planned = dbg("planned");
  const frames = win.filter((e) => e.k === "msg" && e.type === "frame" && e.requestId === id);
  const done = win.find((e) => e.k === "msg" && e.type === "done" && e.requestId === id);
  const opened = win.find((e) => e.k === "msg" && e.type === "file" && e.event === "opened");
  const workerCreated = win.find((e) => e.k === "worker");
  const mints = win.filter((e) => e.k === "mint");
  const firstFrame = frames[0];

  // Mint to swap: the first swap of a tile to this frame, after it was minted.
  const swaps = win.filter((e) => e.k === "swap");
  const mintToSwap: number[] = [];
  frames.forEach((f, i) => {
    const m = mints.find((x) => x.t >= f.t && (i === 0 || x.t >= frames[i - 1].t));
    const s = swaps.find((x) => x.frame === (f.timestamp as number).toFixed(3) && m && x.t >= m.t);
    if (m && s) mintToSwap.push(r1(s.t - m.t));
  });

  // The time each visible tile began showing a frame of its own time, and kept it.
  const before = (mark.own ?? {}) as Record<string, string>;
  const tileOwnAt = visibleAtEnd.map((tid) => {
    let since: number | null = before[tid] === "true" ? 0 : null;
    for (const e of swaps.filter((x) => x.id === tid)) {
      if (e.own === "true") since = since ?? rel(e.t);
      else since = null;
    }
    return since;
  });
  const known = tileOwnAt.filter((v): v is number => v !== null);
  const allOwnAt = known.length === tileOwnAt.length ? Math.max(...known) : null;

  // Frame by frame: when it arrived, what the worker spent, and what is left over (the pacer's
  // yield, the pass set-up, the transfer).
  let previousPosted = planned ? abs(planned.at) : undefined;
  const perFrame = frames.map((f) => {
    const posted = f.postedAt === undefined ? undefined : abs(f.postedAt);
    const work = (f.decodeMs as number) + (f.encodeMs as number);
    const overhead =
      posted !== undefined && previousPosted !== undefined
        ? r1(posted - previousPosted - work)
        : null;
    if (posted !== undefined) previousPosted = posted;
    return {
      timestamp: f.timestamp,
      arrivedAt: rel(f.t),
      decodeMs: r1(f.decodeMs as number),
      encodeMs: r1(f.encodeMs as number),
      transferMs: posted === undefined ? null : r1(f.t - posted),
      overheadMs: overhead,
    };
  });

  return {
    label,
    cold: Boolean(workerCreated),
    ownTilesAtMs: known.sort((a, b) => a - b),
    tiles: tileOwnAt.length,
    allOwnAtMs: allOwnAt,
    withinBudget: known.filter((v) => v <= BUDGET_MS).length,
    // Stages, from the moment the view rests, in order.
    stages: {
      restDelayMs: r1(first.t - t0), // the 120 ms rest, and what the page adds to it
      slotsAsked: first.slots,
      visibleSlotsAsked: first.visible,
      requestsPosted: requests.length,
      toWorkerMs: recv ? r1(abs(recv.at) - first.t) : null, // transfer, plus the worker's start-up when cold
      openFileMs: recv && ready ? r1(abs(ready.at) - abs(recv.at)) : null,
      openReportedByWorkerMs: done ? r1(done.openMs as number) : null,
      planMs: ready && planned ? r1(abs(planned.at) - abs(ready.at)) : null,
      toFirstFrameArrivedMs: firstFrame ? r1(firstFrame.t - first.t) : null,
      firstFrameDecodeMs: firstFrame ? r1(firstFrame.decodeMs as number) : null,
      firstFrameEncodeMs: firstFrame ? r1(firstFrame.encodeMs as number) : null,
      firstFramePassSetupMs:
        planned && firstFrame?.postedAt !== undefined
          ? r1(
              abs(firstFrame.postedAt) -
                abs(planned.at) -
                (firstFrame.decodeMs as number) -
                (firstFrame.encodeMs as number),
            )
          : null,
      openedMessageAtMs: opened ? rel(opened.t) : null,
      lastFrameArrivedMs: frames.length ? rel(frames[frames.length - 1].t) : null,
      mintHandlingMs: firstFrame && mints[0] ? r1(mints[0].t - firstFrame.t) : null,
      mintToSwapMedianMs: median(mintToSwap),
      mintToSwapMaxMs: mintToSwap.length ? Math.max(...mintToSwap) : null,
    },
    frames: frames.length,
    perFrame: perFrame.slice(0, 24),
    medianDecodeMs: median(perFrame.map((f) => f.decodeMs)),
    medianEncodeMs: median(perFrame.map((f) => f.encodeMs)),
    medianOverheadMs: median(
      perFrame.map((f) => f.overheadMs).filter((v): v is number => v !== null),
    ),
    slotList: first.slotList,
    doneRaw: done,
    done: done
      ? {
          outcome: done.outcome,
          frames: done.frames,
          openedFile: done.openedFile,
          elapsedMs: r1(done.elapsedMs as number),
        }
      : null,
  };
}

async function visibleIds(page: Page): Promise<number[]> {
  return page.evaluate(() => (window as unknown as { __visible(): number[] }).__visible());
}

async function tilesNow(page: Page): Promise<unknown> {
  return page.evaluate(() => (window as unknown as { __tiles(): unknown }).__tiles());
}

async function mark(page: Page, label: string): Promise<void> {
  await page.evaluate(
    (l) => (window as unknown as { __mark(label: string): void }).__mark(l),
    label,
  );
}

/** Waits until nothing has arrived or been swapped for `quietMs`. */
async function settled(page: Page, quietMs = 900): Promise<void> {
  const since = await page.evaluate(() => performance.now());
  await page.waitForFunction(
    ({ quiet, since }) => {
      const evs = (window as unknown as { __ev: { t: number; k: string }[] }).__ev;
      const last = [...evs]
        .reverse()
        .find((e) => e.k === "msg" || e.k === "swap" || e.k === "post");
      const now = performance.now();
      const pending = new Set<number>();
      for (const e of evs as Ev[]) {
        if (e.k === "post" && e.type === "request") pending.add(e.requestId as number);
        if (e.k === "msg" && (e.type === "done" || e.type === "error"))
          pending.delete(e.requestId as number);
      }
      return now - since > quiet && pending.size === 0 && (!last || now - last.t > quiet);
    },
    { quiet: quietMs, since },
    { timeout: 120_000, polling: 100 },
  );
}

test(`NIW2-844 layer 3: where the 500 ms of AC1 goes (${LABEL})`, async () => {
  test.setTimeout(900_000);
  await mkdir(OUT, { recursive: true });
  const duration = probeDuration(TAKE);
  const s = await startScenario(`filmstrip-latency-${LABEL}`, {
    env: { KAIPU_FLAG_OVERRIDES: '{"zoom-filmstrip":true}' },
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
    label: LABEL,
    take: TAKE,
    durationSeconds: duration,
    webcamOffsetMs: WEBCAM ? 5000 : null,
    webcamFile: WEBCAM ? WEBCAM_FILE : null,
  };
  try {
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown> & { __ev: Record<string, unknown>[] };
      w.__ev = [];
      const ev = (k: string, data: Record<string, unknown> = {}): void => {
        w.__ev.push({ t: performance.now(), k, ...data });
      };
      const TILES = "[data-ui-area='editorVideo.timeline']";
      const ids = new WeakMap<Element, number>();
      let nextId = 1;
      const idOf = (el: Element): number => {
        let id = ids.get(el);
        if (id === undefined) {
          id = nextId++;
          ids.set(el, id);
        }
        return id;
      };
      const visible = (): HTMLImageElement[] => {
        const body = document.querySelector<HTMLElement>('[data-testid="timeline-scroller"]');
        const corner = document.querySelector<HTMLElement>('[data-testid="lane-corner"]');
        if (!body) return [];
        const rect = body.getBoundingClientRect();
        const left = corner ? corner.getBoundingClientRect().right : rect.left;
        return [...document.querySelectorAll<HTMLImageElement>(`${TILES} img`)].filter((img) => {
          const r = img.getBoundingClientRect();
          return r.width > 0 && r.right > left && r.left < rect.right;
        });
      };
      w.__visible = () => visible().map(idOf);
      // The state of every visible tile now: which frame, its span, where it sits.
      w.__tiles = () =>
        visible().map((img) => {
          const r = img.getBoundingClientRect();
          return {
            id: idOf(img),
            own: img.dataset.filmstripOwn,
            frame: img.dataset.filmstripFrame,
            span: img.dataset.filmstripSpan,
            left: Math.round(r.left),
            right: Math.round(r.right),
          };
        });
      w.__mark = (label: string) => {
        const own: Record<number, string | undefined> = {};
        for (const img of visible()) own[idOf(img)] = img.dataset.filmstripOwn;
        ev("mark", { label, own });
      };

      // The worker: every message in and out, stamped.
      const Original = window.Worker;
      const summary = (d: Record<string, unknown>): Record<string, unknown> => {
        const { blob: _blob, ...rest } = d;
        return rest;
      };
      window.Worker = class extends Original {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          const isFilmstrip = String(url).includes("filmstrip");
          if (!isFilmstrip) return;
          ev("worker", { url: String(url) });
          const post = this.postMessage.bind(this) as (m: unknown, ...rest: unknown[]) => void;
          (this as unknown as { postMessage: typeof post }).postMessage = (m, ...rest) => {
            const msg = m as { type?: string; requestId?: number; slots?: { visible?: boolean }[] };
            ev("post", {
              type: msg.type,
              requestId: msg.requestId,
              slots: msg.slots?.length,
              visible: msg.slots?.filter((x) => x.visible).length,
              slotList: msg.slots,
            });
            post(m, ...rest);
          };
          this.addEventListener("message", (e) => ev("msg", summary((e as MessageEvent).data)));
        }
      } as typeof Worker;

      const original = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (obj: Blob | MediaSource) => {
        ev("mint");
        return original(obj);
      };
      document.addEventListener("scroll", () => ev("scroll"), true);
      document.addEventListener("click", () => ev("click"), true);
      const swapFor = (img: HTMLImageElement, why: string): void => {
        if (!img.dataset.filmstripFrame) return;
        ev("swap", {
          id: idOf(img),
          own: img.dataset.filmstripOwn,
          frame: img.dataset.filmstripFrame,
          why,
        });
      };
      new MutationObserver((records) => {
        for (const r of records) {
          if (r.type === "attributes") {
            const el = r.target as HTMLImageElement;
            if (el.tagName === "IMG" && el.closest?.(TILES)) swapFor(el, r.attributeName ?? "");
          } else {
            for (const n of r.addedNodes) {
              const el = n as HTMLElement;
              if (el.tagName === "IMG" && el.closest?.(TILES))
                swapFor(el as HTMLImageElement, "added");
            }
          }
        }
      }).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["src", "data-filmstrip-own"],
      });
    });
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
      .poll(
        async () =>
          page.evaluate(
            () => document.querySelectorAll("[data-ui-area='editorVideo.timeline'] img").length,
          ),
        { timeout: 120_000 },
      )
      .toBeGreaterThan(0);
    await settled(page, 1500);
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    result.pageTimeOrigin = timeOrigin;

    // ---- First zoom after editor opening; prewarming is reported separately below.
    await mark(page, "cold");
    const zoomIn = page.getByRole("button", { name: "Zoom in the timeline", exact: true });
    for (let i = 0; i < 5; i++) await zoomIn.click();
    await settled(page);
    await s.shot("first-zoom");
    const cases: string[] = ["cold"];
    const ids: Record<string, number[]> = { cold: await visibleIds(page) };
    const finalTiles: Record<string, unknown> = { cold: await tilesNow(page) };

    // ---- WARM: a jump to somewhere else, the worker alive and the file open
    const scroller = page.getByTestId("timeline-scroller");
    for (const [i, f] of JUMPS.entries()) {
      const label = `warm-${i + 1}`;
      await mark(page, label);
      await scroller.evaluate(
        (el, x) => (el.scrollLeft = (el.scrollWidth - el.clientWidth) * x),
        f,
      );
      await settled(page);
      cases.push(label);
      ids[label] = await visibleIds(page);
      finalTiles[label] = await tilesNow(page);
      if (i === 5) await s.shot("jump-83-percent");
    }

    // ---- after idle: the file has closed (10 s), the worker is still there
    await page.waitForTimeout(12_000);
    await mark(page, "after-idle");
    await scroller.evaluate((el) => (el.scrollLeft = (el.scrollWidth - el.clientWidth) * 0.02));
    await settled(page);
    cases.push("after-idle");
    ids["after-idle"] = await visibleIds(page);

    const evs = await page.evaluate(() => (window as unknown as { __ev: Ev[] }).__ev);
    const rows = cases.map((c) => analyse(evs, c, timeOrigin, ids[c]));
    result.cases = rows;
    const firstMark = evs.find((e) => e.k === "mark");
    result.editorPrewarm = evs
      .filter(
        (e) =>
          e.t < (firstMark?.t ?? Infinity) &&
          (e.k === "worker" ||
            (e.k === "post" && e.type === "prepare") ||
            (e.k === "msg" && e.type === "file")),
      )
      .map((e) => ({ ...e }));
    result.finalTiles = finalTiles;
    const warm = rows.filter((r) => r.label?.toString().startsWith("warm"));
    const pick = <T>(fn: (r: (typeof rows)[number]) => T | null | undefined): T[] =>
      warm.map(fn).filter((v): v is T => v !== null && v !== undefined);
    result.warmSummary = {
      jumps: warm.length,
      allOwnAtMs: pick((r) => ("allOwnAtMs" in r ? r.allOwnAtMs : null)),
      medianAllOwnAtMs: median(pick((r) => ("allOwnAtMs" in r ? r.allOwnAtMs : null))),
      tilesWithinBudgetOfTotal: warm.map((r) =>
        "withinBudget" in r ? `${r.withinBudget}/${r.tiles}` : "n/a",
      ),
    };
    console.log(`[verify] ${LABEL}: ${JSON.stringify(result.warmSummary)}`);
    for (const row of rows) {
      expect(row.allOwnAtMs, `${row.label}: every visible tile must be own-time`).not.toBeNull();
      expect(row.allOwnAtMs!, `${row.label}: AC1/2 must remain within 500 ms`).toBeLessThanOrEqual(
        BUDGET_MS,
      );
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    result.error ??= null;
    await writeFile(path.join(OUT, `${LABEL}.json`), JSON.stringify(result, null, 2));
    await s.finish();
  }
});
