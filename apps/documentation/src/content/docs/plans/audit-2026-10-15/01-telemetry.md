---
title: "01 · Telemetry for the four flows"
description: "Closes REC-A3, LIB-A9, LIB-B13, SHOT-A8, SHOT-B6, VID-A6: nothing measures recording, library listing, screenshot capture/export or video export, so 'it feels slower' cannot be answered with data."
---

# Telemetry for the four flows — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every core flow emits one PostHog event per outcome with the numbers that answer "was it slow, and why": `recording_completed`/`recording_failed`, `export_completed`/`export_failed`/`export_cancelled`, `library_listed`, `screenshot_captured`, `screenshot_exported`; catalog refresh failures and screenshot capture failures reach PostHog as exceptions; the two silent failure paths in screenshot capture get handled.

**Architecture:** Event names and a `timed()` helper live in `shared/analytics.ts` (no imports — safe for the preload bundle). The renderer keeps using `captureEvent` (posthog-js, main window) with a DEV console mirror; the main process gains `captureMainEvent` next to the existing `captureMainException` (posthog-node). `LibraryService` stays Electron-free through optional `onListed`/`onRefreshFailed` hooks wired in `main/library/index.ts`. The recorder engine collects start-up facts in a `stats` field the store reads at stop time. Properties are numbers, booleans and short enums only — never titles, paths, ids or error text.

**Tech Stack:** posthog-js (renderer), posthog-node (main), vitest. There is no file logger (`electron-log` is not a dependency); in a packaged build only PostHog survives, and only when `VITE_POSTHOG_KEY`/`MAIN_VITE_POSTHOG_KEY` were baked in at build time.

**Spec:** [Audit report](/audits/2026-10-15/report/) → REC-A3 ([record A](/audits/2026-10-15/findings/record-a/)), LIB-A9 ([library A](/audits/2026-10-15/findings/library-a/)), LIB-B13 ([library B](/audits/2026-10-15/findings/library-b/)), SHOT-A8 ([screenshot A](/audits/2026-10-15/findings/screenshot-a/)), SHOT-B6 ([screenshot B](/audits/2026-10-15/findings/screenshot-b/)), VID-A6 ([video A](/audits/2026-10-15/findings/video-a/)). Closes: **REC-A3, LIB-A9, LIB-B13, SHOT-A8, SHOT-B6, VID-A6**.

## Global Constraints

- Paths are relative to `apps/kaipu-record/src/`. Tests: `node_modules/.bin/vitest run <file>` from `apps/kaipu-record` — never `bunx`. No local Playwright.
- `shared/**` takes no value imports from workspace packages. `shared/analytics.ts` must stay import-free.
- The "never titles, paths, ids or error text" rule covers **event properties**. `captureMainException` is the existing crash-report path (gated by Send diagnostics, like `uncaughtException` today) and forwards the raw error, so an `execFile` message can carry the temp PNG path or stderr. Before wiring the two new exception calls, strip absolute paths from `error.message` in `buildExceptionProperties`, or report them as events with an error-kind enum instead.
- Event names are snake_case. The one pre-existing event, `library-detail-missing`, keeps its kebab-case name (renaming splits its PostHog history).
- Never emit `recording_completed` from main's `recording:finalize` handler: that IPC is shared with video exports (double count). Emit it only from `recorder-store.stopRecording`.
- A telemetry hook must never change a flow's result: every hook call is wrapped in `try/catch`.
- Two suites mock the analytics barrel without `captureEvent` — `recorder-store.test.ts:18` and `export-runner.test.ts:23`. Extend those mocks in the same commit that imports `captureEvent`, or they fail at call time. Also check `rg 'features/analytics"' --glob '*.test.*'`.
- Deferred, state in the PR: frame-drop counters and `maxWriteQueue` (REC-A3), GIF and editor-open events (VID-A6), compositor w/h/scale error context (SHOT-A8.3, deferred because plans 31–33 edit `compositor.ts`), the stale-catalog UI hint (LIB-B13), `tags:list` timing, and a file log sink.
- Commit messages in English, conventional-commit style.

## Review Focus

1. A throwing `onListed`/`onRefreshFailed` hook must not reject `list()`/`refreshCatalog()` — Task 5 tests.
2. `cancelVideoExport()` when idle (it doubles as "dismiss error") must emit nothing — Task 4 test.
3. `recording_failed` must fire once per failure with the right `phase` (`start`, `mid-recording`, `finalize`) and never alongside `recording_completed` — Task 3 tests.
4. The `screencapture` temp PNG must be removed when `readPng` throws — Task 6 test.
5. A rejected `captureScreenshot()` from the hotkey must show a toast and not open the editor — Task 6 test (today the rejection is unhandled because preload drops the promise).

---

### Task 1: Event names and `timed()` in `shared/analytics.ts`

**Files:**

- Modify: `shared/analytics.ts` (append after `DEFAULT_SURFACE`, line 25)
- Create: `shared/analytics.test.ts`

**Interfaces:**

- Produces: `EVENT_NAMES` (const object), `EventName` type, `timed<T>(fn: () => Promise<T>, now?: () => number): Promise<{ value: T; ms: number }>`.

- [ ] **Step 1: Write the failing tests**

```ts
// shared/analytics.test.ts
import { describe, expect, it } from "vitest";
import { EVENT_NAMES, timed } from "./analytics";

describe("EVENT_NAMES", () => {
  it("has unique values, snake_case except the legacy one", () => {
    const values = Object.values(EVENT_NAMES);
    expect(new Set(values).size).toBe(values.length);
    for (const v of values) {
      if (v === "library-detail-missing") continue;
      expect(v).toMatch(/^[a-z]+(_[a-z]+)*$/);
    }
  });
});

describe("timed", () => {
  it("returns the value and the elapsed ms from the injected clock", async () => {
    const ticks = [100, 142];
    const out = await timed(async () => "v", () => ticks.shift()!);
    expect(out).toEqual({ value: "v", ms: 42 });
  });
  it("rejects when fn rejects", async () => {
    await expect(timed(async () => { throw new Error("x"); })).rejects.toThrow("x");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node_modules/.bin/vitest run src/shared/analytics.test.ts`
Expected: FAIL — `EVENT_NAMES`/`timed` are not exported.

- [ ] **Step 3: Implement**

Append to `shared/analytics.ts`:

```ts
/** Product events, snake_case. `library-detail-missing` predates this list; its name stays. */
export const EVENT_NAMES = {
  recordingCompleted: "recording_completed",
  recordingFailed: "recording_failed",
  exportCompleted: "export_completed",
  exportFailed: "export_failed",
  exportCancelled: "export_cancelled",
  libraryListed: "library_listed",
  screenshotCaptured: "screenshot_captured",
  screenshotExported: "screenshot_exported",
  libraryDetailMissing: "library-detail-missing",
} as const;
export type EventName = (typeof EVENT_NAMES)[keyof typeof EVENT_NAMES];

/** Run `fn`; return its value and elapsed ms. `now` is injectable for tests. */
export async function timed<T>(
  fn: () => Promise<T>,
  now: () => number = () => performance.now(),
): Promise<{ value: T; ms: number }> {
  const start = now();
  const value = await fn();
  return { value, ms: Math.round(now() - start) };
}
```

- [ ] **Step 4: Run to verify it passes** — `node_modules/.bin/vitest run src/shared/analytics.test.ts` → PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/analytics.ts src/shared/analytics.test.ts
git commit -m "feat(desktop): event name constants and a timed() helper for telemetry"
```

### Task 2: `captureMainEvent` in main, typed `captureEvent` in the renderer

**Files:**

- Modify: `main/services/analytics.service.ts` (after `captureMainException`, line 55)
- Modify: `renderer/src/features/analytics/analytics-client.ts:46-54`
- Modify: `renderer/src/features/library/hooks/use-missing-recording-recovery.ts:67`
- Test: `main/services/analytics.service.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `analytics.service.test.ts` (pure tests only; never mock `posthog-node` here):

```ts
import { buildEventProperties } from "./analytics.service";

it("buildEventProperties adds the identity super-properties and keeps props", () => {
  expect(buildEventProperties({ items: 3 })).toEqual({
    product: "kaipu-recorder",
    surface: "desktop",
    items: 3,
  });
  expect(buildEventProperties()).toEqual({ product: "kaipu-recorder", surface: "desktop" });
});
```

- [ ] **Step 2: Run to verify it fails** — `node_modules/.bin/vitest run src/main/services/analytics.service.test.ts` → FAIL, not exported.

- [ ] **Step 3: Implement**

`main/services/analytics.service.ts` — add `type EventName` to the `@shared/analytics` import and append:

```ts
/** Pure: identity super-properties merged into every product event. */
export function buildEventProperties(props?: Record<string, unknown>): Record<string, unknown> {
  return { product: DEFAULT_PRODUCT, surface: DEFAULT_SURFACE, ...props };
}

/** Send a named product event from the main process. No-op without a PostHog key. */
export function captureMainEvent(name: EventName, props?: Record<string, unknown>): void {
  if (import.meta.env.DEV) console.info("[event]", name, props ?? {});
  if (!client) return;
  client.capture({ distinctId, event: name, properties: buildEventProperties(props) });
}
```

`renderer/src/features/analytics/analytics-client.ts` — replace `captureEvent`:

```ts
export function captureEvent(name: EventName, props?: Record<string, unknown>): void {
  if (import.meta.env.DEV) console.info("[captureEvent]", name, props ?? {});
  if (!started) return;
  posthog.capture(name, props);
}
```

(import `type EventName` from `@shared/analytics`). In `use-missing-recording-recovery.ts:67` replace the literal `"library-detail-missing"` with `EVENT_NAMES.libraryDetailMissing` (same value; its test keeps passing).

- [ ] **Step 4: Run** — `node_modules/.bin/vitest run src/main/services/analytics.service.test.ts src/renderer/src/features/library/hooks/use-missing-recording-recovery.test.ts && bun run check-types` → PASS, types green.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/analytics.service.ts src/main/services/analytics.service.test.ts src/renderer/src/features/analytics/analytics-client.ts src/renderer/src/features/library/hooks/use-missing-recording-recovery.ts
git commit -m "feat(desktop): typed product events from main and renderer"
```

### Task 3: `recording_completed` / `recording_failed` (REC-A3)

**Files:**

- Modify: `renderer/src/features/recording/recorder-engine.ts:20-45` (`EngineHandle`), `:136-174` (start), `:261-272` (`onEncoderConfig`), the returned handle (~`:297`)
- Modify: `renderer/src/features/recording/recorder-store.ts:163-252` (`beginEngine`), `:323-380` (`stopRecording`)
- Test: `renderer/src/features/recording/recorder-store.test.ts`

**Interfaces:**

- Produces: `EngineHandle.stats: { gumMs: number; hwEncoder: string | null; compositor: boolean; width: number | null; height: number | null; bitrate: number | null }`.

- [ ] **Step 1: Write the failing tests**

In `recorder-store.test.ts`: change the analytics mock to `vi.mock("@renderer/features/analytics", () => ({ reportError: vi.fn(), captureEvent: vi.fn() }))`, import `captureEvent` from the barrel, and give the fake engine handle a `stats` object: `{ gumMs: 120, hwEncoder: "prefer-hardware", compositor: false, width: 1920, height: 1080, bitrate: 8_000_000 }`. Then:

```ts
it("emits one recording_completed with engine stats and timings", async () => {
  await startAndFinishCountdown(); // use the suite's existing helper that reaches status "recording"
  await stopRecording();
  const calls = vi.mocked(captureEvent).mock.calls.filter(([n]) => n === "recording_completed");
  expect(calls).toHaveLength(1);
  expect(calls[0][1]).toMatchObject({ hwEncoder: "prefer-hardware", gumMs: 120, compositor: false });
  expect(typeof calls[0][1]!.startMs).toBe("number");
  expect(typeof calls[0][1]!.finalizeMs).toBe("number");
});

it("emits recording_failed {phase:'start'} when the engine fails to start", async () => {
  vi.mocked(startEngine).mockRejectedValueOnce(new Error("gUM denied"));
  await startAndFinishCountdown();
  expect(captureEvent).toHaveBeenCalledWith("recording_failed", { phase: "start" });
  expect(captureEvent).not.toHaveBeenCalledWith("recording_completed", expect.anything());
});

it("emits recording_failed {phase:'finalize'} when finalize rejects", async () => {
  window.electronAPI.recordingFinalize = vi.fn(async () => { throw new Error("ENOSPC"); });
  await startAndFinishCountdown();
  await stopRecording();
  expect(captureEvent).toHaveBeenCalledWith("recording_failed", { phase: "finalize" });
});
```

Adapt helper names to the suite's existing ones (it already drives the countdown with fake timers).

- [ ] **Step 2: Run to verify they fail** — `node_modules/.bin/vitest run src/renderer/src/features/recording/recorder-store.test.ts` → FAIL (no events).

- [ ] **Step 3: Implement the engine side**

`recorder-engine.ts` — in `EngineHandle` after `hasSystemAudio`:

```ts
  /** Start-up facts for telemetry. Filled once the encoder reports its config, so read at stop time. */
  stats: {
    gumMs: number;
    hwEncoder: string | null;
    compositor: boolean;
    width: number | null;
    height: number | null;
    bitrate: number | null;
  };
```

In `startEngine`: before the first screen `getUserMedia` (~line 136) add `const gumT0 = performance.now();` and `const stats: EngineHandle["stats"] = { gumMs: 0, hwEncoder: null, compositor: false, width: null, height: null, bitrate: null };`. After the screen stream resolves (~150): `stats.gumMs = Math.round(performance.now() - gumT0);`. After the compositor decision (line 174): `stats.compositor = compositor !== null;`. In `onEncoderConfig` (keep the `console.info`):

```ts
      stats.hwEncoder = config.hardwareAcceleration ?? null;
      stats.width = config.width ?? null;
      stats.height = config.height ?? null;
      stats.bitrate = config.bitrate ?? null;
```

Add `stats,` to the returned handle object. Run `bun run check-types`: every fake `EngineHandle` in tests now needs `stats` — add it where the compiler points.

- [ ] **Step 4: Implement the store side**

`recorder-store.ts` — imports: `captureEvent` from `@renderer/features/analytics`, `EVENT_NAMES` from `@shared/analytics`. Module vars: `let startMs = 0; let lastInput: StartInput | null = null;`. In `beginEngine`: first lines `const t0 = performance.now(); lastInput = input;`; right after `update({ status: "recording", countdown: null });` add `startMs = Math.round(performance.now() - t0);`. In its `catch` next to the existing `reportError(runtimeT()("record.errorStart"), ...)` add `captureEvent(EVENT_NAMES.recordingFailed, { phase: "start" });`. In the `onError` callback next to `reportError(runtimeT()("record.errorStopped"), ...)` add `captureEvent(EVENT_NAMES.recordingFailed, { phase: "mid-recording" });`.

In `stopRecording`, measure finalize inside the IIFE (so the `MIN_SAVING_MS` dwell is excluded):

```ts
  let finalizeMs = 0;
  // ...
      (async (): Promise<LocalRecording> => {
        const f0 = performance.now();
        await activeEngine.stop();
        const finalized = await window.electronAPI.recordingFinalize(activeSessionId, {
          title, durationSeconds, durationMs, thumbnail: activeEngine.thumbnail,
        });
        finalizeMs = Math.round(performance.now() - f0);
        return finalized;
      })(),
```

In the `catch` next to `reportError(runtimeT()("record.errorSave"), ...)` add `captureEvent(EVENT_NAMES.recordingFailed, { phase: "finalize" });`. After the try/catch, before the `completeListeners` loop:

```ts
  if (recording) {
    captureEvent(EVENT_NAMES.recordingCompleted, {
      startMs,
      gumMs: activeEngine.stats.gumMs,
      hwEncoder: activeEngine.stats.hwEncoder,
      compositor: activeEngine.stats.compositor,
      width: activeEngine.stats.width,
      height: activeEngine.stats.height,
      bitrate: activeEngine.stats.bitrate,
      fps: lastInput?.frameRate ?? null,
      durationMs,
      finalizeMs,
      sizeBytes: recording.sizeBytes,
      mic: Boolean(lastInput?.microphoneDeviceId),
      systemAudio: activeEngine.hasSystemAudio,
    });
  }
```

- [ ] **Step 5: Run and commit**

Run: `node_modules/.bin/vitest run src/renderer/src/features/recording/ && bun run check-types` → PASS.

```bash
git add src/renderer/src/features/recording/
git commit -m "feat(desktop): recording_completed and recording_failed telemetry"
```

### Task 4: `export_completed` / `export_failed` / `export_cancelled` (VID-A6)

**Files:**

- Modify: `renderer/src/features/video-editor/export/export-runner.ts` (`launch`, `encoder` branch, `done` branch `:398-438`, `fail` `:300-307`, `cancelVideoExport` `:193+`)
- Test: `renderer/src/features/video-editor/export/export-runner.test.ts`

- [ ] **Step 1: Write the failing tests**

Extend the hoisted mock: `const { captureException, captureEvent } = vi.hoisted(() => ({ captureException: vi.fn(), captureEvent: vi.fn() })); vi.mock("@renderer/features/analytics", () => ({ captureException, captureEvent }));`. Using the suite's `FakeWorker` driving:

```ts
it("emits export_completed with size and estimate on done", async () => {
  await startExportWithFakeWorker(); // the suite's existing setup that reaches workers[0]
  workers[0].onmessage!({ data: { type: "done", /* fields the suite already sends */ } } as MessageEvent);
  await flush();
  const call = captureEvent.mock.calls.find(([n]) => n === "export_completed")!;
  expect(call[1]).toMatchObject({ kind: "video", bytes: 8_100_000, estimateBytes: JOB.estimateBytes });
});

it("emits export_failed on a worker error", async () => {
  await startExportWithFakeWorker();
  workers[0].onmessage!({ data: { type: "error", message: "boom" } } as MessageEvent);
  await flush();
  expect(captureEvent).toHaveBeenCalledWith("export_failed", expect.objectContaining({ kind: "video" }));
});

it("emits export_cancelled mid-export and nothing when idle", async () => {
  await startExportWithFakeWorker();
  cancelVideoExport();
  expect(captureEvent).toHaveBeenCalledWith("export_cancelled", expect.objectContaining({ kind: "video" }));
  captureEvent.mockClear();
  cancelVideoExport(); // idle: doubles as "dismiss error"
  expect(captureEvent).not.toHaveBeenCalled();
});
```

Match the message shapes and helper names the suite already uses.

- [ ] **Step 2: Run to verify they fail** — `node_modules/.bin/vitest run src/renderer/src/features/video-editor/export/export-runner.test.ts` → FAIL.

- [ ] **Step 3: Implement**

Import `captureEvent` next to `captureException`; import `EVENT_NAMES`. In `launch`, next to `let poster`: `let encoderChoice: VideoEncodingChoice | null = null;` and in the `encoder` message branch `encoderChoice = msg.choice;` before `reportEncoderChoice(...)`. In the `done` branch, read the attempt start **before** `set({ ...IDLE })` resets it:

```ts
            if (!active) return;
            const attemptStartedAt = snapshot.attemptStartedAt;
            worker?.terminate();
            worker = null;
            sessionId = null;
            active = false;
            set({ ...IDLE, ready: { job, recording } });
            const elapsedMs = attemptStartedAt === null ? null : Date.now() - attemptStartedAt;
            captureEvent(EVENT_NAMES.exportCompleted, {
              kind: "video",
              presetId,
              outputSec: plan.totalDuration,
              elapsedMs,
              realtimeFactor: elapsedMs ? Math.round((plan.totalDuration / (elapsedMs / 1000)) * 100) / 100 : null,
              bytes: recording.sizeBytes,
              estimateBytes: job.estimateBytes,
              width: job.width,
              height: job.height,
              softwareFallback: encoderChoice?.softwareFallback ?? false,
              rateControl: encoderChoice?.rateControl ?? null,
              fastStart: runTarget.fastStart !== false,
            });
```

In `fail()`: `captureEvent(EVENT_NAMES.exportFailed, { kind: "video", presetId });`. In `cancelVideoExport()`, before `active = false`:

```ts
  if (active) {
    captureEvent(EVENT_NAMES.exportCancelled, {
      kind: "video",
      presetId: snapshot.job?.presetId ?? null,
      fraction: Math.round(snapshot.fraction * 100) / 100,
    });
  }
```

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/renderer/src/features/video-editor/export/ && bun run check-types` → PASS (also covers `use-video-export.test.ts`, `use-gif-export.test.ts` mocks).

```bash
git add src/renderer/src/features/video-editor/export/
git commit -m "feat(desktop): export_completed, export_failed and export_cancelled telemetry"
```

### Task 5: `library_listed` and catalog refresh failures (LIB-A9, LIB-B13)

**Files:**

- Modify: `main/library/library-service.ts:20-27` (deps), `list()` `:39-68`, `doRefresh` `:78-105`
- Modify: `main/library/index.ts:60-68` (wiring)
- Test: `main/library/library-service.test.ts`

**Interfaces:**

- Produces: `LibraryServiceDeps.onListed?: (stats: { items: number; recordings: number; screenshots: number; catalogEntries: number; ms: number; vaultError: boolean }) => void`, `LibraryServiceDeps.onRefreshFailed?: (error: unknown, stats: { ms: number }) => void`.

- [ ] **Step 1: Write the failing tests**

Using the suite's existing fixtures (temp vault, `CatalogCache`, `fetchCatalog = vi.fn(...)`, `now: () => 777`):

```ts
it("calls onListed once with the item count", async () => {
  const onListed = vi.fn();
  const svc = makeService({ onListed }); // extend the suite's builder to spread extra deps
  const result = await svc.list();
  expect(onListed).toHaveBeenCalledTimes(1);
  expect(onListed.mock.calls[0][0]).toMatchObject({ items: result.items.length, vaultError: false });
  expect(typeof onListed.mock.calls[0][0].ms).toBe("number");
});

it("a throwing onListed does not reject list()", async () => {
  const svc = makeService({ onListed: () => { throw new Error("hook"); } });
  await expect(svc.list()).resolves.toBeTruthy();
});

it("reports a network refresh failure through onRefreshFailed and still returns network", async () => {
  const onRefreshFailed = vi.fn();
  const svc = makeService({ fetchCatalog: vi.fn(async () => { throw new Error("boom"); }), onRefreshFailed });
  await expect(svc.refreshCatalog()).resolves.toEqual({ ok: false, reason: "network" });
  expect(onRefreshFailed.mock.calls[0][0]).toBeInstanceOf(Error);
});

it("does not report unauthorized or signed-out refreshes", async () => {
  const onRefreshFailed = vi.fn();
  const svc = makeService({ fetchCatalog: vi.fn(async () => { throw { kind: "unauthorized" }; }), onRefreshFailed });
  await svc.refreshCatalog();
  const signedOut = makeService({ account: () => null, onRefreshFailed });
  await signedOut.refreshCatalog();
  expect(onRefreshFailed).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify they fail** — `node_modules/.bin/vitest run src/main/library/library-service.test.ts` → FAIL (hooks never called / type error).

- [ ] **Step 3: Implement**

`library-service.ts` deps:

```ts
  /** Telemetry hooks; absent in tests. A throwing hook never breaks a list/refresh. */
  onListed?: (stats: {
    items: number;
    recordings: number;
    screenshots: number;
    catalogEntries: number;
    ms: number;
    vaultError: boolean;
  }) => void;
  onRefreshFailed?: (error: unknown, stats: { ms: number }) => void;
```

`list()`: first line `const t0 = performance.now();`; replace `return { items, vaultError, catalogVerifiedAt };` with:

```ts
    try {
      this.deps.onListed?.({
        items: items.length,
        recordings: items.filter((i) => i.kind === "recording").length,
        screenshots: items.filter((i) => i.kind === "screenshot").length,
        catalogEntries: catalog?.length ?? 0,
        ms: Math.round(performance.now() - t0),
        vaultError: vaultError !== null,
      });
    } catch {
      // telemetry must never break a list
    }
    return { items, vaultError, catalogVerifiedAt };
```

(Confirm the discriminator is `kind` in `@shared/types/library-item`.) `doRefresh`: `const t0 = performance.now();` before `try`; in the `catch`, after the `unauthorized` return and before `return { ok: false, reason: "network" }`:

```ts
      try {
        this.deps.onRefreshFailed?.(err, { ms: Math.round(performance.now() - t0) });
      } catch {
        // telemetry must never change the refresh result
      }
```

`main/library/index.ts` — import `captureMainEvent, captureMainException` from `../services/analytics.service` and `EVENT_NAMES` from `@shared/analytics`; add to the `LibraryService` deps:

```ts
    onListed: (() => {
      let sent = false;
      return (stats) => {
        // First list of the session, plus any list slower than 1.5 s.
        if (sent && stats.ms < 1500) return;
        sent = true;
        captureMainEvent(EVENT_NAMES.libraryListed, stats);
      };
    })(),
    onRefreshFailed: (() => {
      let reported = false;
      return (error, stats) => {
        console.error("catalog refresh failed", error);
        // The refresh runs on every Library mount: report once per session, not per mount.
        if (reported) return;
        reported = true;
        captureMainException(error, "catalog-refresh", stats);
      };
    })(),
```

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/main/library/library-service.test.ts && bun run check-types` → PASS.

```bash
git add src/main/library/library-service.ts src/main/library/library-service.test.ts src/main/library/index.ts
git commit -m "feat(desktop): library_listed timing and catalog refresh failure reporting"
```

### Task 6: Screenshot capture failures handled, temp file cleaned, capture/export events (SHOT-A8, SHOT-B6)

**Files:**

- Modify: `main/screenshots/screenshot-capture.ts:42-49`
- Modify: `main/screenshots/screenshot-ipc.ts:39-59`
- Modify: `renderer/src/features/screenshots/use-screenshot-capture.ts:20-21`, `:36`
- Modify: `renderer/src/pages/screenshot-editor/screenshot-editor-page.tsx` (`exportAs` `:202-207`, `copyToClipboard` `:214-231`, `persist` `:241-271`, `onExportPdf` `:277-296`)
- Modify: `packages/i18n/messages/en.json:642`, `es.json:642` (namespace `screenshots`)
- Test: `main/screenshots/screenshot-capture.test.ts`, create `renderer/src/features/screenshots/use-screenshot-capture.test.tsx`

- [ ] **Step 1: Write the failing tests**

`screenshot-capture.test.ts` (the `rm` is imported directly, so use a real temp file):

```ts
it("removes the temp file when reading the PNG fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shot-"));
  const target = join(dir, "x.png");
  await writeFile(target, "png");
  const provider = new MacNativeProvider({
    runCli: vi.fn(async () => {}),
    readPng: vi.fn(async () => { throw new Error("corrupt"); }),
    fileExists: vi.fn(async () => true),
    tempPath: () => target,
  });
  await expect(provider.captureInteractive()).rejects.toThrow("corrupt");
  await expect(stat(target)).rejects.toThrow();
});
```

`use-screenshot-capture.test.tsx` (imitate `use-capture-title.test.ts` for `renderHook`):

```tsx
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { reportError, captureEvent, openCapture } = vi.hoisted(() => ({
  reportError: vi.fn(),
  captureEvent: vi.fn(),
  openCapture: vi.fn(),
}));
vi.mock("@renderer/features/analytics", () => ({ reportError, captureEvent }));
vi.mock("@renderer/features/editor/open-in-editor", () => ({ useOpenInEditor: () => ({ openCapture }) }));
vi.mock("@renderer/features/recording/recorder-store", () => ({ getRecorderSnapshot: () => ({ status: "idle" }) }));

import { useScreenshotCapture } from "./use-screenshot-capture";

describe("useScreenshotCapture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.electronAPI = { captureScreenshot: vi.fn(), revealAfterCapture: vi.fn() } as never;
  });

  it("reports a capture failure and does not open the editor", async () => {
    vi.mocked(window.electronAPI.captureScreenshot).mockRejectedValueOnce(new Error("screencapture exited 1"));
    const { result } = renderHook(() => useScreenshotCapture());
    await act(() => result.current.capture());
    expect(reportError).toHaveBeenCalledWith(expect.stringMatching(/screenshot/i), expect.any(Error), expect.anything());
    expect(openCapture).not.toHaveBeenCalled();
  });

  it("does nothing on cancel", async () => {
    vi.mocked(window.electronAPI.captureScreenshot).mockResolvedValueOnce(null);
    const { result } = renderHook(() => useScreenshotCapture());
    await act(() => result.current.capture());
    expect(reportError).not.toHaveBeenCalled();
    expect(openCapture).not.toHaveBeenCalled();
  });

  it("emits screenshot_captured with the size on success", async () => {
    vi.mocked(window.electronAPI.captureScreenshot).mockResolvedValueOnce({ png: new ArrayBuffer(10), width: 4, height: 3 });
    const { result } = renderHook(() => useScreenshotCapture());
    await act(() => result.current.capture());
    expect(captureEvent).toHaveBeenCalledWith("screenshot_captured", { w: 4, h: 3, bytes: 10 });
  });
});
```

Adjust the mocked module paths to the hook's real imports (read the file's import lines first).

- [ ] **Step 2: Run to verify they fail** — both files → FAIL.

- [ ] **Step 3: Implement**

`screenshot-capture.ts`:

```ts
  async captureInteractive(): Promise<Buffer | null> {
    const target = this.deps.tempPath();
    await this.deps.runCli("screencapture", ["-i", "-o", target]);
    if (!(await this.deps.fileExists(target))) return null; // user pressed Esc
    try {
      return await this.deps.readPng(target);
    } finally {
      await rm(target, { force: true }).catch(() => {});
    }
  }
```

`screenshot-ipc.ts` — add a `catch` between the existing `try` and `finally` around `provider.captureInteractive()`:

```ts
    } catch (error) {
      console.error("screenshot capture failed", error); // execFile errors carry code + stderr
      captureMainException(error, "screenshot-capture");
      throw error;
    } finally {
```

(import `captureMainException` from `../services/analytics.service`).

`use-screenshot-capture.ts` — replace lines 20-21:

```ts
    let shot: Awaited<ReturnType<typeof window.electronAPI.captureScreenshot>>;
    try {
      shot = await window.electronAPI.captureScreenshot();
    } catch (error) {
      reportError(t("captureError"), error, { context: { phase: "capture" } });
      return;
    }
    if (!shot) return; // cancelled — main already restored the window if needed
```

and after `window.electronAPI.revealAfterCapture();` add `captureEvent(EVENT_NAMES.screenshotCaptured, { w: shot.width, h: shot.height, bytes: shot.png.byteLength });`. Add `t` (the `screenshots` namespace translator the file or its siblings already use) to the `useCallback` deps. i18n, after `captureWhileRecording`: en `"captureError": "Couldn't take the screenshot. Try again."`, es `"captureError": "No se pudo tomar la captura. Inténtalo de nuevo."`. Run the i18n package's parity test/build if it has one.

`screenshot-editor-page.tsx` — import `timed`, `EVENT_NAMES` from `@shared/analytics` and `captureEvent` from `@renderer/features/analytics`:

```ts
  const lastExportMs = useRef(0);
  const exportAs = async (format: ExportFormat): Promise<ArrayBuffer> => {
    const { value, ms } = await timed(async () =>
      exportScene(format, {
        scene: { beautify: scene.beautify.state, annotations: scene.annotations, crop: scene.crop },
        bytes: await image!.getBytes(),
        displayedW: imgRef.current?.clientWidth ?? 0,
      }),
    );
    lastExportMs.current = ms;
    return value;
  };
  const trackExport = (kind: "copy" | "save" | "autosave" | "pdf", bytes: number): void =>
    captureEvent(EVENT_NAMES.screenshotExported, {
      kind,
      bytes,
      ms: lastExportMs.current,
      annotations: scene.annotations.length,
    });
```

Call sites, holding the buffer in a local so `byteLength` is known: in `copyToClipboard` after `copyImageToClipboard` resolves → `trackExport("copy", png.byteLength)`; in `persist` after `setSavedId(...)` → `trackExport(opts.silent ? "autosave" : "save", png.byteLength)`; in `onExportPdf` inside `if (written)` → `trackExport("pdf", pdf.byteLength)`.

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/main/screenshots/ src/renderer/src/features/screenshots/ && bun run check-types` → PASS.

```bash
git add src/main/screenshots/ src/renderer/src/features/screenshots/use-screenshot-capture.ts src/renderer/src/features/screenshots/use-screenshot-capture.test.tsx src/renderer/src/pages/screenshot-editor/screenshot-editor-page.tsx ../../packages/i18n/messages/en.json ../../packages/i18n/messages/es.json
git commit -m "fix(desktop): handle screenshot capture failures, clean the temp PNG, add capture/export telemetry"
```

### Task 7: Ship

- [ ] Full suite + types: `node_modules/.bin/vitest run && bun run check-types` → green.
- [ ] Open a PR titled `feat(desktop): telemetry for recording, export, library and screenshots (audit batch 1)` linking this plan and the six findings; list the deferred items from Global Constraints. End with **How to test it yourself** (`bun run dev`, DevTools console of the main window + the terminal for main; dev builds have no PostHog key, so events show only as `[captureEvent]` / `[event]` lines):
  1. Record 5 s and stop → console shows `[captureEvent] recording_completed {…}` with `hwEncoder`, `startMs`, `finalizeMs`, `sizeBytes`.
  2. Export a video → `export_completed` with `realtimeFactor` and `bytes`; cancel one mid-way → `export_cancelled` with `fraction`.
  3. Open the Library → terminal shows `[event] library_listed {items, ms, …}` once; navigate away and back → no second line unless the list took >1.5 s.
  4. Copy, Save and Export-PDF a screenshot → three `screenshot_exported` lines with `kind` and `ms`.
  5. Press ⌘⌃X and Esc in the region selector → no toast. Start a second capture overlay (e.g. macOS ⌘⇧5) and then ⌘⌃X → toast "Couldn't take the screenshot", error in the terminal, no leftover PNG in `$TMPDIR`.
- [ ] The PR deletes this plan file and removes its row from `plans/audit-2026-10-15/00-index.md`.
