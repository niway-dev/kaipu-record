---
title: "E2E testing harness — Playwright + Electron"
description: "Implementation plan for a local-first Playwright E2E harness that launches the real kaipu-record production build against an isolated vault fixture, with regression tests for video-editor seek-then-play and export."
---

# E2E Testing Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a local-first Playwright + Electron E2E harness that launches the real
production build against an isolated vault fixture and guards the video-editor
seek-then-play and export regressions.

**Architecture:** Playwright's `_electron.launch` owns the app lifecycle, launching the
built `out/main/index.js` (renderer loads via `file://`, like the packaged `.app`). Each
run gets a throwaway `--user-data-dir` and a throwaway vault seeded with one committed
fixture recording, pointed at through the existing `preferences.json` vault-override
mechanism — no app code changes. Tests drive the renderer with auto-waiting locators and
assert on observable state (`<video>` properties, route) and, for export, the on-disk
output via `ffprobe`.

**Tech Stack:** Playwright (`@playwright/test`), Electron 39, TypeScript, Bun, ffmpeg/ffprobe
(fixture generation + output validation), mediabunny (already in the app).

## Global Constraints

- **Prerequisite branch base:** the regression tests assert FIXED behavior, which now lives
  in `main` (PR #28 merged, commits `f41706f` Range/seeking + `5a2af0e` export CORS + worker
  audio). Implement on a branch based on `main`; the fixes are present so the tests pass green.
- **Package manager:** Bun. Install with `bun add -D`, run with `bunx`. CI uses bun 1.3.4.
- **Language:** English for all code, comments, file names. Comments explain _why_, not the
  next line. Kebab-case file names.
- **Formatting:** `bunx oxfmt --check .` from the repo root must pass before every commit;
  double quotes + semicolons. Never `--no-verify`.
- **No new runtime deps:** `@playwright/test` is a **devDependency** only.
- **Isolation is mandatory:** tests must never read or write the developer's real profile or
  `~/Movies/Kaipu Record`. All state lives in per-run temp dirs that teardown removes.
- **No fixed sleeps** in test logic — waits are condition-based. The one exception is the
  export's single generous timeout with polling.
- **Scope:** the two renderer-only flows below (playback, export), **plus** a CI job that
  runs them on Linux (Task 6). Native-capture flows (recording, camera, shortcuts, tray,
  permissions) remain out of scope — they need real macOS APIs/permissions and IPC mocking.
- **CI is Linux, not macOS:** both flows are Chromium + a file + ffprobe, so they run headless
  on `ubuntu-latest` under `xvfb`. No macOS runner is needed (those cost 10× the minutes and
  still could not exercise native capture headless). This matches the existing
  `pr-validation.yml`, which already runs on `ubuntu-latest`.

---

## File Structure

- `apps/kaipu-record/package.json` — add `@playwright/test` devDep + `test:e2e` script (modify).
- `apps/kaipu-record/playwright.config.ts` — Playwright config: testDir, timeouts, artifacts (create).
- `apps/kaipu-record/tsconfig.node.json` — exclude `e2e/**` so the app typecheck ignores it (modify).
- `apps/kaipu-record/e2e/fixtures/sample.mp4` — committed 3s h264+aac test clip (create, binary).
- `apps/kaipu-record/e2e/helpers/launch.ts` — isolated launch + `seedVault` + `openEditor` + teardown (create).
- `apps/kaipu-record/e2e/helpers/ffprobe.ts` — spawn ffprobe, parse streams/durations (create).
- `apps/kaipu-record/e2e/helpers/ffprobe.test.ts` — unit test for the parser (create).
- `apps/kaipu-record/e2e/playback.e2e.ts` — seek→play regression (create).
- `apps/kaipu-record/e2e/export.e2e.ts` — export→valid MP4 regression (create).

---

### Task 1: Playwright setup + launch smoke test

**Files:**

- Modify: `apps/kaipu-record/package.json` (devDependency + script)
- Create: `apps/kaipu-record/playwright.config.ts`
- Modify: `apps/kaipu-record/tsconfig.node.json` (exclude `e2e/**`)
- Create: `apps/kaipu-record/e2e/smoke.e2e.ts`

**Interfaces:**

- Produces: a working `bunx playwright test` run and a `test:e2e` script that builds first.

- [ ] **Step 1: Install Playwright**

Run from `apps/kaipu-record`:

```bash
bun add -D @playwright/test
```

Expected: `@playwright/test` appears under `devDependencies` in `package.json`.

- [ ] **Step 2: Add the `test:e2e` script**

In `apps/kaipu-record/package.json`, add to `scripts` (build first so the tests run the
production `out/`):

```json
"test:e2e": "npm run build && playwright test"
```

- [ ] **Step 3: Create the Playwright config**

Create `apps/kaipu-record/playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

// E2E launches the real Electron build (see e2e/helpers/launch.ts). One worker: the app
// grabs a fixed userData/vault per launch and Electron single-instance behavior makes
// parallel app launches unreliable. Artifacts captured on failure replace the manual CDP
// logging previously done by hand.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
```

- [ ] **Step 4: Exclude e2e from the app typecheck**

Playwright transpiles its own TS. Keep the app's `bun run typecheck` from compiling e2e
files (they use Playwright + node-only APIs). In `apps/kaipu-record/tsconfig.node.json`, add
`"e2e"` to the `exclude` array (create the array if absent):

```jsonc
"exclude": ["e2e", "out", "dist", "node_modules"]
```

(Keep any existing entries; just ensure `e2e` is present.)

- [ ] **Step 5: Write the smoke test**

Create `apps/kaipu-record/e2e/smoke.e2e.ts`. It launches the built app with a throwaway
userData (no vault seeding yet) and asserts a window opens with the app title:

```ts
import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const MAIN_ENTRY = path.resolve(__dirname, "..", "out", "main", "index.js");

test("app launches and opens a window", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "kaipu-e2e-smoke-"));
  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
  });
  try {
    const page = await app.firstWindow();
    await expect(page).toHaveTitle(/Kaipu Record/);
  } finally {
    await app.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 6: Build the app once, then run the smoke test**

Run from `apps/kaipu-record`:

```bash
bun run build && bunx playwright test smoke
```

Expected: 1 passed. (If Playwright reports a missing browser download prompt, ignore it —
the Electron launch uses the app's own `electron` binary, not a downloaded browser.)

- [ ] **Step 7: Format + commit**

```bash
bunx oxfmt apps/kaipu-record/playwright.config.ts apps/kaipu-record/e2e/smoke.e2e.ts
cd ../.. && bunx oxfmt --check .
git add apps/kaipu-record/package.json apps/kaipu-record/playwright.config.ts apps/kaipu-record/tsconfig.node.json apps/kaipu-record/e2e/smoke.e2e.ts bun.lock
git commit -m "test(e2e): scaffold Playwright + Electron launch smoke test"
```

---

### Task 2: Isolated launch + vault-seed helper + fixture

**Files:**

- Create: `apps/kaipu-record/e2e/fixtures/sample.mp4` (binary, generated)
- Create: `apps/kaipu-record/e2e/helpers/launch.ts`
- Modify: `apps/kaipu-record/e2e/smoke.e2e.ts` → replace with a seeded-vault assertion, renamed `library.e2e.ts`

**Interfaces:**

- Produces:
  - `RECORDING_ID = "e2e-sample"` (string), `RECORDING_DURATION = 3` (number).
  - `launchApp(): Promise<{ app: ElectronApplication; page: Page; vaultDir: string; teardown: () => Promise<void> }>`
  - `openEditor(page: Page): Promise<void>` — navigates to the seeded recording's detail page and enters the video editor.

- [ ] **Step 1: Generate the fixture clip**

The fixture must be a real, decodable MP4 **with an audio track** (the export audio path
must be exercised). Generate a tiny 3s 1280×720 h264 + aac clip:

```bash
mkdir -p apps/kaipu-record/e2e/fixtures
ffmpeg -y \
  -f lavfi -i "testsrc=size=1280x720:rate=30:duration=3" \
  -f lavfi -i "sine=frequency=440:duration=3" \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest \
  apps/kaipu-record/e2e/fixtures/sample.mp4
```

Expected: a file well under 500 KB. Verify it: `ffprobe apps/kaipu-record/e2e/fixtures/sample.mp4`
should list one h264 video stream and one aac audio stream, ~3s.

- [ ] **Step 2: Write the launch + seed helper**

Create `apps/kaipu-record/e2e/helpers/launch.ts`:

```ts
import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const APP_ROOT = path.resolve(__dirname, "..", "..");
const MAIN_ENTRY = path.join(APP_ROOT, "out", "main", "index.js");
const FIXTURE = path.join(APP_ROOT, "e2e", "fixtures", "sample.mp4");

/** The seeded recording's id (its filename stem) and known duration (seconds). */
export const RECORDING_ID = "e2e-sample";
export const RECORDING_DURATION = 3;

/**
 * Seed a temp vault with the fixture recording so it lists and opens in the editor:
 * `<id>.mp4` in the root, and a `.kaipu/<id>.json` sidecar carrying a positive
 * durationSeconds (what makes a recording editable — see LibraryDetailPage) plus a title.
 */
async function seedVault(vaultDir: string): Promise<void> {
  await copyFile(FIXTURE, path.join(vaultDir, `${RECORDING_ID}.mp4`));
  await mkdir(path.join(vaultDir, ".kaipu"), { recursive: true });
  await writeFile(
    path.join(vaultDir, ".kaipu", `${RECORDING_ID}.json`),
    JSON.stringify({
      title: "E2E Sample",
      durationSeconds: RECORDING_DURATION,
      createdAt: 1_700_000_000_000,
    }),
  );
}

/**
 * Launch the built app fully isolated: a throwaway userData whose `preferences.json`
 * points at a throwaway vault seeded with the fixture. `--user-data-dir` makes Electron
 * put `app.getPath("userData")` in our temp dir, so vault-location.ts reads OUR
 * preferences and never the developer's real profile or ~/Movies/Kaipu Record.
 */
export async function launchApp(): Promise<{
  app: ElectronApplication;
  page: Page;
  vaultDir: string;
  teardown: () => Promise<void>;
}> {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "kaipu-e2e-user-"));
  const vaultDir = await mkdtemp(path.join(tmpdir(), "kaipu-e2e-vault-"));
  await seedVault(vaultDir);
  await writeFile(
    path.join(userDataDir, "preferences.json"),
    JSON.stringify({ vaultDirectory: vaultDir }),
  );

  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
  });
  const page = await app.firstWindow();

  return {
    app,
    page,
    vaultDir,
    teardown: async () => {
      await app.close();
      await rm(userDataDir, { recursive: true, force: true });
      await rm(vaultDir, { recursive: true, force: true });
    },
  };
}

/**
 * Enter the video editor for the seeded recording. Hash-navigate to its detail page (the
 * app uses createHashRouter), dismiss the onboarding card if it is showing, then click the
 * real "Editar video" button so the flow is genuinely end-to-end.
 */
export async function openEditor(page: Page): Promise<void> {
  await page.evaluate((id) => {
    location.hash = `#/library/${id}`;
  }, RECORDING_ID);
  const skip = page.getByRole("button", { name: "Skip setup" });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await page.getByRole("button", { name: "Editar video" }).click();
  await page.waitForSelector("video");
}
```

- [ ] **Step 3: Replace the smoke test with a seeded-vault library test**

Delete `apps/kaipu-record/e2e/smoke.e2e.ts` and create `apps/kaipu-record/e2e/library.e2e.ts`:

```ts
import { test, expect } from "@playwright/test";
import { launchApp, RECORDING_ID } from "./helpers/launch";

test("seeded recording lists and opens in the editor", async () => {
  const { page, teardown } = await launchApp();
  try {
    await page.evaluate((id) => {
      location.hash = `#/library/${id}`;
    }, RECORDING_ID);
    // The detail page shows the recording's actions, including "Editar video".
    await expect(page.getByRole("button", { name: "Editar video" })).toBeVisible();
  } finally {
    await teardown();
  }
});
```

- [ ] **Step 4: Run the library test**

Run from `apps/kaipu-record` (the app is already built from Task 1; rebuild only if app
source changed):

```bash
bunx playwright test library
```

Expected: 1 passed.

- [ ] **Step 5: Format + commit**

```bash
bunx oxfmt apps/kaipu-record/e2e/helpers/launch.ts apps/kaipu-record/e2e/library.e2e.ts
cd ../.. && bunx oxfmt --check .
git add apps/kaipu-record/e2e/fixtures/sample.mp4 apps/kaipu-record/e2e/helpers/launch.ts apps/kaipu-record/e2e/library.e2e.ts
git rm apps/kaipu-record/e2e/smoke.e2e.ts
git commit -m "test(e2e): isolated launch + vault fixture seeding"
```

---

### Task 3: ffprobe helper + parser test

**Files:**

- Create: `apps/kaipu-record/e2e/helpers/ffprobe.ts`
- Create: `apps/kaipu-record/e2e/helpers/ffprobe.test.ts`

**Interfaces:**

- Produces:
  - `ffprobeAvailable(): Promise<boolean>`
  - `probeMedia(filePath: string): Promise<{ video?: { codec: string; durationSec: number }; audio?: { codec: string; durationSec: number } }>`

- [ ] **Step 1: Write the failing parser test**

The parser turns ffprobe's `-show_streams -of json` output into a small typed summary.
Create `apps/kaipu-record/e2e/helpers/ffprobe.test.ts` (run by vitest, which already runs in
this app):

```ts
import { describe, it, expect } from "vitest";
import { parseFfprobeStreams } from "./ffprobe";

describe("parseFfprobeStreams", () => {
  it("extracts the first video and audio stream with codec + duration", () => {
    const json = JSON.stringify({
      streams: [
        { codec_type: "video", codec_name: "h264", duration: "3.000000" },
        { codec_type: "audio", codec_name: "aac", duration: "3.026667" },
      ],
    });
    expect(parseFfprobeStreams(json)).toEqual({
      video: { codec: "h264", durationSec: 3 },
      audio: { codec: "aac", durationSec: 3.026667 },
    });
  });

  it("omits a track that is absent", () => {
    const json = JSON.stringify({
      streams: [{ codec_type: "video", codec_name: "h264", duration: "3.0" }],
    });
    expect(parseFfprobeStreams(json)).toEqual({ video: { codec: "h264", durationSec: 3 } });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `apps/kaipu-record`:

```bash
bunx vitest run e2e/helpers/ffprobe.test.ts
```

Expected: FAIL — `parseFfprobeStreams` is not exported yet.

- [ ] **Step 3: Implement the ffprobe helper**

Create `apps/kaipu-record/e2e/helpers/ffprobe.ts`:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface StreamSummary {
  video?: { codec: string; durationSec: number };
  audio?: { codec: string; durationSec: number };
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  duration?: string;
}

/** Pure parser (unit-tested): first video + first audio stream, codec + duration. */
export function parseFfprobeStreams(json: string): StreamSummary {
  const streams = (JSON.parse(json) as { streams?: FfprobeStream[] }).streams ?? [];
  const summary: StreamSummary = {};
  for (const s of streams) {
    if (s.codec_type === "video" && !summary.video) {
      summary.video = { codec: s.codec_name ?? "", durationSec: Number(s.duration) };
    } else if (s.codec_type === "audio" && !summary.audio) {
      summary.audio = { codec: s.codec_name ?? "", durationSec: Number(s.duration) };
    }
  }
  return summary;
}

/** True if `ffprobe` is on PATH — lets tests skip the codec assertion when it is not. */
export async function ffprobeAvailable(): Promise<boolean> {
  try {
    await run("ffprobe", ["-version"]);
    return true;
  } catch {
    return false;
  }
}

/** Run ffprobe against a file and return the parsed stream summary. */
export async function probeMedia(filePath: string): Promise<StreamSummary> {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_streams",
    "-of",
    "json",
    filePath,
  ]);
  return parseFfprobeStreams(stdout);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
bunx vitest run e2e/helpers/ffprobe.test.ts
```

Expected: 2 passed.

- [ ] **Step 5: Format + commit**

```bash
bunx oxfmt apps/kaipu-record/e2e/helpers/ffprobe.ts apps/kaipu-record/e2e/helpers/ffprobe.test.ts
cd ../.. && bunx oxfmt --check .
git add apps/kaipu-record/e2e/helpers/ffprobe.ts apps/kaipu-record/e2e/helpers/ffprobe.test.ts
git commit -m "test(e2e): ffprobe stream-summary helper"
```

---

### Task 4: Playback seek → play regression test

**Files:**

- Create: `apps/kaipu-record/e2e/playback.e2e.ts`

**Interfaces:**

- Consumes: `launchApp`, `openEditor` from `./helpers/launch`.

- [ ] **Step 1: Write the regression test**

This guards the `f41706f` regression with **two** tests. The primary, deterministic guard
asserts the media protocol directly: a `Range` fetch must return `206` + `Content-Range`
(the bug returns `200`/full, which wedges Chromium's media stack on seek). A small committed
fixture buffers whole on first load, so a real `<video>` seek stays in-buffer and never
issues the offset request that reproduces the wedge — which is why the protocol assertion,
not the seek, is the true guard. The second test is the realistic user-flow smoke (seek on
the ruler → Play → `currentTime` advances). Create `apps/kaipu-record/e2e/playback.e2e.ts`:

```ts
import { test, expect, type Page } from "@playwright/test";
import { launchApp, openEditor, RECORDING_ID } from "./helpers/launch";

/** Read the live <video> element's playback state from the renderer. */
async function videoState(page: Page) {
  return page.evaluate(() => {
    const v = document.querySelector("video");
    if (!v) return null;
    return {
      currentTime: v.currentTime,
      paused: v.paused,
      seeking: v.seeking,
      error: v.error?.code ?? null,
    };
  });
}

// Primary guard: the protocol must answer a Range request with 206 + Content-Range. The bug
// returned 200/full, which Chromium treats as a fatal error for the bytes=<offset>- request
// it issues while seeking, wedging the <video>. Deterministic — no reliance on buffering.
test("media protocol serves Range requests as 206 (seeking stays alive)", async () => {
  const { page, teardown } = await launchApp();
  try {
    const res = await page.evaluate(async (id) => {
      const r = await fetch(`kaipu-media://recording/${id}`, {
        headers: { Range: "bytes=1000-" },
      });
      const body = await r.arrayBuffer();
      return {
        status: r.status,
        contentRange: r.headers.get("content-range"),
        acceptRanges: r.headers.get("accept-ranges"),
        byteLength: body.byteLength,
      };
    }, RECORDING_ID);

    expect(res.status).toBe(206);
    expect(res.contentRange).toMatch(/^bytes 1000-\d+\/\d+$/);
    expect(res.acceptRanges).toBe("bytes");
    expect(res.byteLength).toBeGreaterThan(0);
  } finally {
    await teardown();
  }
});

// Realistic smoke: after seeking on the ruler, pressing Play advances the <video>.
test("seeking on the ruler then pressing play resumes playback", async () => {
  const { page, teardown } = await launchApp();
  try {
    await openEditor(page);

    const ruler = page.getByTestId("ruler");
    const box = await ruler.boundingBox();
    if (!box) throw new Error("ruler not found");
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);

    await expect
      .poll(async () => (await videoState(page))?.seeking, { timeout: 10_000 })
      .toBe(false);
    expect((await videoState(page))?.error).toBeNull();

    await page.getByRole("button", { name: "Reproducir" }).click();
    const t0 = (await videoState(page))!.currentTime;
    await expect
      .poll(async () => (await videoState(page))?.currentTime, { timeout: 10_000 })
      .toBeGreaterThan(t0 + 0.3);
    expect((await videoState(page))?.paused).toBe(false);
  } finally {
    await teardown();
  }
});
```

- [ ] **Step 2: Run the test (against the FIXED build)**

Rebuild if needed, then run from `apps/kaipu-record`:

```bash
bun run build && bunx playwright test playback
```

Expected: 1 passed. (Requires the branch to include `f41706f` — see Global Constraints.)

- [ ] **Step 3: Red-green proof (manual, do not commit the revert)**

Confirm the test actually guards the bug: in `src/main/media-protocol.ts`, force `streamFile`
to always take the `200`/full-body branch (e.g. change `if (!range)` to `if (true || !range)`),
rebuild, and run `bunx playwright test playback`. Expected: the **Range-guard** test FAILS
(`Expected 206, Received 200`). Note the `<video>` seek smoke still PASSES — a small committed
fixture buffers whole, so a real seek stays in-buffer and never issues the offset request that
wedges; that is exactly why the deterministic protocol assertion is the true guard. Then
`git checkout -- src/main/media-protocol.ts` and rebuild to restore green.

- [ ] **Step 4: Format + commit**

```bash
bunx oxfmt apps/kaipu-record/e2e/playback.e2e.ts
cd ../.. && bunx oxfmt --check .
git add apps/kaipu-record/e2e/playback.e2e.ts
git commit -m "test(e2e): seek-then-play playback regression"
```

---

### Task 5: Export → valid MP4 regression test

**Files:**

- Create: `apps/kaipu-record/e2e/export.e2e.ts`

**Interfaces:**

- Consumes: `launchApp`, `openEditor`, `RECORDING_DURATION` from `./helpers/launch`;
  `ffprobeAvailable`, `probeMedia` from `./helpers/ffprobe`.

- [ ] **Step 1: Write the export regression test**

This covers the `5a2af0e` failures (cross-origin `fetch()` block, worker `AudioBuffer`).
Export runs, the app navigates to the new library recording, and the output file has both a
video and an audio stream with aligned durations. Create `apps/kaipu-record/e2e/export.e2e.ts`:

```ts
import { test, expect } from "@playwright/test";
import path from "node:path";
import { launchApp, openEditor, RECORDING_DURATION } from "./helpers/launch";
import { ffprobeAvailable, probeMedia } from "./helpers/ffprobe";

test("export produces a valid MP4 with in-sync video and audio", async () => {
  const { page, vaultDir, teardown } = await launchApp();
  try {
    await openEditor(page);

    // handleExport no-ops with a toast if videoWidth is still 0 (metadata not decoded).
    // Wait for real dimensions before clicking, or the export silently never starts.
    await expect
      .poll(() => page.evaluate(() => document.querySelector("video")?.videoWidth ?? 0), {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);

    // Start the export from the toolbar.
    await page.getByRole("button", { name: "Exportar" }).click();

    // Success = the app navigates to the newly saved recording's detail route. The router
    // is a hash router, so poll location.hash (a bare hash change does not reliably fire
    // Playwright's navigation events). Give the encode a generous window.
    await expect
      .poll(() => page.evaluate(() => location.hash), { timeout: 90_000 })
      .toMatch(/^#\/library\/.+/);
    const newId = (await page.evaluate(() => location.hash)).replace("#/library/", "");
    expect(newId).not.toBe("");

    // Validate the on-disk output. If ffprobe is unavailable, skip the codec assertion
    // (do NOT pass silently) — the navigation above already proves the pipeline ran.
    if (!(await ffprobeAvailable())) {
      test.info().annotations.push({ type: "skip", description: "ffprobe not on PATH" });
      return;
    }
    const outFile = path.join(vaultDir, `${newId}.mp4`);
    const streams = await probeMedia(outFile);
    expect(streams.video?.codec).toBe("h264");
    expect(streams.audio?.codec).toBe("aac");
    // Video and audio must be aligned (no A/V drift) and near the source length.
    expect(streams.audio!.durationSec).toBeGreaterThan(RECORDING_DURATION - 1);
    expect(Math.abs(streams.audio!.durationSec - streams.video!.durationSec)).toBeLessThan(0.5);
  } finally {
    await teardown();
  }
});
```

- [ ] **Step 2: Run the test (against the FIXED build)**

```bash
bun run build && bunx playwright test export
```

Expected: 1 passed. (Requires the branch to include `5a2af0e` — see Global Constraints.)

- [ ] **Step 3: Red-green proof (manual, do not commit the revert)**

In `src/main/media-protocol.ts` remove `corsEnabled: true` from the scheme privileges,
rebuild, and run `bunx playwright test export`. Expected: FAIL (export "Failed to fetch").
Restore with `git checkout -- src/main/media-protocol.ts` and rebuild.

- [ ] **Step 4: Run the whole suite once**

```bash
bun run build && bunx playwright test
```

Expected: `library`, `playback`, `export` all pass; `ffprobe.test.ts` runs under vitest
separately (`bun run test`), not Playwright.

- [ ] **Step 5: Format + commit**

```bash
bunx oxfmt apps/kaipu-record/e2e/export.e2e.ts
cd ../.. && bunx oxfmt --check .
git add apps/kaipu-record/e2e/export.e2e.ts
git commit -m "test(e2e): export produces a valid in-sync MP4"
```

---

### Task 6: CI job — run E2E on Linux (xvfb + ffmpeg)

**Files:**

- Create: `.github/workflows/e2e-desktop.yml`

**Interfaces:**

- Consumes: the `test:e2e` script (Task 1) and the committed fixture (Task 2).
- Produces: a PR check that builds `kaipu-record` and runs the Playwright suite headless on
  `ubuntu-latest`, uploading Playwright artifacts on failure.

**Why a separate workflow (not a step in `pr-validation.yml`):** the E2E job needs a display
(`xvfb`), system libraries, and an app build — it is heavier and slower than the lint/type
job. Keeping it a distinct workflow lets it run in parallel and fail independently without
blocking the fast checks, and keeps `pr-validation.yml` cheap.

- [ ] **Step 1: Create the workflow**

Create `.github/workflows/e2e-desktop.yml`. `xvfb-run` provides the virtual display Electron
needs; `ffmpeg` provides `ffprobe` for the export codec assertion; `playwright install-deps`
installs the Chromium shared libraries Electron also links against. `test:e2e` builds the app
first (see Task 1), so no separate build step is required.

```yaml
name: E2E Desktop

on:
  pull_request:
    branches:
      - main

concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  e2e:
    name: E2E (kaipu-record)
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.4

      - name: Install dependencies
        run: bun install --frozen-lockfile

      # ffprobe (from ffmpeg) validates the exported MP4's streams; the export test
      # requires it in CI (locally it is optional and the assertion self-skips).
      - name: Install ffmpeg
        run: sudo apt-get update && sudo apt-get install -y ffmpeg

      # Electron's renderer is Chromium; it needs the same system libraries Playwright's
      # Chromium does. install-deps pulls them (libnss3, libgbm, etc.). No browser download
      # is needed — the tests launch the app's own electron binary.
      - name: Install Electron/Chromium system libraries
        working-directory: apps/kaipu-record
        run: bunx playwright install-deps chromium

      # xvfb-run gives Electron a virtual X display so the window can open headless.
      - name: Run E2E suite
        working-directory: apps/kaipu-record
        run: xvfb-run --auto-servernum bun run test:e2e

      - name: Upload Playwright artifacts on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: |
            apps/kaipu-record/playwright-report
            apps/kaipu-record/test-results
          retention-days: 7
          if-no-files-found: ignore
```

- [ ] **Step 2: Validate the workflow locally**

There is no full local GitHub Actions runner requirement, but sanity-check the YAML parses
and the referenced script exists:

```bash
bunx --yes js-yaml .github/workflows/e2e-desktop.yml > /dev/null && echo "yaml ok"
grep -q '"test:e2e"' apps/kaipu-record/package.json && echo "script present"
```

Expected: `yaml ok` and `script present`.

- [ ] **Step 3: Format + commit**

```bash
cd ../.. 2>/dev/null; bunx oxfmt --check .
git add .github/workflows/e2e-desktop.yml
git commit -m "ci(e2e): run desktop Playwright suite on Linux with xvfb"
```

- [ ] **Step 4: Verify on the PR**

After pushing, confirm the `E2E Desktop` check appears on the PR and goes green. If Electron
fails to launch for a missing library, read the job log for the exact `error while loading
shared libraries` line and add that package to the `apt-get install` list (defense in depth:
`libnss3 libatk-bridge2.0-0 libgtk-3-0 libgbm1 libasound2` are the usual suspects).

---

## Notes for the implementer

- **Playwright browser download:** `_electron.launch` uses the app's own `electron` binary,
  so a Playwright "browsers not installed" message is harmless here. Do not add
  `playwright install` to CI for these tests.
- **Onboarding overlay:** first launch may show the onboarding card over the library.
  `openEditor` dismisses it via "Skip setup" when present; if a test flakes on it, add the
  same guard before other navigations.
- **macOS non-fatal errors:** the main process logs `recording:get-screen-sources` failures
  on launch — expected and harmless in a headless/no-permission test environment.
- **CI (Task 6):** wired into a dedicated `e2e-desktop` job on `ubuntu-latest`. It needs a
  virtual display (`xvfb`), `ffmpeg`/`ffprobe`, and Electron's headless system libraries
  (`playwright install-deps` covers the Chromium shared libs Electron also uses). The
  renderer-only flows run headless because they are just Chromium + a file.
