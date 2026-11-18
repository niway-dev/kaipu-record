import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { dismissOnboarding } from "../e2e/helpers/launch";
import { planSlots, type Slot } from "../src/renderer/src/features/video-editor/filmstrip-frames";
import { startScenario } from "./helpers";

/*
 * Real-app probe and measurements for NIW2-844 layer 2 (the filmstrip worker). Run on the Mac
 * mini only, against the owner's 54-minute 2560x1440 take (about 10 GB; its moov box is at the START)
 * and a real recording whose moov box is at the END (the 1080p take).
 *
 * 1. PROBE: a dedicated worker opens the take through the media protocol URL
 *    (`kaipu-media://recording/<id>`) and the scenario records every Range request the worker
 *    made, with the status and the bytes granted. If the worker cannot read it, the scenario
 *    fails here and nothing else is measured.
 * 2. MEASURE (decision 16): time to open, one keyframe decode with hardware and with software
 *    decoding, CPU during a 17-frame request, process memory after exploring, per-slot against a
 *    single forward pass.
 * 3. RULES: AC13 (one file, idle close), AC5 (the second file closes the first), AC8 (a file with
 *    one keyframe: the far slots are skipped at plan time, `skippedOverCap`; the 300-packet bound
 *    on a decoded slot is pinned by the unit tests, not measured here), AC14 (frames per second,
 *    from the worker's own clock; one 62-slot request may stay under 60 per second on its own, so
 *    this shows the limit holds, and the pacer itself is pinned by the unit tests).
 *
 * The worker is bundled for the probe with `bun build` (the editor does not start it until
 * layer 3), together with `verify/filmstrip-probe/` which adds fetch logging and a `bench`
 * message. The result and a contact sheet go to `$KAIPU_PROBE_OUT` (outside the worktree,
 * because `gh pr create` removes it).
 */
const NAME = "filmstrip-worker";
const EVIDENCE = path.join(homedir(), "kaipu-evidence", "niw2-844");
const TAKE = process.env.KAIPU_PROBE_TAKE ?? path.join(EVIDENCE, "take", "take-1440p-10gb.mp4");
const TAKE_SMALL =
  process.env.KAIPU_PROBE_TAKE_SMALL ?? path.join(EVIDENCE, "take", "take-1080p.mp4");
const ONE_KEY = process.env.KAIPU_PROBE_ONE_KEY ?? path.join(EVIDENCE, "one-keyframe-60s.mp4");
/** The decoder the explore, AC13, AC5 and AC8 parts run with. */
const PROBE_DECODER = (process.env.KAIPU_PROBE_DECODER ?? "hardware") as "software" | "hardware";
const OUT = process.env.KAIPU_PROBE_OUT ?? path.join(EVIDENCE, "results");
const APP_ROOT = path.resolve(__dirname, "..");
const WORKER_BUNDLE = path.join(APP_ROOT, "out", "renderer", "assets", "filmstrip-probe.js");

const RECORDINGS = [
  { id: "take", file: TAKE, title: "Probe take", assetId: "00000000-0000-4000-8000-0000000000a1" },
  {
    id: "take-small",
    file: TAKE_SMALL,
    title: "Probe take small",
    assetId: "00000000-0000-4000-8000-0000000000a2",
  },
  {
    id: "one-key",
    file: ONE_KEY,
    title: "Probe one keyframe",
    assetId: "00000000-0000-4000-8000-0000000000a3",
  },
];

interface Message {
  type: string;
  _recv: number;
  _workerTime?: number;
  [key: string]: unknown;
}

/** The page side: one worker, every message it sends kept with the time it arrived. */
async function startWorker(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = new Worker(new URL("./assets/filmstrip-probe.js", location.href), {
      type: "module",
    });
    const store = { worker: w, messages: [] as unknown[] };
    (window as unknown as { __probe: typeof store }).__probe = store;
    w.onmessage = (event) => {
      store.messages.push({ ...event.data, _recv: performance.now() });
    };
    w.onerror = (event) => {
      store.messages.push({ type: "worker-error", message: String(event.message), _recv: 0 });
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
    const error = all.find(
      (m) => m.type === "worker-error" || m.type === "bench-error" || m.type === "error",
    );
    if (error) throw new Error(`${label}: ${JSON.stringify(error)}`);
    if (predicate(all)) return all;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`${label}: timed out after ${timeoutMs} ms; got ${all.length} messages`);
    }
    await page.waitForTimeout(100);
  }
}

/** The frames posted so far, in time order, as one dark page; saved as a screenshot. */
async function contactSheet(page: Page, file: string): Promise<void> {
  await page.evaluate(async () => {
    const all = (window as unknown as { __probe: { messages: Message[] } }).__probe.messages;
    const frames = all.filter((m) => m.type === "frame") as unknown as {
      timestamp: number;
      blob: Blob;
    }[];
    frames.sort((a, b) => a.timestamp - b.timestamp);
    const host = document.createElement("div");
    host.id = "probe-sheet";
    host.style.cssText =
      "position:fixed;inset:0;z-index:99999;background:#111;color:#ddd;font:12px monospace;display:flex;flex-wrap:wrap;gap:6px;padding:8px;overflow:auto";
    for (const f of frames) {
      const cell = document.createElement("div");
      const img = document.createElement("img");
      img.src = URL.createObjectURL(f.blob);
      img.style.cssText = "width:160px;display:block";
      cell.append(img, `${f.timestamp.toFixed(2)} s`);
      host.append(cell);
    }
    document.body.append(host);
    await Promise.all(
      [...host.querySelectorAll("img")].map((i) =>
        (i as HTMLImageElement).decode().catch(() => undefined),
      ),
    );
  });
  await page.screenshot({ path: path.join(OUT, file) });
  await page.evaluate(() => document.getElementById("probe-sheet")?.remove());
}

async function mediaUrl(page: Page, id: string): Promise<string> {
  return page.evaluate((recordingId) => {
    const w = window.electronAPI?.workspaces?.activeId?.() ?? null;
    const base = `kaipu-media://recording/${encodeURIComponent(recordingId)}`;
    return w ? `${base}?w=${encodeURIComponent(w)}` : base;
  }, id);
}

interface Usage {
  cpuSeconds: number;
  workingSetMb: number;
  privateMb: number;
  /** Working set in MB per Electron process type (Tab = renderers, GPU, Utility, Browser). */
  byTypeMb: Record<string, number>;
  /** Cumulative CPU seconds per process type. */
  cpuByType: Record<string, number>;
}

/**
 * Cumulative CPU and memory of every process the app owns, the main one (`Browser`) included.
 *
 * The renderer's memory read here is inflated by the harness: Playwright enables the DevTools
 * Network domain on the page and its workers, and that agent keeps the bodies of the worker's
 * fetches (about +210 to +270 MB, plus about 0.19 MB per request). Without a CDP client the
 * same run plateaus about 70 MB above the baseline (`verify/filmstrip-no-cdp/`, NIW2-844).
 */
async function usage(s: { app: import("@playwright/test").ElectronApplication }): Promise<Usage> {
  return s.app.evaluate(({ app }) => {
    let cpu = 0;
    let workingSet = 0;
    let priv = 0;
    const byTypeMb: Record<string, number> = {};
    const cpuByType: Record<string, number> = {};
    for (const m of app.getAppMetrics()) {
      const c = m.cpu.cumulativeCPUUsage ?? 0;
      cpu += c;
      workingSet += m.memory.workingSetSize;
      priv += m.memory.privateBytes ?? 0;
      byTypeMb[m.type] = (byTypeMb[m.type] ?? 0) + m.memory.workingSetSize / 1024;
      cpuByType[m.type] = (cpuByType[m.type] ?? 0) + c;
    }
    for (const k of Object.keys(byTypeMb)) byTypeMb[k] = Math.round(byTypeMb[k]);
    return {
      cpuSeconds: cpu,
      workingSetMb: workingSet / 1024,
      privateMb: priv / 1024,
      byTypeMb,
      cpuByType,
    };
  });
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : NaN;
};
const round = (n: number, digits = 1) => Number(n.toFixed(digits));

/** Frames per window of `windowMs`, the maximum over a sliding window, on the worker's clock. */
function maxFramesInWindow(times: number[], windowMs: number): number {
  const sorted = [...times].sort((a, b) => a - b);
  let max = 0;
  for (let i = 0, j = 0; i < sorted.length; i++) {
    while (sorted[i] - sorted[j] >= windowMs) j++;
    max = Math.max(max, i - j + 1);
  }
  return max;
}

test("a worker reads the take by Range, and what it costs", async () => {
  test.setTimeout(1_800_000);
  await mkdir(OUT, { recursive: true });

  // Bundle the worker + probe code next to the renderer assets of the built app.
  execFileSync(
    "bun",
    [
      "build",
      path.join(__dirname, "filmstrip-probe", "entry.ts"),
      "--target=browser",
      "--format=esm",
      "--outfile",
      WORKER_BUNDLE,
    ],
    { cwd: APP_ROOT, stdio: "inherit" },
  );

  const s = await startScenario(NAME, {
    seedVault: async (dir) => {
      await mkdir(path.join(dir, ".kaipu"), { recursive: true });
      for (const r of RECORDINGS) {
        await symlink(r.file, path.join(dir, `${r.id}.mp4`));
        await writeFile(
          path.join(dir, ".kaipu", `${r.id}.json`),
          JSON.stringify({
            sidecarVersion: 2,
            assetId: r.assetId,
            title: r.title,
            durationSeconds: 60,
            createdAt: 1_700_000_000_000,
          }),
        );
      }
    },
  });
  const page = s.page;
  const result: Record<string, unknown> = { take: TAKE };
  try {
    await dismissOnboarding(page);
    result.memoryFreshApp = await usage(s);
    await startWorker(page);
    const takeUrl = await mediaUrl(page, "take");
    result.takeUrl = takeUrl.replace(/\?w=.*/, "?w=…");

    // ---------------------------------------------------------------- 1. PROBE
    await post(page, { type: "info", id: 1, url: takeUrl });
    const infoDone = (
      await waitFor(page, (all) => all.some((m) => m.type === "info-done"), 180_000, "probe")
    ).find((m) => m.type === "info-done")!;
    const fetches = (await messages(page)).filter((m) => m.type === "probe-fetch");
    const ranged = fetches.filter((f) => f.status === 206);
    result.probe = {
      ok: ranged.length > 0,
      openMsFirstCold: round(infoDone.openMs as number),
      duration: infoDone.duration,
      width: infoDone.width,
      height: infoDone.height,
      codec: infoDone.codec,
      firstKeyTimestamps: infoDone.firstKeys,
      fetchCount: fetches.length,
      rangeRequests: fetches.slice(0, 8).map((f) => ({
        range: f.range,
        status: f.status,
        contentRange: f.contentRange,
        ms: round(f.ms as number),
      })),
    };
    await writeFile(path.join(OUT, "probe.json"), JSON.stringify(result, null, 2));
    // The worker must have been answered with partial content: that is what "read by Range" is.
    expect(
      ranged.length,
      "the worker got no 206 Partial Content from the media protocol",
    ).toBeGreaterThan(0);
    const duration = infoDone.duration as number;
    const keys = infoDone.firstKeys as number[];
    result.keyframeSpacingFirst40 = {
      medianS: round(median(keys.slice(1).map((k, i) => k - keys[i])), 3),
      maxS: round(Math.max(...keys.slice(1).map((k, i) => k - keys[i])), 3),
    };
    await clearMessages(page);

    // The 10 GB take keeps its moov box at the START (an exported file); the 1080p take is a real
    // recording with the moov at the END. Probe that one too: its index sits 1.1 GB into the file.
    const smallUrlProbe = await mediaUrl(page, "take-small");
    await post(page, { type: "info", id: 2, url: smallUrlProbe });
    const smallInfo = (
      await waitFor(page, (all) => all.some((m) => m.type === "info-done"), 180_000, "probe small")
    ).find((m) => m.type === "info-done")!;
    const smallFetches = (await messages(page)).filter((m) => m.type === "probe-fetch");
    result.probeMoovAtEnd = {
      file: TAKE_SMALL,
      ok: smallFetches.some((f) => f.status === 206),
      openMs: round(smallInfo.openMs as number),
      duration: round(smallInfo.duration as number, 1),
      width: smallInfo.width,
      height: smallInfo.height,
      fetchCount: smallFetches.length,
      rangeRequests: smallFetches.slice(0, 12).map((f) => ({
        range: f.range,
        status: f.status,
        contentRange: f.contentRange,
        ms: round(f.ms as number),
      })),
    };
    await writeFile(path.join(OUT, "probe.json"), JSON.stringify(result, null, 2));
    expect(
      (result.probeMoovAtEnd as { ok: boolean }).ok,
      "the worker could not read the moov-at-end take",
    ).toBe(true);
    await clearMessages(page);

    // The editor at 2000% zoom: about 163 s on screen over 17 tiles (the brief's figure).
    const slotsAt = (centre: number, windowS: number, tiles = 17): Slot[] =>
      planSlots({
        duration,
        visible: { start: centre - windowS / 2, end: centre + windowS / 2 },
        tileSpan: windowS / tiles,
        frames: [],
      });
    const requestSlots = slotsAt(duration / 2, 163);
    result.requestSlots = {
      count: requestSlots.length,
      visible: requestSlots.filter((x) => x.visible).length,
      step: requestSlots[0] ? requestSlots[0].end - requestSlots[0].start : null,
    };

    // ---------------------------------------------------------------- 2. MEASURE
    // 2a. Per-frame decode cost, hardware and software, on the same 17 visible slots, one
    // decoder pass per slot (what the engine does) and one single pass (the alternative).
    const visibleSlots = requestSlots.filter((x) => x.visible).slice(0, 17);
    const bench: Record<string, unknown> = {};
    let benchId = 100;
    for (const decoder of ["hardware", "software"] as const) {
      for (const mode of ["per-slot", "single-pass"] as const) {
        await clearMessages(page);
        const id = benchId++;
        const before = await usage(s);
        await post(page, { type: "bench", id, url: takeUrl, decoder, mode, slots: visibleSlots });
        const done = (
          await waitFor(
            page,
            (all) => all.some((m) => m.type === "bench-done" && m.id === id),
            600_000,
            `bench ${decoder} ${mode}`,
          )
        ).find((m) => m.type === "bench-done" && m.id === id)!;
        const after = await usage(s);
        const frames = done.frames as { decodeMs: number; encodeMs: number; wallMs: number }[];
        bench[`${decoder}/${mode}`] = {
          openMs: round(done.openMs as number),
          planMsPer17: round(done.planMs as number),
          totalMs: round(done.totalMs as number),
          frames: frames.length,
          keyframePlans: done.keyframePlans,
          decodeMedianMs: round(median(frames.map((f) => f.decodeMs))),
          decodeMaxMs: round(Math.max(...frames.map((f) => f.decodeMs))),
          encodeMedianMs: round(median(frames.map((f) => f.encodeMs))),
          wallPerFrameMedianMs: round(median(frames.map((f) => f.wallMs))),
          cpuSecondsApp: round(after.cpuSeconds - before.cpuSeconds, 2),
          cpuPercentOfOneCore: round(
            ((after.cpuSeconds - before.cpuSeconds) / ((done.totalMs as number) / 1000)) * 100,
            0,
          ),
        };
      }
    }
    result.bench = bench;
    result.memoryAfterBench = await usage(s);
    await writeFile(path.join(OUT, "bench.json"), JSON.stringify(result, null, 2));

    // 2b. Open time, cold-ish (a fresh worker file, OS cache warm) and repeated.
    const opens: number[] = [];
    for (let i = 0; i < 5; i++) {
      await clearMessages(page);
      await post(page, { type: "info", id: 200 + i, url: takeUrl });
      const done = (
        await waitFor(page, (all) => all.some((m) => m.type === "info-done"), 120_000, "reopen")
      ).find((m) => m.type === "info-done")!;
      opens.push(done.openMs as number);
    }
    result.openMs = {
      firstCold: (result.probe as { openMsFirstCold: number }).openMsFirstCold,
      repeats: opens.map((n) => round(n)),
      median: round(median(opens)),
    };

    // ---------------------------------------------------------------- 3. THE ENGINE, as shipped
    // 3a. A realistic request: 22 visible slots plus margin (62), the playhead at the middle,
    // once with each decoder through the engine as shipped.
    const memoryStart = await usage(s);
    result.memoryStart = memoryStart;
    const requests: Record<string, unknown> = {};
    let requestId = 1;
    for (const decoder of ["software", "hardware"] as const) {
      await post(page, { type: "close" });
      await post(page, { type: "configure", decoder });
      await clearMessages(page);
      const cpuBefore = await usage(s);
      const requestStart = Date.now();
      const id = requestId++;
      await post(page, {
        type: "request",
        requestId: id,
        fileKey: "take",
        url: takeUrl,
        slots: requestSlots,
        playhead: duration / 2,
        direction: 0,
      });
      const afterRequest = await waitFor(
        page,
        (all) => all.some((m) => m.type === "done" && m.requestId === id),
        600_000,
        `request ${decoder}`,
      );
      const requestMs = Date.now() - requestStart;
      const cpuAfter = await usage(s);
      const doneMsg = afterRequest.find((m) => m.type === "done" && m.requestId === id)!;
      const frameMsgs = afterRequest.filter((m) => m.type === "frame" && m.requestId === id);
      const times = frameMsgs.map((f) => f._workerTime as number);
      const cpuDelta = cpuAfter.cpuSeconds - cpuBefore.cpuSeconds;
      requests[decoder] = {
        slotsAsked: requestSlots.length,
        frames: frameMsgs.length,
        outcome: doneMsg.outcome,
        openedFile: doneMsg.openedFile,
        openMs: round(doneMsg.openMs as number),
        elapsedMs: round(doneMsg.elapsedMs as number),
        wallMs: requestMs,
        cpuSeconds: round(cpuDelta, 2),
        cpuPercentOfOneCore: round((cpuDelta / (requestMs / 1000)) * 100, 0),
        cpuSecondsByType: Object.fromEntries(
          Object.keys(cpuAfter.cpuByType).map((k) => [
            k,
            round(cpuAfter.cpuByType[k] - (cpuBefore.cpuByType[k] ?? 0), 2),
          ]),
        ),
        decodeMedianMs: round(median(frameMsgs.map((f) => f.decodeMs as number))),
        encodeMedianMs: round(median(frameMsgs.map((f) => f.encodeMs as number))),
        jpegBytesMedian: median(frameMsgs.map((f) => f.bytes as number)),
        framesPerSecond: round(frameMsgs.length / (requestMs / 1000)),
        // AC14 from the worker's own timestamps.
        maxFramesInAny1sWindow: maxFramesInWindow(times, 1000),
      };
      if (decoder === "software") await contactSheet(page, "contact-sheet.png");
    }
    result.request62 = requests;
    result.ac14 = {
      limit: 60,
      maxFramesInAny1sWindowSoftware: (requests.software as { maxFramesInAny1sWindow: number })
        .maxFramesInAny1sWindow,
      maxFramesInAny1sWindowHardware: (requests.hardware as { maxFramesInAny1sWindow: number })
        .maxFramesInAny1sWindow,
    };
    // Drop what the loop above left in the buffer, so only this close can satisfy the wait.
    await clearMessages(page);
    await post(page, { type: "close" });
    // The engine posts `closed` only after the file's close resolves; wait for it so it cannot
    // land after the clear below and be counted as an event of the explore run (AC13).
    await waitFor(
      page,
      (all) => all.some((m) => m.type === "file" && m.event === "closed" && m.reason === "close"),
      30_000,
      "close event",
    );
    await post(page, { type: "configure", decoder: PROBE_DECODER });
    await clearMessages(page);

    // 3b. Explore: 25 requests over the file, then memory with the file still open, then idle.
    const memorySamples: unknown[] = [];
    // The page keeps every message it gets; clear it after each request so the memory measured
    // is the app's and not the probe's log. The file events are kept apart for AC13.
    const exploreFileEvents: Message[] = [];
    let lastFrameWorkerTime = 0;
    const exploreStart = Date.now();
    for (let i = 0; i < 25; i++) {
      const centre = (duration * (i + 1)) / 27;
      await post(page, {
        type: "request",
        requestId: 100 + i,
        fileKey: "take",
        url: takeUrl,
        slots: slotsAt(centre, 163),
        playhead: centre,
        direction: i % 2 === 0 ? 1 : -1,
      });
      const got = await waitFor(
        page,
        (all) => all.some((m) => m.type === "done" && m.requestId === 100 + i),
        600_000,
        `explore ${i}`,
      );
      exploreFileEvents.push(...got.filter((m) => m.type === "file"));
      const frameTimes = got.filter((m) => m.type === "frame").map((m) => m._workerTime as number);
      if (frameTimes.length > 0) lastFrameWorkerTime = Math.max(...frameTimes);
      await clearMessages(page);
      if (i % 6 === 5) memorySamples.push({ afterRequests: i + 1, ...(await usage(s)) });
    }
    const memoryOpen = await usage(s);
    result.explore = {
      requests: 25,
      wallMs: Date.now() - exploreStart,
      memoryAfterWithFileOpen: memoryOpen,
      memoryStart,
      memorySamples,
    };

    // AC13: the file is still open (one `opened`, no `closed`) and closes by itself 10 s after
    // the last frame, measured on the worker's own clock.
    const closedMessage = (
      await waitFor(
        page,
        (all) => all.some((m) => m.type === "file" && m.event === "closed" && m.reason === "idle"),
        30_000,
        "idle close",
      )
    ).find((m) => m.type === "file" && m.event === "closed" && m.reason === "idle")!;
    const idleMs = (closedMessage._workerTime as number) - lastFrameWorkerTime;
    await page.waitForTimeout(1500);
    const memoryClosed = await usage(s);
    result.ac13 = {
      openedEventsDuring25Requests: exploreFileEvents.filter((m) => m.event === "opened").length,
      closedEventsBeforeIdle: exploreFileEvents.filter((m) => m.event === "closed").length,
      idleCloseAfterLastFrameMs: round(idleMs, 0),
      memoryAfterIdleClose: memoryClosed,
    };
    expect(result.ac13).toMatchObject({
      openedEventsDuring25Requests: 1,
      closedEventsBeforeIdle: 0,
    });
    expect(idleMs, "the idle close came before 10 s").toBeGreaterThanOrEqual(10_000);
    expect(idleMs, "the idle close came long after 10 s").toBeLessThan(12_000);

    // AC5 (one open file): request the small take while the big one is open, then the big one.
    await clearMessages(page);
    await post(page, {
      type: "request",
      requestId: 500,
      fileKey: "take",
      url: takeUrl,
      slots: slotsAt(duration / 3, 163).slice(0, 6),
      playhead: duration / 3,
      direction: 0,
    });
    await waitFor(
      page,
      (all) => all.some((m) => m.type === "done" && m.requestId === 500),
      300_000,
      "ac5 first",
    );
    const smallUrl = await mediaUrl(page, "take-small");
    const smallDuration = smallInfo.duration as number;
    const smallSlots = planSlots({
      duration: smallDuration,
      visible: { start: smallDuration / 2 - 81, end: smallDuration / 2 + 81 },
      tileSpan: 163 / 17,
      frames: [],
    }).slice(0, 6);
    await post(page, {
      type: "request",
      requestId: 501,
      fileKey: "take-small",
      url: smallUrl,
      slots: smallSlots,
      playhead: smallDuration / 2,
      direction: 0,
    });
    await waitFor(
      page,
      (all) => all.some((m) => m.type === "done" && m.requestId === 501),
      300_000,
      "ac5 second",
    );
    const fileEvents = (await messages(page))
      .filter((m) => m.type === "file")
      .map((m) => `${m.event}${m.reason ? `:${m.reason}` : ""}`);
    let open = 0;
    let maxOpen = 0;
    for (const e of fileEvents) {
      open += e.startsWith("opened") ? 1 : -1;
      maxOpen = Math.max(maxOpen, open);
    }
    result.ac5 = { fileEvents, maxFilesOpenAtOnce: maxOpen };
    expect(maxOpen, "more than one file was open at once").toBe(1);
    expect(fileEvents).toEqual(["opened", "closed:other-file", "opened"]);

    // ---------------------------------------------------------------- AC8: one keyframe, 60 s
    await clearMessages(page);
    const oneUrl = await mediaUrl(page, "one-key");
    await post(page, { type: "info", id: 700, url: oneUrl });
    const oneInfo = (
      await waitFor(page, (all) => all.some((m) => m.type === "info-done"), 60_000, "one-key info")
    ).find((m) => m.type === "info-done")!;
    const oneDuration = oneInfo.duration as number;
    await clearMessages(page);
    await post(page, {
      type: "request",
      requestId: 800,
      fileKey: "one-key",
      url: oneUrl,
      slots: planSlots({
        duration: oneDuration,
        visible: { start: 0, end: oneDuration },
        tileSpan: oneDuration / 17,
        frames: [],
      }),
      playhead: oneDuration / 2,
      direction: 0,
    });
    const oneDone = (
      await waitFor(
        page,
        (all) => all.some((m) => m.type === "done" && m.requestId === 800),
        300_000,
        "ac8",
      )
    ).find((m) => m.type === "done" && m.requestId === 800)!;
    result.ac8 = {
      duration: round(oneDuration, 2),
      keyframesSeen: (oneInfo.firstKeys as number[]).length,
      frames: oneDone.frames,
      skippedOverCap: oneDone.skippedOverCap,
      skippedNoFrame: oneDone.skippedNoFrame,
      failed: oneDone.failed,
      elapsedMs: round(oneDone.elapsedMs as number),
    };

    // Is the memory the worker's? Terminate it and look again.
    await waitFor(
      page,
      (all) => all.some((m) => m.type === "file" && m.event === "closed" && m.reason === "idle"),
      30_000,
      "idle close before terminate",
    );
    const beforeTerminate = await usage(s);
    await page.evaluate(() =>
      (window as unknown as { __probe: { worker: Worker } }).__probe.worker.terminate(),
    );
    await page.waitForTimeout(3000);
    result.memoryTerminate = { before: beforeTerminate.byTypeMb, after: (await usage(s)).byTypeMb };

    // AC8: on a file with one keyframe the far slots are skipped (the plan-time decision only).
    expect(result.ac8).toMatchObject({ failed: 0 });
    expect((result.ac8 as { skippedOverCap: number }).skippedOverCap).toBeGreaterThan(0);
    // AC14: never more than 60 frames in any 1 s window, with either decoder. A 62-slot request
    // can pass without the pacer sleeping; the unit tests drive the pacer past the limit.
    const pace = result.ac14 as {
      limit: number;
      maxFramesInAny1sWindowSoftware: number;
      maxFramesInAny1sWindowHardware: number;
    };
    expect(pace.maxFramesInAny1sWindowSoftware).toBeLessThanOrEqual(pace.limit);
    expect(pace.maxFramesInAny1sWindowHardware).toBeLessThanOrEqual(pace.limit);

    await s.shot("done");
  } finally {
    await writeFile(path.join(OUT, "result.json"), JSON.stringify(result, null, 2));
    console.log(`[verify] ${NAME}: ${JSON.stringify(result)}`);
    await s.finish();
  }
});
