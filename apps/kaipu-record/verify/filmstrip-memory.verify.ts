import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { dismissOnboarding, launchApp } from "../e2e/helpers/launch";
import { planSlots, type Slot } from "../src/renderer/src/features/video-editor/filmstrip-frames";

/*
 * Memory over time of the filmstrip worker (NIW2-844 layer 2, AC5: "bounded memory"). Run on the
 * Mac mini only, against the owner's 54-minute 2560x1440 take (about 10 GB).
 *
 * The question it answers: does the renderer's memory PLATEAU or keep GROWING as requests go on,
 * and which memory is it? At every checkpoint it records, per Electron process, the working set
 * (what `app.getAppMetrics()` reports and what the first measurement used), the physical
 * footprint from `footprint` (what Activity Monitor calls "Memory", with its categories), the
 * page's JS heap, and the worker's own counters from `verify/filmstrip-probe/mem.ts` (live
 * VideoFrames and VideoDecoders, JPEG bytes produced, JS heap).
 *
 * Finding (2026-11-16): the renderer growth this scenario shows is Playwright's, not the app's.
 * Playwright enables the DevTools Network domain on the page and its workers; that agent keeps
 * the bodies of every fetch the worker makes. Any burst of ranged fetches reproduces it (the
 * fetch stages, with no mediabunny and no decoder), a no-I/O run does not, and the same worker
 * on the same take in a bare Electron window with nothing attached
 * (`verify/filmstrip-no-cdp/run.sh`) plateaus about 70 MB above the baseline. Read the memory
 * numbers of this scenario as an upper bound, and use the no-CDP run for the app's own.
 *
 * Environment:
 *   KAIPU_MEM_MODE      explore (default) | open-only (open the file, decode nothing) |
 *                       no-worker (no worker at all: the app's own drift) |
 *                       main-thread (the same engine on the page's main thread) |
 *                       stage (KAIPU_MEM_STAGE=plan|read|decode|encode: the engine's work up
 *                       to that stage, nothing posted)
 *   KAIPU_MEM_DECODER   hardware (default) | software
 *   KAIPU_MEM_REQUESTS  requests in the explore run (default 200)
 *   KAIPU_MEM_EVERY     checkpoint every N requests (default 20)
 *   KAIPU_MEM_CYCLES    close and reopen cycles after the run (default 5)
 *   KAIPU_MEM_CACHE_MB, KAIPU_MEM_PARALLELISM   stage runs: UrlSource options (default: shipped)
 *   KAIPU_MEM_FETCH_KB  stage runs: bytes per fetch in the fetch stages (default 512)
 *   KAIPU_MEM_FRAME_MODE blob (default, as shipped) | drop | buffer: how a frame leaves the worker
 *   KAIPU_MEM_VIDEO     1 records the page as a video (the verify runs do); default off
 *   KAIPU_MEM_LABEL     name of the result file
 *   KAIPU_MEM_OUT       result folder (outside the worktree)
 *   KAIPU_PROBE_TAKE    the take
 */
const EVIDENCE = path.join(homedir(), "kaipu-evidence", "niw2-844");
const TAKE = process.env.KAIPU_PROBE_TAKE ?? path.join(EVIDENCE, "take", "take-1440p-10gb.mp4");
const MODE = (process.env.KAIPU_MEM_MODE ?? "explore") as
  | "explore"
  | "open-only"
  | "no-worker"
  | "main-thread"
  | "stage";
const STAGE = (process.env.KAIPU_MEM_STAGE ?? "encode") as string;
const CACHE_MB = process.env.KAIPU_MEM_CACHE_MB;
const PARALLELISM = process.env.KAIPU_MEM_PARALLELISM;
const FETCH_KB = process.env.KAIPU_MEM_FETCH_KB;
const DECODER = (process.env.KAIPU_MEM_DECODER ?? "hardware") as "software" | "hardware";
const REQUESTS = Number(process.env.KAIPU_MEM_REQUESTS ?? 200);
const EVERY = Number(process.env.KAIPU_MEM_EVERY ?? 20);
const CYCLES = Number(process.env.KAIPU_MEM_CYCLES ?? 5);
const RUNS_REQUESTS = MODE === "explore" || MODE === "main-thread" || MODE === "stage";
const ENGINE_RUN = MODE === "explore" || MODE === "main-thread";
const VIDEO = process.env.KAIPU_MEM_VIDEO === "1";
const FRAME_MODE = (process.env.KAIPU_MEM_FRAME_MODE ?? "blob") as "blob" | "drop" | "buffer";
const LABEL = process.env.KAIPU_MEM_LABEL ?? `${MODE}-${DECODER}`;
const OUT = process.env.KAIPU_MEM_OUT ?? path.join(EVIDENCE, "memory");
const APP_ROOT = path.resolve(__dirname, "..");
const ASSETS = path.join(APP_ROOT, "out", "renderer", "assets");
const WORKER_BUNDLE = path.join(ASSETS, "filmstrip-probe.js");
const MAIN_BUNDLE = path.join(ASSETS, "filmstrip-main-control.js");
const ASSET_ID = "00000000-0000-4000-8000-0000000000a1";

interface Message {
  type: string;
  [key: string]: unknown;
}

const mb = (bytes: number) => Math.round((bytes / 1048576) * 10) / 10;

async function startWorker(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = new Worker(new URL("./assets/filmstrip-probe.js", location.href), { type: "module" });
    const store = { worker: w, messages: [] as unknown[] };
    (window as unknown as { __probe: typeof store }).__probe = store;
    w.onmessage = (event) => {
      store.messages.push(event.data);
    };
    w.onerror = (event) => {
      store.messages.push({ type: "worker-error", message: String(event.message) });
    };
  });
}

const post = (page: Page, message: unknown) =>
  page.evaluate((m) => {
    (window as unknown as { __probe: { worker: Worker } }).__probe.worker.postMessage(m);
  }, message);

const messages = (page: Page): Promise<Message[]> =>
  page.evaluate(() =>
    (window as unknown as { __probe: { messages: Message[] } }).__probe.messages.slice(),
  );

const clearMessages = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { __probe: { messages: unknown[] } }).__probe.messages.length = 0;
  });

async function waitFor(
  page: Page,
  predicate: (all: Message[]) => boolean,
  timeoutMs: number,
  label: string,
): Promise<Message[]> {
  const start = Date.now();
  for (;;) {
    const all = await messages(page);
    const error = all.find((m) => m.type === "worker-error" || m.type === "error");
    if (error) throw new Error(`${label}: ${JSON.stringify(error)}`);
    if (predicate(all)) return all;
    if (Date.now() - start > timeoutMs)
      throw new Error(`${label}: timed out after ${timeoutMs} ms`);
    await page.waitForTimeout(100);
  }
}

interface ProcessSample {
  pid: number;
  type: string;
  workingSetMb: number;
  footprintMb: number | null;
  /** Categories of the footprint that hold at least 4 MB, in MB (dirty + swapped). */
  categoriesMb: Record<string, number>;
  /** Clean, file-backed pages (they cost nothing to drop). */
  cleanMb: number | null;
}

function footprintOf(
  pid: number,
): { footprintMb: number; categoriesMb: Record<string, number>; cleanMb: number } | null {
  const file = path.join(tmpdir(), `kaipu-fp-${pid}.json`);
  try {
    execFileSync("footprint", ["-j", file, String(pid)], { stdio: "ignore" });
    const data = JSON.parse(readFileSync(file, "utf8")) as {
      processes: {
        footprint: number;
        categories: Record<string, { dirty: number; swapped: number; clean: number }>;
      }[];
    };
    const p = data.processes[0];
    const categoriesMb: Record<string, number> = {};
    let clean = 0;
    for (const [name, c] of Object.entries(p.categories)) {
      clean += c.clean;
      const owned = c.dirty + c.swapped;
      if (owned >= 4 * 1048576) categoriesMb[name] = mb(owned);
    }
    return { footprintMb: mb(p.footprint), categoriesMb, cleanMb: mb(clean) };
  } catch {
    return null;
  }
}

/**
 * The JS heap of every dedicated worker of the page, read through the page's debugger, and
 * optionally after a garbage collection inside the worker. `performance.memory` does not exist in
 * a worker, and the page's own GC does not touch the worker's isolate.
 */
async function workerHeaps(
  app: import("@playwright/test").ElectronApplication,
  url: string,
  collect: boolean,
): Promise<unknown> {
  return app.evaluate(
    async ({ webContents }, args) => {
      const g = globalThis as unknown as { __workerSessions?: Set<string> };
      const wc = webContents.getAllWebContents().find((w) => w.getURL() === args.url);
      if (!wc) return { error: "page not found" };
      const dbg = wc.debugger;
      if (!g.__workerSessions) {
        const sessions = new Set<string>();
        g.__workerSessions = sessions;
        dbg.attach("1.3");
        dbg.on("message", (_event, method, params) => {
          if (method === "Target.attachedToTarget" && params.targetInfo.type === "worker") {
            sessions.add(params.sessionId);
          }
          if (method === "Target.detachedFromTarget") sessions.delete(params.sessionId);
        });
        await dbg.sendCommand("Target.setAutoAttach", {
          autoAttach: true,
          waitForDebuggerOnStart: false,
          flatten: true,
        });
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      const mb = (n: number) => Math.round((n / 1048576) * 10) / 10;
      const out: {
        usedMb: number;
        totalMb: number;
        afterGcUsedMb?: number;
        afterGcTotalMb?: number;
      }[] = [];
      for (const sessionId of g.__workerSessions) {
        const before = await dbg.sendCommand("Runtime.getHeapUsage", {}, sessionId);
        const entry: (typeof out)[number] = {
          usedMb: mb(before.usedSize),
          totalMb: mb(before.totalSize),
        };
        if (args.collect) {
          await dbg.sendCommand("HeapProfiler.collectGarbage", {}, sessionId);
          const after = await dbg.sendCommand("Runtime.getHeapUsage", {}, sessionId);
          entry.afterGcUsedMb = mb(after.usedSize);
          entry.afterGcTotalMb = mb(after.totalSize);
        }
        out.push(entry);
      }
      return out;
    },
    { url, collect },
  );
}

test(`filmstrip worker memory: ${LABEL}`, async () => {
  test.setTimeout(3_600_000);
  await mkdir(OUT, { recursive: true });
  if (MODE !== "no-worker") {
    const main = MODE === "main-thread";
    execFileSync(
      "bun",
      [
        "build",
        path.join(__dirname, "filmstrip-probe", main ? "main-control.ts" : "entry.ts"),
        "--target=browser",
        "--format=esm",
        "--outfile",
        main ? MAIN_BUNDLE : WORKER_BUNDLE,
      ],
      { cwd: APP_ROOT, stdio: "inherit" },
    );
  }

  const outDir = path.join(APP_ROOT, "test-results", "verify", "filmstrip-memory");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const { app, page, teardown } = await launchApp({
    ...(VIDEO ? { recordVideoDir: outDir } : {}),
    seedVault: async (dir) => {
      await mkdir(path.join(dir, ".kaipu"), { recursive: true });
      await symlink(TAKE, path.join(dir, "take.mp4"));
      await writeFile(
        path.join(dir, ".kaipu", "take.json"),
        JSON.stringify({
          sidecarVersion: 2,
          assetId: ASSET_ID,
          title: "Probe take",
          durationSeconds: 60,
          createdAt: 1_700_000_000_000,
        }),
      );
    },
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");

  const checkpoints: unknown[] = [];
  let workerAlive = true;
  const started = Date.now();
  const checkpoint = async (
    label: string,
    requests: number,
    extra: Record<string, unknown> = {},
  ): Promise<void> => {
    const metrics = await app.evaluate(({ app: electronApp }) =>
      electronApp.getAppMetrics().map((m) => ({
        pid: m.pid,
        type: m.type,
        workingSetKb: m.memory.workingSetSize,
      })),
    );
    const processes: ProcessSample[] = metrics.map((m) => {
      const fp = footprintOf(m.pid);
      return {
        pid: m.pid,
        type: m.type,
        workingSetMb: mb(m.workingSetKb * 1024),
        footprintMb: fp?.footprintMb ?? null,
        categoriesMb: fp?.categoriesMb ?? {},
        cleanMb: fp?.cleanMb ?? null,
      };
    });
    const pageMetrics = (await cdp.send("Performance.getMetrics")) as {
      metrics: { name: string; value: number }[];
    };
    const heap = (name: string) => pageMetrics.metrics.find((m) => m.name === name)?.value ?? 0;
    let worker: Message | null = null;
    if (MODE !== "no-worker" && workerAlive) {
      await clearMessages(page);
      await post(page, { type: "mem", id: Date.now() });
      worker =
        (await waitFor(page, (all) => all.some((m) => m.type === "mem-done"), 30_000, "mem")).find(
          (m) => m.type === "mem-done",
        ) ?? null;
      await clearMessages(page);
    }
    const entry = {
      label,
      requests,
      secondsSinceStart: Math.round((Date.now() - started) / 1000),
      processes,
      pageJsHeapUsedMb: mb(heap("JSHeapUsedSize")),
      pageJsHeapTotalMb: mb(heap("JSHeapTotalSize")),
      worker,
      ...extra,
    };
    checkpoints.push(entry);
    const tabs = processes.filter((p) => p.type === "Tab");
    console.log(
      `[mem] ${LABEL} ${label} req=${requests} ` +
        `tab ws=${tabs.map((t) => t.workingSetMb).join("/")} fp=${tabs.map((t) => t.footprintMb).join("/")} ` +
        `pageHeap=${mb(heap("JSHeapUsedSize"))} ` +
        (worker
          ? `workerHeap=${worker.jsHeapUsedMb} frames live/out=${worker.framesLive}/${worker.framesOutput} dec live=${worker.decodersLive} jpeg=${mb(worker.jpegBytes as number)}MB`
          : ""),
    );
    await writeFile(
      path.join(OUT, `${LABEL}.json`),
      JSON.stringify(
        { label: LABEL, mode: MODE, decoder: DECODER, video: VIDEO, take: TAKE, checkpoints },
        null,
        2,
      ),
    );
  };

  try {
    await dismissOnboarding(page);
    const mediaUrl = await page.evaluate(() => {
      const w = window.electronAPI?.workspaces?.activeId?.() ?? null;
      const base = `kaipu-media://recording/take`;
      return w ? `${base}?w=${encodeURIComponent(w)}` : base;
    });
    let duration = 0;
    if (MODE !== "no-worker") {
      if (MODE === "main-thread") {
        await page.evaluate(
          (src) => import(/* @vite-ignore */ new URL(src, location.href).href),
          "./assets/filmstrip-main-control.js",
        );
      } else {
        await startWorker(page);
      }
      await post(page, { type: "info", id: 1, url: mediaUrl });
      const info = (
        await waitFor(page, (all) => all.some((m) => m.type === "info-done"), 180_000, "info")
      ).find((m) => m.type === "info-done")!;
      duration = info.duration as number;
      await clearMessages(page);
      await post(page, { type: "configure", decoder: DECODER });
      if (MODE !== "main-thread") await post(page, { type: "probe-config", frameMode: FRAME_MODE });
    }
    const slotsAt = (centre: number, windowS: number, tiles = 17): Slot[] =>
      planSlots({
        duration,
        visible: { start: centre - windowS / 2, end: centre + windowS / 2 },
        tileSpan: windowS / tiles,
        frames: [],
      });
    // Deterministic, spread over the whole file, so new regions are read all the time.
    const centreOf = (i: number) =>
      duration * Math.min(0.97, Math.max(0.03, (i * 0.618034 + 0.05) % 1));
    let requestId = 1000;
    const runRequest = async (i: number, slots: Slot[]): Promise<void> => {
      const id = requestId++;
      const centre = centreOf(i);
      if (MODE === "stage") {
        await post(page, {
          type: "stage-request",
          id,
          stage: STAGE as never,
          url: mediaUrl,
          decoder: DECODER,
          slots,
          playhead: centre,
          direction: i % 2 === 0 ? 1 : -1,
          ...(CACHE_MB ? { cacheBytes: Number(CACHE_MB) * 1048576 } : {}),
          ...(PARALLELISM ? { parallelism: Number(PARALLELISM) } : {}),
          ...(FETCH_KB ? { fetchBytes: Number(FETCH_KB) * 1024 } : {}),
        });
        const answered = await waitFor(
          page,
          (all) => all.some((m) => m.type === "stage-done" && m.id === id),
          600_000,
          `stage request ${i}`,
        );
        const done = answered.find((m) => m.type === "stage-done" && m.id === id);
        if (i % 50 === 0)
          console.log(
            `[stage] ${STAGE} req=${i} planned=${done?.planned} produced=${done?.produced}`,
          );
        await clearMessages(page);
        return;
      }
      await post(page, {
        type: "request",
        requestId: id,
        fileKey: "take",
        url: mediaUrl,
        slots,
        playhead: centre,
        direction: i % 2 === 0 ? 1 : -1,
      });
      await waitFor(
        page,
        (all) => all.some((m) => m.type === "done" && m.requestId === id),
        600_000,
        `request ${i}`,
      );
      // The page keeps every message it gets: clear it, so the memory measured is the app's.
      await clearMessages(page);
    };

    await checkpoint("start", 0);
    if (RUNS_REQUESTS) {
      for (let i = 0; i < REQUESTS; i++) {
        await runRequest(i, slotsAt(centreOf(i), 163));
        if ((i + 1) % EVERY === 0 || i < 3) await checkpoint("explore", i + 1);
      }
    } else if (MODE === "open-only") {
      // Open the file and decode nothing: the same wall time and cadence as an explore run.
      await runRequest(0, []);
      await checkpoint("open", 0);
      for (let i = 0; i < REQUESTS; i += EVERY) {
        await page.waitForTimeout(Math.max(1000, (EVERY * 800) | 0));
        await checkpoint("open-only", i + EVERY);
      }
    } else {
      for (let i = 0; i < REQUESTS; i += EVERY) {
        await page.waitForTimeout(Math.max(1000, (EVERY * 800) | 0));
        await checkpoint("no-worker", i + EVERY);
      }
    }

    if (ENGINE_RUN) {
      // The idle close, as the app does it, then reopen cycles.
      await waitFor(
        page,
        (all) => all.some((m) => m.type === "file" && m.event === "closed" && m.reason === "idle"),
        30_000,
        "idle close",
      );
      await page.waitForTimeout(1500);
      await checkpoint("after-idle-close", REQUESTS);
      for (let c = 0; c < CYCLES; c++) {
        for (let k = 0; k < 3; k++) {
          const i = REQUESTS + c * 3 + k;
          await runRequest(i, slotsAt(centreOf(i), 163));
        }
        await clearMessages(page);
        await post(page, { type: "close" });
        await waitFor(
          page,
          (all) => all.some((m) => m.type === "file" && m.event === "closed"),
          30_000,
          "close event",
        );
        await page.waitForTimeout(1000);
        await checkpoint(`reopen-cycle-${c + 1}`, REQUESTS + (c + 1) * 3);
      }
    }

    if (RUNS_REQUESTS && MODE !== "main-thread") {
      // Does the plateau shrink when the worker's own garbage is collected?
      const heaps = await workerHeaps(app, page.url(), true);
      console.log(`[mem] worker heaps ${JSON.stringify(heaps)}`);
      await page.waitForTimeout(2000);
      await checkpoint("after-worker-gc", REQUESTS, { workerHeaps: heaps });
    }
    if (MODE !== "no-worker") {
      await page.evaluate(() =>
        (window as unknown as { __probe: { worker: Worker } }).__probe.worker.terminate(),
      );
      workerAlive = false;
      await page.waitForTimeout(3000);
      await checkpoint("worker-terminated", REQUESTS);
    }
    // A page GC, to tell page-heap garbage from memory the page does not own.
    await cdp.send("HeapProfiler.collectGarbage");
    await page.waitForTimeout(1500);
    await checkpoint("after-page-gc", REQUESTS);
    expect(checkpoints.length).toBeGreaterThan(3);
  } finally {
    console.log(`[mem] wrote ${path.join(OUT, `${LABEL}.json`)}`);
    await teardown();
  }
});
