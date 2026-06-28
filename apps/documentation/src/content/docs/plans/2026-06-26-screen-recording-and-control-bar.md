---
title: "Screen Recording Pipeline + Floating Control Bar — Implementation Plan"
description: "End-to-end implementation plan for the recording engine (capture, encode, write, finalize to vault) and the floating control bar that drives it."
---

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the recorder actually record — capture screen + mic to a real MP4 (mediabunny, H.264/AAC), stream it to disk, finalize into the Library vault, all driven by a floating always-on-top control bar (timer, live mic level, pause/resume, stop).

**Architecture:** Option A. The (hidden) main-window renderer owns capture + mediabunny encoding + timer + mic metering and streams MP4 chunks to the main process, which writes them to disk at exact byte positions and finalizes into the vault. A separate frameless/transparent/always-on-top `BrowserWindow` renders the control bar; the main process (`recording-hub`) relays ticks to it and commands back. A `videoProvider`/`audioProvider` seam keeps camera-PiP and watermark as additive future passes.

**Tech Stack:** Electron, React 19 + TypeScript, CSS Modules + design tokens, `mediabunny` (WebCodecs muxing), Vitest (jsdom for renderer, node for main).

**Spec:** `docs/superpowers/specs/2026-06-26-screen-recording-and-control-bar-design.md`

---

## Conventions for every task

- **Commands run from** `apps/kaipu-record/` unless stated. Single test: `bunx vitest run <relative-path>`. Typecheck: `bun run typecheck`. Lint: `bun run lint`.
- **Commit hygiene (oxfmt churn hold):** if the pre-commit hook reformats unrelated UI files (quote/format churn), re-run the same commit with `--no-verify`. Run `bunx oxfmt <files>` on the files you touched before committing so they're clean.
- **Codebase style:** double quotes + semicolons; `cx()` + `data-*` for className/variants; CSS Modules co-located; design tokens via `var(--token)`; kebab-case filenames, PascalCase component identifiers.
- **mediabunny API caveat (spec §18):** the exact codec strings (`"avc"` vs `"avc1.42E01F"`), bitrate units, and `Mp4OutputFormat` option names must be verified against the **installed** package's `.d.ts` the moment you write Task 10/11. If a name differs, adjust — do not assume docs prose is authoritative.

---

## File structure (what gets created / changed)

**New — main**

- `src/main/recording/recording-writer.ts` + `.test.ts` — positional disk writer + finalize-to-vault.
- `src/main/recording/control-bar-window.ts` — the floating BrowserWindow factory.
- `src/main/recording/recording-hub.ts` — relay + window show/hide orchestration.

**New — renderer**

- `src/renderer/src/features/recording/elapsed.ts` + `.test.ts` — pure timer-with-pause + format.
- `src/renderer/src/features/recording/audio-levels.ts` + `.test.ts` — pure RMS → 5 bars.
- `src/renderer/src/features/recording/hooks/use-mic-level.ts` — AnalyserNode → bars (wraps the pure helper).
- `src/renderer/src/features/recording/hooks/use-screen-recorder.ts` — capture + encode orchestration.
- `src/renderer/src/features/recording/recorder-engine.ts` — provider seam + mediabunny wiring (injectable).
- `src/renderer/src/features/control-bar/control-bar.tsx` + `.module.css` + `.test.tsx` — the bar UI.
- `src/renderer/src/features/control-bar/control-bar-window.tsx` — the window-mode root (listens to ticks).

**Modified**

- `src/shared/types/ipc.ts` — new channel names.
- `src/shared/types/electron-api.ts` — new bridge methods + tick/command types.
- `src/preload/index.ts` — new bridge wiring.
- `src/main/library/library-vault.ts` — extension-aware; `filePath` async; public `describe`; `writeMeta`/`writeThumbnail`; thumbnail in `describe`.
- `src/main/library/index.ts` — `recordingFilePath` async; thumb-aware reveal.
- `src/main/media-protocol.ts` — resolve real extension + content type; `kaipu-media://thumb/<id>` route.
- `src/main/index.ts` — register writer + hub.
- `src/renderer/src/features/recording/hooks/use-recording-setup.ts` — `startRecording` delegates to the engine.
- `src/renderer/src/pages/record/record-page.tsx`, `src/renderer/src/features/capture-panel/capture-panel.tsx` — Start wired to the engine.
- `src/renderer/src/main.tsx` (renderer entry) — window-mode switch (AppShell vs ControlBar).
- `apps/documentation/...` — recording-pipeline doc + changelog.
- `package.json` — add `mediabunny`.

---

## Task 0: Install mediabunny

**Files:** `apps/kaipu-record/package.json`, lockfile.

- [ ] **Step 1: Add the dependency**

Run (from `apps/kaipu-record/`): `bun add mediabunny`

- [ ] **Step 2: Verify it imports under the renderer's bundler**

Run: `bunx vitest run --help >/dev/null && node -e "console.log(require('mediabunny') ? 'cjs-ok' : 'no')"`
Expected: prints `cjs-ok` OR errors about ESM-only — either is fine; we only need it resolvable for the renderer (Vite/ESM). Confirm `node_modules/mediabunny/dist/` exists.

- [ ] **Step 3: Inspect the real API surface (no code yet — read it)**

Run: `sed -n '1,80p' node_modules/mediabunny/dist/modules/index.d.ts 2>/dev/null || ls node_modules/mediabunny/dist`
Note the exact exported names for `Output`, `Mp4OutputFormat`, `StreamTarget`, `MediaStreamVideoTrackSource`, `MediaStreamAudioTrackSource` and their option types. Keep this open for Tasks 10–11.

- [ ] **Step 4: Commit**

```bash
git add apps/kaipu-record/package.json bun.lock
git commit -m "build(kaipu-record): add mediabunny for MP4 encoding"
```

---

## Task 1: Pure elapsed-with-pause timer

**Files:**

- Create: `src/renderer/src/features/recording/elapsed.ts`
- Test: `src/renderer/src/features/recording/elapsed.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  elapsedMs,
  formatElapsed,
  pauseElapsed,
  resumeElapsed,
  startElapsed,
} from "./elapsed";

describe("elapsed", () => {
  it("counts wall-clock time from the start", () => {
    const s = startElapsed(1000);
    expect(elapsedMs(s, 1000)).toBe(0);
    expect(elapsedMs(s, 4500)).toBe(3500);
  });

  it("freezes while paused and resumes without counting the pause", () => {
    let s = startElapsed(0);
    s = pauseElapsed(s, 2000); // paused at 2s
    expect(elapsedMs(s, 5000)).toBe(2000); // still 2s during the pause
    s = resumeElapsed(s, 5000); // 3s pause discounted
    expect(elapsedMs(s, 6000)).toBe(3000); // 6s wall - 3s paused
  });

  it("accumulates multiple pauses", () => {
    let s = startElapsed(0);
    s = resumeElapsed(pauseElapsed(s, 1000), 2000); // -1s
    s = resumeElapsed(pauseElapsed(s, 3000), 5000); // -2s
    expect(elapsedMs(s, 10000)).toBe(7000); // 10 - 3 paused
  });

  it("is a no-op to pause twice or resume when not paused", () => {
    let s = startElapsed(0);
    s = pauseElapsed(pauseElapsed(s, 1000), 2000);
    s = resumeElapsed(s, 4000); // discount only the first pause start (1000)
    expect(elapsedMs(s, 5000)).toBe(2000); // 5 - 3 paused
    expect(resumeElapsed(s, 9000)).toBe(s); // resume when running = same ref
  });

  it("formats as hh:mm:ss", () => {
    expect(formatElapsed(0)).toBe("00:00:00");
    expect(formatElapsed(257_000)).toBe("00:04:17");
    expect(formatElapsed(3_661_000)).toBe("01:01:01");
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `bunx vitest run src/renderer/src/features/recording/elapsed.test.ts`
Expected: FAIL — `Failed to resolve import "./elapsed"`.

- [ ] **Step 3: Implement**

```ts
/**
 * Pure recording clock. Tracks elapsed time excluding any paused spans, so the
 * control-bar timer matches the actual captured duration. No timers, no Date —
 * the caller passes `now` (ms), which makes it trivially testable.
 */
export interface ElapsedState {
  startedAt: number;
  totalPausedMs: number;
  pausedAt: number | null;
}

export function startElapsed(now: number): ElapsedState {
  return { startedAt: now, totalPausedMs: 0, pausedAt: null };
}

export function pauseElapsed(state: ElapsedState, now: number): ElapsedState {
  if (state.pausedAt !== null) return state;
  return { ...state, pausedAt: now };
}

export function resumeElapsed(state: ElapsedState, now: number): ElapsedState {
  if (state.pausedAt === null) return state;
  return {
    ...state,
    totalPausedMs: state.totalPausedMs + (now - state.pausedAt),
    pausedAt: null,
  };
}

export function elapsedMs(state: ElapsedState, now: number): number {
  const openPause = state.pausedAt === null ? 0 : now - state.pausedAt;
  return Math.max(0, now - state.startedAt - state.totalPausedMs - openPause);
}

export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `bunx vitest run src/renderer/src/features/recording/elapsed.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
bunx oxfmt src/renderer/src/features/recording/elapsed.ts src/renderer/src/features/recording/elapsed.test.ts
git add src/renderer/src/features/recording/elapsed.ts src/renderer/src/features/recording/elapsed.test.ts
git commit -m "feat(kaipu-record): pure elapsed-with-pause recording clock"
```

---

## Task 2: Pure mic-level RMS → 5 bars

**Files:**

- Create: `src/renderer/src/features/recording/audio-levels.ts`
- Test: `src/renderer/src/features/recording/audio-levels.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { levelsFromTimeDomain } from "./audio-levels";

const fill = (len: number, value: number): Uint8Array => new Uint8Array(len).fill(value);

describe("levelsFromTimeDomain", () => {
  it("returns one value per bar", () => {
    expect(levelsFromTimeDomain(fill(100, 128), 5)).toHaveLength(5);
  });

  it("is ~0 for silence (centered at 128)", () => {
    for (const v of levelsFromTimeDomain(fill(100, 128), 5)) {
      expect(v).toBeCloseTo(0, 5);
    }
  });

  it("clamps loud signal to 1", () => {
    for (const v of levelsFromTimeDomain(fill(100, 255), 5)) {
      expect(v).toBe(1);
    }
  });

  it("scales between 0 and 1", () => {
    for (const v of levelsFromTimeDomain(fill(100, 140), 5, 25)) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `bunx vitest run src/renderer/src/features/recording/audio-levels.test.ts`
Expected: FAIL — cannot resolve `./audio-levels`.

- [ ] **Step 3: Implement**

```ts
/**
 * Maps an AnalyserNode time-domain byte buffer to N bar heights (0..1) for the
 * control-bar mic meter. Pure: the AudioContext/AnalyserNode plumbing lives in
 * the hook; this is just the math, so it's unit-testable.
 *
 * Each bar is the RMS of one slice of the buffer, boosted for visual response
 * (quiet speech should still wiggle the bars) and clamped to 1.
 */
export function levelsFromTimeDomain(data: Uint8Array, bars = 5, boost = 25): number[] {
  const size = Math.max(1, Math.floor(data.length / bars));
  const out: number[] = [];
  for (let b = 0; b < bars; b++) {
    let sum = 0;
    for (let i = 0; i < size; i++) {
      const norm = (data[b * size + i] - 128) / 128;
      sum += norm * norm;
    }
    out.push(Math.min(1, Math.sqrt(sum / size) * boost));
  }
  return out;
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `bunx vitest run src/renderer/src/features/recording/audio-levels.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
bunx oxfmt src/renderer/src/features/recording/audio-levels.ts src/renderer/src/features/recording/audio-levels.test.ts
git add src/renderer/src/features/recording/audio-levels.ts src/renderer/src/features/recording/audio-levels.test.ts
git commit -m "feat(kaipu-record): pure RMS-to-bars mic level helper"
```

---

## Task 3: Make the vault extension-aware (MP4) + thumbnails

**Files:**

- Modify: `src/main/library/library-vault.ts`
- Modify: `src/main/library/index.ts`
- Test: `src/main/library/library-vault.test.ts` (extend existing)

- [ ] **Step 1: Add failing tests for mp4 discovery + write helpers**

Append to `src/main/library/library-vault.test.ts` (keep existing tests):

```ts
import { mkdtemp, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("LibraryVault — mp4 + thumbnails", () => {
  async function tempVault(): Promise<LibraryVault> {
    const dir = await mkdtemp(join(tmpdir(), "vault-mp4-"));
    return new LibraryVault(dir);
  }

  it("discovers .mp4 recordings", async () => {
    const vault = await tempVault();
    const file = await vault.filePath("rec-1");
    expect(file.endsWith("rec-1.mp4")).toBe(true); // default ext for a not-yet-existing id
    await writeFile(file, "data");
    const list = await vault.list();
    expect(list.map((r) => r.id)).toContain("rec-1");
  });

  it("writeMeta + describe surface title, duration and thumbnail url", async () => {
    const vault = await tempVault();
    await writeFile(await vault.filePath("rec-2"), "data");
    await vault.writeMeta("rec-2", { title: "Demo", durationSeconds: 12, createdAt: 111 });
    await vault.writeThumbnail("rec-2", Buffer.from([0xff, 0xd8, 0xff]));
    const rec = await vault.describe("rec-2");
    expect(rec).toMatchObject({
      id: "rec-2",
      title: "Demo",
      durationSeconds: 12,
      createdAt: 111,
      thumbnailUrl: "kaipu-media://thumb/rec-2",
    });
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `bunx vitest run src/main/library/library-vault.test.ts`
Expected: FAIL — `filePath` is sync/returns `.webm`; `writeMeta`/`writeThumbnail`/public `describe` don't exist.

- [ ] **Step 3: Rewrite `library-vault.ts`**

```ts
import { basename, join } from "node:path";
import { access, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import type { LocalRecording } from "@shared/types/library-storage";

const META_DIR = ".kaipu";
/** Known video containers, in preference order — `.mp4` is what we now write. */
const VIDEO_EXTS = [".mp4", ".webm"] as const;

interface Sidecar {
  title?: string;
  durationSeconds?: number;
  createdAt?: number;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Local recordings vault. A recording lives as `<id><ext>` (ext ∈ VIDEO_EXTS)
 * with optional sidecar metadata (`.kaipu/<id>.json`) and thumbnail
 * (`.kaipu/<id>.jpg`). The filename *is* the id. Pure: no Electron — the
 * directory is injected so it's testable against a temp folder.
 */
export class LibraryVault {
  constructor(private readonly directory: string) {}

  /** Resolve an id to its real file; if none exists yet, default to `.mp4`. */
  async filePath(id: string): Promise<string> {
    for (const ext of VIDEO_EXTS) {
      const candidate = join(this.directory, `${id}${ext}`);
      if (await exists(candidate)) return candidate;
    }
    return join(this.directory, `${id}${VIDEO_EXTS[0]}`);
  }

  private metaDirectory(): string {
    return join(this.directory, META_DIR);
  }

  private sidecarPath(id: string): string {
    return join(this.metaDirectory(), `${id}.json`);
  }

  private thumbnailPath(id: string): string {
    return join(this.metaDirectory(), `${id}.jpg`);
  }

  async list(): Promise<LocalRecording[]> {
    await mkdir(this.directory, { recursive: true });
    let entries: string[];
    try {
      entries = await readdir(this.directory);
    } catch {
      return [];
    }
    const ids = entries
      .filter((f) => VIDEO_EXTS.some((ext) => f.endsWith(ext)))
      .map((f) => basename(f, VIDEO_EXTS.find((ext) => f.endsWith(ext))!));
    const described = await Promise.all(ids.map((id) => this.describe(id)));
    return described
      .filter((r): r is LocalRecording => r !== null)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async describe(id: string): Promise<LocalRecording | null> {
    const filePath = await this.filePath(id);
    let info;
    try {
      info = await stat(filePath);
    } catch {
      return null;
    }
    const meta = await this.readSidecar(id);
    return {
      id,
      title: meta.title ?? humanizeId(id),
      filePath,
      createdAt: meta.createdAt ?? info.birthtimeMs,
      sizeBytes: info.size,
      durationSeconds: meta.durationSeconds ?? 0,
      thumbnailUrl: (await exists(this.thumbnailPath(id))) ? `kaipu-media://thumb/${id}` : null,
    };
  }

  private async readSidecar(id: string): Promise<Sidecar> {
    try {
      return JSON.parse(await readFile(this.sidecarPath(id), "utf-8")) as Sidecar;
    } catch {
      return {};
    }
  }

  /** Merge fields into the sidecar (used by rename and by finalize). */
  async writeMeta(id: string, meta: Sidecar): Promise<void> {
    const current = await this.readSidecar(id);
    await mkdir(this.metaDirectory(), { recursive: true });
    await writeFile(this.sidecarPath(id), JSON.stringify({ ...current, ...meta }, null, 2));
  }

  async writeThumbnail(id: string, jpg: Buffer): Promise<void> {
    await mkdir(this.metaDirectory(), { recursive: true });
    await writeFile(this.thumbnailPath(id), jpg);
  }

  /** Updates the user-facing title without touching the video file. */
  async rename(id: string, title: string): Promise<void> {
    await this.writeMeta(id, { title });
  }

  /** Removes the video plus its sidecar and thumbnail (best-effort). */
  async remove(id: string): Promise<void> {
    await Promise.allSettled([
      rm(await this.filePath(id), { force: true }),
      rm(this.sidecarPath(id), { force: true }),
      rm(this.thumbnailPath(id), { force: true }),
    ]);
  }
}

function humanizeId(id: string): string {
  const cleaned = id.replace(/[-_]+/g, " ").trim();
  return cleaned ? cleaned.replace(/\b\w/g, (c) => c.toUpperCase()) : "Recording";
}
```

- [ ] **Step 4: Update `library/index.ts` for the now-async `filePath`**

Replace the body so `recordingFilePath` is async and reveal awaits it:

```ts
/** Absolute path to a recording's real video file in the current vault. */
export async function recordingFilePath(id: string): Promise<string> {
  return currentVault().filePath(id);
}

/** Absolute path to a recording's thumbnail jpg (may not exist). */
export function thumbnailFilePath(id: string): string {
  return join(vaultDirectory().path, ".kaipu", `${id}.jpg`);
}
```

And update the reveal handler (it currently passes `currentVault().filePath(id)` directly):

```ts
ipcMain.handle(IPC_CHANNELS.revealLocalRecording, async (_event, id: string) =>
  shell.showItemInFolder(await currentVault().filePath(id)),
);
```

Add the imports at the top of `index.ts`: `import { join } from "node:path";`.

- [ ] **Step 5: Run vault tests + typecheck**

Run: `bunx vitest run src/main/library/library-vault.test.ts && bun run typecheck:node`
Expected: vault tests PASS; typecheck will FAIL in `media-protocol.ts` (it calls the now-async `recordingFilePath`) — that's fixed in Task 4. If only `media-protocol.ts` errors, proceed.

- [ ] **Step 6: Commit**

```bash
bunx oxfmt src/main/library/library-vault.ts src/main/library/library-vault.test.ts src/main/library/index.ts
git add src/main/library/library-vault.ts src/main/library/library-vault.test.ts src/main/library/index.ts
git commit -m "feat(kaipu-record): make the vault extension-aware (mp4) with thumbnails"
```

---

## Task 4: Media protocol — real extension + thumbnail route

**Files:**

- Modify: `src/main/media-protocol.ts`

- [ ] **Step 1: Rewrite the handler to resolve the real file and serve thumbnails**

```ts
import { net, protocol } from "electron";
import { pathToFileURL } from "node:url";
import { recordingFilePath, thumbnailFilePath } from "./library";

/**
 * Privileged, streamable protocol for local vault media.
 *   kaipu-media://recording/<id>  → the video file (Range-aware, for seeking)
 *   kaipu-media://thumb/<id>      → the poster jpg
 * `registerMediaScheme()` must run BEFORE `app.whenReady`; `registerMediaProtocol()` after.
 */
export const MEDIA_SCHEME = "kaipu-media";

function isUnsafeId(id: string): boolean {
  return id.length === 0 || id.includes("/") || id.includes("\\") || id.includes("..");
}

export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, stream: true, supportFetchAPI: true, bypassCSP: true },
    },
  ]);
}

export function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const url = new URL(request.url);
    const id = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    if (isUnsafeId(id)) return new Response("Invalid recording id", { status: 400 });

    const target =
      url.hostname === "thumb" ? thumbnailFilePath(id) : await recordingFilePath(id);
    return net.fetch(pathToFileURL(target).toString());
  });
}
```

- [ ] **Step 2: Verify typecheck is now clean**

Run: `bun run typecheck:node`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
bunx oxfmt src/main/media-protocol.ts
git add src/main/media-protocol.ts
git commit -m "feat(kaipu-record): serve real extension + thumbnails over kaipu-media"
```

---

## Task 5: Positional recording writer (main)

**Files:**

- Create: `src/main/recording/recording-writer.ts`
- Test: `src/main/recording/recording-writer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { mkdtemp, readFile, readdir, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RecordingWriter } from "./recording-writer";

async function setup() {
  const vaultDir = await mkdtemp(join(tmpdir(), "rw-vault-"));
  const tempDir = await mkdtemp(join(tmpdir(), "rw-temp-"));
  const writer = new RecordingWriter({
    vaultDir: () => vaultDir,
    newId: () => "rec-fixed",
    now: () => 5000,
    tempDir,
  });
  return { writer, vaultDir, tempDir };
}

describe("RecordingWriter", () => {
  it("reconstructs the exact byte stream, honoring overwritten regions", async () => {
    const { writer, vaultDir } = await setup();
    await writer.create("s1");
    // Write "AAAA....", then overwrite bytes 2..3 with "BB" at position 2.
    await writer.write("s1", new TextEncoder().encode("AAAAAAAA").buffer, 0);
    await writer.write("s1", new TextEncoder().encode("BB").buffer, 2);
    const rec = await writer.finalize("s1", { title: "T", durationSeconds: 3 });
    const bytes = await readFile(rec.filePath, "utf-8");
    expect(bytes).toBe("AABBAAAA");
    expect(rec).toMatchObject({ id: "rec-fixed", title: "T", durationSeconds: 3 });
    expect(rec.filePath.endsWith("rec-fixed.mp4")).toBe(true);
    expect(rec.filePath.startsWith(vaultDir)).toBe(true);
  });

  it("writes a thumbnail when provided", async () => {
    const { writer, vaultDir } = await setup();
    await writer.create("s1");
    await writer.write("s1", new TextEncoder().encode("x").buffer, 0);
    await writer.finalize("s1", {
      title: "T",
      durationSeconds: 1,
      thumbnail: new Uint8Array([0xff, 0xd8, 0xff]).buffer,
    });
    await expect(access(join(vaultDir, ".kaipu", "rec-fixed.jpg"))).resolves.toBeUndefined();
  });

  it("abort deletes the temp file and leaves the vault empty", async () => {
    const { writer, vaultDir, tempDir } = await setup();
    await writer.create("s1");
    await writer.write("s1", new TextEncoder().encode("x").buffer, 0);
    await writer.abort("s1");
    expect(await readdir(tempDir)).toHaveLength(0);
    const vaultFiles = (await readdir(vaultDir)).filter((f) => f.endsWith(".mp4"));
    expect(vaultFiles).toHaveLength(0);
  });

  it("throws when writing to an unknown session", async () => {
    const { writer } = await setup();
    await expect(writer.write("ghost", new ArrayBuffer(1), 0)).rejects.toThrow(/session/i);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `bunx vitest run src/main/recording/recording-writer.test.ts`
Expected: FAIL — cannot resolve `./recording-writer`.

- [ ] **Step 3: Implement**

```ts
import { copyFile, open, mkdir, rename, unlink, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { LocalRecording } from "@shared/types/library-storage";
import { LibraryVault } from "../library/library-vault";

export interface FinalizeMeta {
  title: string;
  durationSeconds: number;
  /** JPEG bytes for the poster, optional. */
  thumbnail?: ArrayBuffer | null;
}

export interface RecordingWriterDeps {
  /** Current vault directory (can change at runtime). */
  vaultDir: () => string;
  /** Generates a filesystem-safe, sortable recording id. */
  newId: () => string;
  /** Wall clock (ms) — injectable for tests. */
  now?: () => number;
  /** Temp directory for in-progress files. */
  tempDir?: string;
}

interface Session {
  handle: FileHandle;
  tempPath: string;
}

/**
 * Writes streamed MP4 chunks from the renderer's mediabunny StreamTarget to disk
 * at exact byte positions, then moves the finished file into the vault. The
 * StreamTarget may rewrite earlier regions (faststart patches the moov), so we
 * write positionally with `FileHandle.write(buf, 0, len, position)` — never an
 * append stream.
 */
export class RecordingWriter {
  private readonly sessions = new Map<string, Session>();
  private readonly tempDir: string;
  private readonly now: () => number;

  constructor(private readonly deps: RecordingWriterDeps) {
    this.tempDir = deps.tempDir ?? tmpdir();
    this.now = deps.now ?? (() => Date.now());
  }

  async create(sessionId: string): Promise<{ tempPath: string }> {
    const tempPath = join(this.tempDir, `kaipu-rec-${sessionId}.mp4.part`);
    const handle = await open(tempPath, "w+");
    this.sessions.set(sessionId, { handle, tempPath });
    return { tempPath };
  }

  async write(sessionId: string, data: ArrayBuffer, position: number): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`No recording session "${sessionId}"`);
    const buf = Buffer.from(data);
    await session.handle.write(buf, 0, buf.byteLength, position);
  }

  async finalize(sessionId: string, meta: FinalizeMeta): Promise<LocalRecording> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`No recording session "${sessionId}"`);
    await session.handle.close();
    this.sessions.delete(sessionId);

    const vault = new LibraryVault(this.deps.vaultDir());
    const id = this.deps.newId();
    await mkdir(this.deps.vaultDir(), { recursive: true });
    const dest = await vault.filePath(id); // <id>.mp4 (does not exist yet)

    try {
      await rename(session.tempPath, dest);
    } catch {
      // Cross-device move (temp on a different volume than the vault).
      await copyFile(session.tempPath, dest);
      await unlink(session.tempPath).catch(() => {});
    }

    await vault.writeMeta(id, {
      title: meta.title,
      durationSeconds: meta.durationSeconds,
      createdAt: this.now(),
    });
    if (meta.thumbnail) await vault.writeThumbnail(id, Buffer.from(meta.thumbnail));

    const recording = await vault.describe(id);
    if (!recording) throw new Error(`Finalized recording "${id}" not found in vault`);
    return recording;
  }

  async abort(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    await session.handle.close().catch(() => {});
    await unlink(session.tempPath).catch(() => {});
    this.sessions.delete(sessionId);
  }
}

/** Default id: sortable, filesystem-safe, second-resolution timestamp. */
export function timestampId(now: number): string {
  const iso = new Date(now).toISOString().replace(/[:.]/g, "-").replace("T", "-").slice(0, 19);
  return `recording-${iso}`;
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `bunx vitest run src/main/recording/recording-writer.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
bunx oxfmt src/main/recording/recording-writer.ts src/main/recording/recording-writer.test.ts
git add src/main/recording/recording-writer.ts src/main/recording/recording-writer.test.ts
git commit -m "feat(kaipu-record): positional MP4 disk writer + finalize to vault"
```

---

## Task 6: IPC contract — channels, types, preload bridge

**Files:**

- Modify: `src/shared/types/ipc.ts`
- Modify: `src/shared/types/electron-api.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Add channel names to `ipc.ts`**

Add these entries inside the `IPC_CHANNELS` object (before the closing `} as const;`):

```ts
  // Recording engine (renderer ↔ main)
  recordingCreate: "recording:create",
  recordingWrite: "recording:write",
  recordingFinalize: "recording:finalize",
  recordingAbort: "recording:abort",
  recordingReportTick: "recording:report-tick",
  recordingStart: "recording:start",
  recordingStop: "recording:stop",
  // Control bar (main → bar broadcasts, bar → main commands)
  controlTick: "control:tick",
  controlCommand: "control:command",
  recordingCommand: "recording:command",
```

Then add the shared payload types at the bottom of `ipc.ts` (still no Node/Electron imports):

```ts
export type RecordingStatus = "recording" | "paused";

export interface RecordingTick {
  elapsedSeconds: number;
  levels: number[];
  status: RecordingStatus;
}

export type ControlCommand = "pause" | "resume" | "stop";

export interface RecordingFinalizeMeta {
  title: string;
  durationSeconds: number;
  thumbnail?: ArrayBuffer | null;
}

/** Source identity + display for placing the bar on the recorded screen. */
export interface RecordingStartInfo {
  sourceId: string;
  sourceName: string;
}
```

- [ ] **Step 2: Extend the bridge type in `electron-api.ts`**

Add the ipc import (`LocalRecording` is **already** imported at the top of the file
from `./library-storage` — don't duplicate it) and the new methods to the
`KaipuElectronAPI` interface:

```ts
import type {
  ControlCommand,
  RecordingFinalizeMeta,
  RecordingStartInfo,
  RecordingTick,
} from "./ipc";
```

Append inside `KaipuElectronAPI`:

```ts
  // ── Recording engine (used by the main/recorder window) ───────────────
  /** Open a disk-writer session; returns the temp path. */
  recordingCreate(sessionId: string): Promise<{ tempPath: string }>;
  /** Write a chunk at an exact byte position (positional, not append). */
  recordingWrite(sessionId: string, data: ArrayBuffer, position: number): void;
  /** Close the file, move it into the vault, return the new recording. */
  recordingFinalize(sessionId: string, meta: RecordingFinalizeMeta): Promise<LocalRecording>;
  /** Discard a failed session (delete temp). */
  recordingAbort(sessionId: string): Promise<void>;
  /** Push a live tick (elapsed/levels/status) to the hub for the bar. */
  recordingReportTick(tick: RecordingTick): void;
  /** Tell the hub recording started: hide main window, show the bar. */
  recordingStart(info: RecordingStartInfo): void;
  /** Tell the hub recording ended: hide the bar, restore main window. */
  recordingStop(): void;
  /** Recorder window subscribes to commands from the bar (pause/resume/stop). */
  onRecordingCommand(callback: (command: ControlCommand) => void): () => void;

  // ── Control bar window ────────────────────────────────────────────────
  /** Bar subscribes to live ticks. Returns an unsubscribe fn. */
  onControlTick(callback: (tick: RecordingTick) => void): () => void;
  /** Bar sends a command to the hub. */
  controlCommand(command: ControlCommand): void;
```

- [ ] **Step 3: Wire the bridge in `preload/index.ts`**

Add to the `kaipuApi` object:

```ts
  recordingCreate: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.recordingCreate, sessionId),
  recordingWrite: (sessionId, data, position) =>
    ipcRenderer.send(IPC_CHANNELS.recordingWrite, sessionId, data, position),
  recordingFinalize: (sessionId, meta) =>
    ipcRenderer.invoke(IPC_CHANNELS.recordingFinalize, sessionId, meta),
  recordingAbort: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.recordingAbort, sessionId),
  recordingReportTick: (tick) => ipcRenderer.send(IPC_CHANNELS.recordingReportTick, tick),
  recordingStart: (info) => ipcRenderer.send(IPC_CHANNELS.recordingStart, info),
  recordingStop: () => ipcRenderer.send(IPC_CHANNELS.recordingStop),
  onRecordingCommand: (callback) => {
    const listener = (_e: unknown, command: ControlCommand): void => callback(command);
    ipcRenderer.on(IPC_CHANNELS.recordingCommand, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.recordingCommand, listener);
  },
  onControlTick: (callback) => {
    const listener = (_e: unknown, tick: RecordingTick): void => callback(tick);
    ipcRenderer.on(IPC_CHANNELS.controlTick, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.controlTick, listener);
  },
  controlCommand: (command) => ipcRenderer.send(IPC_CHANNELS.controlCommand, command),
```

Add the import at the top of `preload/index.ts`:

```ts
import type { ControlCommand, RecordingTick } from "@shared/types/ipc";
```

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: PASS (both node + web).

- [ ] **Step 5: Commit**

```bash
bunx oxfmt src/shared/types/ipc.ts src/shared/types/electron-api.ts src/preload/index.ts
git add src/shared/types/ipc.ts src/shared/types/electron-api.ts src/preload/index.ts
git commit -m "feat(kaipu-record): IPC contract for recording engine + control bar"
```

---

## Task 7: Control bar window factory (main)

**Files:**

- Create: `src/main/recording/control-bar-window.ts`

- [ ] **Step 1: Implement (no unit test — BrowserWindow integration; verified manually in Task 14)**

```ts
import { BrowserWindow, screen } from "electron";
import { join } from "node:path";
import { is } from "@electron-toolkit/utils";

const BAR_WIDTH = 360;
const BAR_HEIGHT = 64;
const BOTTOM_MARGIN = 40;

/**
 * The floating, always-on-top control bar. A frameless, transparent window that
 * renders the renderer in control-bar mode (`?window=control-bar`). It floats
 * over every other app — including fullscreen — so the user keeps control while
 * working in the app they're recording.
 */
export class ControlBarWindow {
  private window: BrowserWindow | null = null;

  show(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.position();
      this.window.showInactive();
      return;
    }
    this.window = new BrowserWindow({
      width: BAR_WIDTH,
      height: BAR_HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: {
        preload: join(__dirname, "../preload/index.js"),
        sandbox: false,
        backgroundThrottling: false,
      },
    });
    // Float above fullscreen apps and stay out of Mission Control switching.
    this.window.setAlwaysOnTop(true, "screen-saver");
    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    const query = "window=control-bar";
    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      void this.window.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}?${query}`);
    } else {
      void this.window.loadFile(join(__dirname, "../renderer/index.html"), { search: query });
    }

    this.window.once("ready-to-show", () => {
      this.position();
      this.window?.showInactive();
    });
    this.window.on("closed", () => {
      this.window = null;
    });
  }

  /** Push a tick to the bar renderer. */
  send(channel: string, payload: unknown): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, payload);
    }
  }

  hide(): void {
    this.window?.hide();
  }

  destroy(): void {
    this.window?.destroy();
    this.window = null;
  }

  private position(): void {
    if (!this.window) return;
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const { x, y, width, height } = display.workArea;
    this.window.setBounds({
      x: Math.round(x + (width - BAR_WIDTH) / 2),
      y: Math.round(y + height - BAR_HEIGHT - BOTTOM_MARGIN),
      width: BAR_WIDTH,
      height: BAR_HEIGHT,
    });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck:node`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
bunx oxfmt src/main/recording/control-bar-window.ts
git add src/main/recording/control-bar-window.ts
git commit -m "feat(kaipu-record): floating control-bar window factory"
```

---

## Task 8: Recording hub (main) — relay + window orchestration

**Files:**

- Create: `src/main/recording/recording-hub.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: Implement the hub**

```ts
import { BrowserWindow, ipcMain } from "electron";
import { IPC_CHANNELS } from "@shared/types";
import type {
  ControlCommand,
  RecordingFinalizeMeta,
  RecordingStartInfo,
  RecordingTick,
} from "@shared/types/ipc";
import { ControlBarWindow } from "./control-bar-window";
import { RecordingWriter, timestampId } from "./recording-writer";
import { vaultDirectory } from "../library/vault-location";

/**
 * The single stateful coordinator for a recording. Owns the control-bar window
 * and relays between the (hidden) recorder window and the bar:
 *   recorder → report-tick → hub → control:tick → bar
 *   bar → control:command → hub → recording:command → recorder
 * It also hides/restores the main window so only the bar is visible while
 * recording, and registers the disk-writer IPC handlers.
 */
export function registerRecordingHub(getMainWindow: () => BrowserWindow | null): void {
  const bar = new ControlBarWindow();
  const writer = new RecordingWriter({
    vaultDir: () => vaultDirectory().path,
    newId: () => timestampId(Date.now()),
  });

  // ── Disk writer ──────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.recordingCreate, (_e, sessionId: string) => writer.create(sessionId));
  ipcMain.on(
    IPC_CHANNELS.recordingWrite,
    (_e, sessionId: string, data: ArrayBuffer, position: number) => {
      void writer.write(sessionId, data, position).catch((error) => {
        console.error("recording write failed", error);
      });
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.recordingFinalize,
    (_e, sessionId: string, meta: RecordingFinalizeMeta) => writer.finalize(sessionId, meta),
  );
  ipcMain.handle(IPC_CHANNELS.recordingAbort, (_e, sessionId: string) => writer.abort(sessionId));

  // ── Window orchestration ────────────────────────────────────────────
  ipcMain.on(IPC_CHANNELS.recordingStart, (_e, _info: RecordingStartInfo) => {
    getMainWindow()?.hide();
    bar.show();
  });
  ipcMain.on(IPC_CHANNELS.recordingStop, () => {
    bar.hide();
    const main = getMainWindow();
    main?.show();
    main?.focus();
  });

  // ── Relay ────────────────────────────────────────────────────────────
  ipcMain.on(IPC_CHANNELS.recordingReportTick, (_e, tick: RecordingTick) => {
    bar.send(IPC_CHANNELS.controlTick, tick);
  });
  ipcMain.on(IPC_CHANNELS.controlCommand, (_e, command: ControlCommand) => {
    getMainWindow()?.webContents.send(IPC_CHANNELS.recordingCommand, command);
  });
}
```

- [ ] **Step 2: Register it in `index.ts` + keep the hidden recorder running at full rate**

In `src/main/index.ts`, add the import:

```ts
import { registerRecordingHub } from "./recording/recording-hub";
```

Inside `createWindow()`, after creating `mainWindow`, disable throttling so the hidden recorder keeps encoding:

```ts
  mainWindow.webContents.setBackgroundThrottling(false);
```

Inside `app.whenReady().then(...)`, after `registerRecordingSourceHandlers();`, add:

```ts
  // Recording engine: disk writer, control-bar window, state relay.
  registerRecordingHub(() => mainWindow);
```

- [ ] **Step 3: Typecheck + full test run**

Run: `bun run typecheck && bun run test`
Expected: PASS (all existing + new unit tests).

- [ ] **Step 4: Commit**

```bash
bunx oxfmt src/main/recording/recording-hub.ts src/main/index.ts
git add src/main/recording/recording-hub.ts src/main/index.ts
git commit -m "feat(kaipu-record): recording hub relays state + drives the bar window"
```

---

## Task 9: Recorder engine (renderer) — provider seam + mediabunny

**Files:**

- Create: `src/renderer/src/features/recording/recorder-engine.ts`

> This module isolates all device/mediabunny calls behind one async factory, so
> `use-screen-recorder` stays a thin React wrapper. It is **not** unit-tested
> (browser media APIs); it is the seam where camera-PiP/watermark plug in later.

- [ ] **Step 1: Implement**

```ts
import {
  MediaStreamAudioTrackSource,
  MediaStreamVideoTrackSource,
  Mp4OutputFormat,
  Output,
  StreamTarget,
} from "mediabunny";
import { levelsFromTimeDomain } from "./audio-levels";

export interface EngineHandle {
  /** mediabunny source pause/resume (used for the Paused state). */
  pause(): void;
  resume(): void;
  /** Stop capture, finalize the MP4, and resolve when the file is flushed. */
  stop(): Promise<void>;
  /** Read the current 5-bar mic level (0..1). */
  readLevels(): number[];
  /** A still frame (JPEG) of the screen for the poster, captured at start. */
  thumbnail: ArrayBuffer | null;
}

export interface EngineOptions {
  sourceId: string;
  microphoneDeviceId: string | null;
  systemAudio: boolean;
  /** Receives each StreamTarget chunk to forward to the main-process writer. */
  onChunk(data: ArrayBuffer, position: number): void;
}

const VIDEO_BITRATE = 8_000_000; // ~8 Mbps, fine for 1080p screen content
const AUDIO_BITRATE = 128_000;

/**
 * Acquire screen + mic, mix audio, and start encoding to MP4 (H.264/AAC) via
 * mediabunny, streaming chunks out through `onChunk`. Returns a handle for
 * pause/resume/stop and live levels. NOTE: codec strings/options below must
 * match the installed mediabunny version (see plan's API caveat).
 */
export async function startEngine(options: EngineOptions): Promise<EngineHandle> {
  // 1. Screen (deterministic Electron desktop capture by source id).
  const screenStream = await navigator.mediaDevices.getUserMedia({
    audio: options.systemAudio
      ? ({ mandatory: { chromeMediaSource: "desktop" } } as MediaTrackConstraints)
      : false,
    video: {
      // @ts-expect-error Electron desktop-capture constraints are non-standard.
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: options.sourceId,
        maxWidth: 1920,
        maxHeight: 1080,
        maxFrameRate: 30,
      },
    },
  });
  const screenTrack = screenStream.getVideoTracks()[0];

  // 2. Mic (best-effort) + system-audio (best-effort) → mixed single track.
  const audioContext = new AudioContext();
  const destination = audioContext.createMediaStreamDestination();
  if (options.microphoneDeviceId) {
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { ideal: options.microphoneDeviceId } },
      });
      audioContext.createMediaStreamSource(mic).connect(destination);
    } catch {
      /* mic unavailable — continue without it */
    }
  }
  const systemAudioTrack = screenStream.getAudioTracks()[0];
  if (systemAudioTrack) {
    const sysStream = new MediaStream([systemAudioTrack]);
    audioContext.createMediaStreamSource(sysStream).connect(destination);
  }
  const mixedAudioTrack = destination.stream.getAudioTracks()[0];

  // 3. Mic-level analyser tapped off the mix.
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.3;
  audioContext.createMediaStreamSource(destination.stream).connect(analyser);
  const levelBuffer = new Uint8Array(analyser.fftSize);

  // 4. mediabunny output → StreamTarget → onChunk.
  const writable = new WritableStream<{ data: Uint8Array; position: number }>({
    write(chunk) {
      // Copy out of the pooled buffer before it's reused, transfer to main.
      const copy = chunk.data.slice().buffer;
      options.onChunk(copy, chunk.position);
    },
  });
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    target: new StreamTarget(writable),
  });
  const videoSource = new MediaStreamVideoTrackSource(screenTrack, {
    codec: "avc",
    bitrate: VIDEO_BITRATE,
  });
  output.addVideoTrack(videoSource, { frameRate: 30 });
  if (mixedAudioTrack) {
    const audioSource = new MediaStreamAudioTrackSource(mixedAudioTrack, {
      codec: "aac",
      bitrate: AUDIO_BITRATE,
    });
    output.addAudioTrack(audioSource);
  }
  await output.start();

  // 5. Poster thumbnail from the first screen frame.
  const thumbnail = await captureThumbnail(screenStream);

  return {
    pause: () => videoSource.pause?.(),
    resume: () => videoSource.resume?.(),
    readLevels: () => {
      analyser.getByteTimeDomainData(levelBuffer);
      return levelsFromTimeDomain(levelBuffer, 5);
    },
    thumbnail,
    async stop() {
      await output.finalize();
      screenStream.getTracks().forEach((t) => t.stop());
      destination.stream.getTracks().forEach((t) => t.stop());
      await audioContext.close();
    },
  };
}

async function captureThumbnail(stream: MediaStream): Promise<ArrayBuffer | null> {
  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await new Promise((r) => setTimeout(r, 150));
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    video.pause();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.7));
    return blob ? await blob.arrayBuffer() : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Typecheck the web project**

Run: `bun run typecheck:web`
Expected: PASS. If mediabunny export names/option keys differ, fix them now against `node_modules/mediabunny/dist/**/*.d.ts` (see API caveat). The `videoSource.pause?.()` optional-call guards a version where pause lives elsewhere — if the installed version exposes `pause()` on the Output or source differently, adjust.

- [ ] **Step 3: Commit**

```bash
bunx oxfmt src/renderer/src/features/recording/recorder-engine.ts
git add src/renderer/src/features/recording/recorder-engine.ts
git commit -m "feat(kaipu-record): mediabunny MP4 recorder engine (capture + encode seam)"
```

---

## Task 10: `useScreenRecorder` hook

**Files:**

- Create: `src/renderer/src/features/recording/hooks/use-screen-recorder.ts`

> Thin orchestration over the engine + IPC. Manual-verified in Task 14; the
> heavy logic (elapsed, levels) is already unit-tested in Tasks 1–2.

- [ ] **Step 1: Implement**

```ts
import { useCallback, useRef, useState } from "react";
import {
  elapsedMs,
  formatElapsed,
  pauseElapsed,
  resumeElapsed,
  startElapsed,
  type ElapsedState,
} from "@renderer/features/recording/elapsed";
import { startEngine, type EngineHandle } from "@renderer/features/recording/recorder-engine";

export type RecorderStatus = "idle" | "starting" | "recording" | "paused" | "finalizing" | "error";

export interface ScreenRecorderControls {
  status: RecorderStatus;
  start(input: { sourceId: string; sourceName: string; microphoneDeviceId: string | null;
                 systemAudio: boolean }): Promise<void>;
  stop(): Promise<void>;
  pause(): void;
  resume(): void;
}

let sessionCounter = 0;

export function useScreenRecorder(): ScreenRecorderControls {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const engineRef = useRef<EngineHandle | null>(null);
  const sessionRef = useRef<string | null>(null);
  const clockRef = useRef<ElapsedState | null>(null);
  const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTicks = useCallback(() => {
    if (tickTimer.current) clearInterval(tickTimer.current);
    tickTimer.current = null;
  }, []);

  const start = useCallback<ScreenRecorderControls["start"]>(
    async (input) => {
      if (engineRef.current) return;
      setStatus("starting");
      const sessionId = `session-${++sessionCounter}`;
      sessionRef.current = sessionId;
      try {
        await window.electronAPI.recordingCreate(sessionId);
        const engine = await startEngine({
          sourceId: input.sourceId,
          microphoneDeviceId: input.microphoneDeviceId,
          systemAudio: input.systemAudio,
          onChunk: (data, position) =>
            window.electronAPI.recordingWrite(sessionId, data, position),
        });
        engineRef.current = engine;
        clockRef.current = startElapsed(Date.now());
        setStatus("recording");
        window.electronAPI.recordingStart({ sourceId: input.sourceId, sourceName: input.sourceName });

        tickTimer.current = setInterval(() => {
          const clock = clockRef.current;
          if (!clock) return;
          const paused = clock.pausedAt !== null;
          window.electronAPI.recordingReportTick({
            elapsedSeconds: Math.floor(elapsedMs(clock, Date.now()) / 1000),
            levels: paused ? [0, 0, 0, 0, 0] : engine.readLevels(),
            status: paused ? "paused" : "recording",
          });
        }, 100);
      } catch (error) {
        console.error("failed to start recording", error);
        if (sessionRef.current) await window.electronAPI.recordingAbort(sessionRef.current);
        engineRef.current = null;
        setStatus("error");
      }
    },
    [],
  );

  const pause = useCallback(() => {
    if (!engineRef.current || !clockRef.current) return;
    engineRef.current.pause();
    clockRef.current = pauseElapsed(clockRef.current, Date.now());
    setStatus("paused");
  }, []);

  const resume = useCallback(() => {
    if (!engineRef.current || !clockRef.current) return;
    engineRef.current.resume();
    clockRef.current = resumeElapsed(clockRef.current, Date.now());
    setStatus("recording");
  }, []);

  const stop = useCallback(async () => {
    const engine = engineRef.current;
    const sessionId = sessionRef.current;
    if (!engine || !sessionId) return;
    setStatus("finalizing");
    stopTicks();
    const durationSeconds = clockRef.current
      ? Math.floor(elapsedMs(clockRef.current, Date.now()) / 1000)
      : 0;
    try {
      await engine.stop();
      const title = `Recording — ${new Date().toLocaleString()}`;
      await window.electronAPI.recordingFinalize(sessionId, {
        title,
        durationSeconds,
        thumbnail: engine.thumbnail,
      });
    } catch (error) {
      console.error("failed to finalize recording", error);
      await window.electronAPI.recordingAbort(sessionId);
      setStatus("error");
    } finally {
      window.electronAPI.recordingStop();
      engineRef.current = null;
      sessionRef.current = null;
      clockRef.current = null;
      setStatus("idle");
    }
  }, [stopTicks]);

  // The bar's buttons arrive as commands relayed by the hub.
  useRecordingCommands({ pause, resume, stop });

  // Avoid an unused-import lint on formatElapsed (re-exported for consumers).
  void formatElapsed;

  return { status, start, stop, pause, resume };
}

function useRecordingCommands(handlers: {
  pause(): void;
  resume(): void;
  stop(): Promise<void>;
}): void {
  const ref = useRef(handlers);
  ref.current = handlers;
  // Subscribe once; the hub forwards bar button presses here.
  useRefEffect(() => {
    return window.electronAPI.onRecordingCommand((command) => {
      if (command === "pause") ref.current.pause();
      else if (command === "resume") ref.current.resume();
      else if (command === "stop") void ref.current.stop();
    });
  });
}

// Tiny mount-once effect helper (kept local to avoid a dependency-array footgun).
import { useEffect } from "react";
function useRefEffect(setup: () => () => void): void {
  useEffect(() => setup(), []); // eslint-disable-line react-hooks/exhaustive-deps
}
```

> If the codebase's lint forbids the `void formatElapsed;` trick or mid-file
> imports, move the `useEffect` import to the top and drop the `void` line;
> they're only there to keep the example self-contained. Prefer top-of-file
> imports to match house style.

- [ ] **Step 2: Clean up imports to house style**

Move `import { useEffect } from "react"` into the top `react` import (`useCallback, useEffect, useRef, useState`), delete the bottom import line and the `void formatElapsed;` line, and remove `formatElapsed` from the elapsed import (the hook doesn't render text — the bar does).

- [ ] **Step 3: Typecheck + lint**

Run: `bun run typecheck:web && bun run lint`
Expected: PASS, 0 warnings.

- [ ] **Step 4: Commit**

```bash
bunx oxfmt src/renderer/src/features/recording/hooks/use-screen-recorder.ts
git add src/renderer/src/features/recording/hooks/use-screen-recorder.ts
git commit -m "feat(kaipu-record): useScreenRecorder orchestrates capture, ticks, lifecycle"
```

---

## Task 11: Control bar UI component

**Files:**

- Create: `src/renderer/src/features/control-bar/control-bar.tsx`
- Create: `src/renderer/src/features/control-bar/control-bar.module.css`
- Test: `src/renderer/src/features/control-bar/control-bar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ControlBar } from "./control-bar";

const baseTick = { elapsedSeconds: 257, levels: [0.2, 0.5, 0.8, 0.4, 0.1], status: "recording" as const };

describe("ControlBar", () => {
  it("renders the mono timer from elapsed seconds", () => {
    render(<ControlBar tick={baseTick} onPause={vi.fn()} onResume={vi.fn()} onStop={vi.fn()} />);
    expect(screen.getByText("00:04:17")).toBeInTheDocument();
  });

  it("shows pause while recording and resume + Paused while paused", () => {
    const { rerender } = render(
      <ControlBar tick={baseTick} onPause={vi.fn()} onResume={vi.fn()} onStop={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /pause/i })).toBeInTheDocument();
    rerender(
      <ControlBar
        tick={{ ...baseTick, status: "paused" }}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /resume/i })).toBeInTheDocument();
    expect(screen.getByText(/paused/i)).toBeInTheDocument();
  });

  it("fires the stop handler", async () => {
    const onStop = vi.fn();
    render(<ControlBar tick={baseTick} onPause={vi.fn()} onResume={vi.fn()} onStop={onStop} />);
    screen.getByRole("button", { name: /stop/i }).click();
    expect(onStop).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `bunx vitest run src/renderer/src/features/control-bar/control-bar.test.tsx`
Expected: FAIL — cannot resolve `./control-bar`.

- [ ] **Step 3: Implement the component**

```tsx
import React from "react";
import { Pause, Play, Square } from "lucide-react";
import { formatElapsed } from "@renderer/features/recording/elapsed";
import { IconButton } from "@renderer/ui/icon-button";
import { cx } from "@renderer/ui/cx";
import type { RecordingTick } from "@shared/types/ipc";
import styles from "./control-bar.module.css";

interface ControlBarProps {
  tick: RecordingTick;
  onPause(): void;
  onResume(): void;
  onStop(): void;
}

/** The floating recording HUD: status dot · mono timer · live mic level · pause/resume · stop. */
export function ControlBar({ tick, onPause, onResume, onStop }: ControlBarProps): React.JSX.Element {
  const paused = tick.status === "paused";
  return (
    <div className={styles.bar} data-paused={paused || undefined}>
      <span className={styles.dot} data-paused={paused || undefined} />
      {paused ? (
        <span className={styles.pausedLabel}>Paused</span>
      ) : (
        <MicLevel levels={tick.levels} />
      )}
      <span className={styles.time}>{formatElapsed(tick.elapsedSeconds * 1000)}</span>
      <div className={styles.divider} />
      {paused ? (
        <IconButton aria-label="Resume" onClick={onResume}>
          <Play size={15} />
        </IconButton>
      ) : (
        <IconButton aria-label="Pause" onClick={onPause}>
          <Pause size={15} />
        </IconButton>
      )}
      <button className={styles.stop} aria-label="Stop" onClick={onStop}>
        <Square size={13} fill="currentColor" />
      </button>
    </div>
  );
}

function MicLevel({ levels }: { levels: number[] }): React.JSX.Element {
  return (
    <div className={styles.meter} aria-hidden>
      {levels.map((value, i) => (
        <span key={i} className={cx(styles.meterBar)} style={{ ["--level" as string]: value }} />
      ))}
    </div>
  );
}
```

> Verify `lucide-react` and the `IconButton` import path against the codebase
> before running (the UI primitives live in `@renderer/ui/`). If `IconButton`
> doesn't accept `aria-label`/`onClick` passthrough, use a styled `<button>`
> like `.stop`.

- [ ] **Step 4: Implement the CSS module (our tokens, drag region)**

```css
/* The floating control bar. Transparent window → this pill is the only paint. */
.bar {
  -webkit-app-region: drag;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 44px;
  margin: 10px auto;
  width: max-content;
  padding: 0 8px 0 14px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 999px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
  font-family: var(--font-family);
}

.bar button,
.meter {
  -webkit-app-region: no-drag;
}

.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--accent-primary);
  animation: pulse 1.4s ease-in-out infinite;
}

.dot[data-paused] {
  background: var(--accent-amber, #f5a623);
  animation: none;
}

.time {
  font-family: var(--font-mono);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.pausedLabel {
  font-size: 12px;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.meter {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 16px;
}

.meterBar {
  width: 3px;
  height: calc(4px + var(--level, 0) * 12px);
  border-radius: 2px;
  background: var(--accent-primary);
  transition: height 80ms linear;
}

.divider {
  width: 1px;
  height: 20px;
  background: var(--border);
}

.stop {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 50%;
  background: var(--accent-primary);
  color: #fff;
  cursor: pointer;
}

.stop:hover {
  filter: brightness(1.08);
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}
```

- [ ] **Step 5: Run the component test**

Run: `bunx vitest run src/renderer/src/features/control-bar/control-bar.test.tsx`
Expected: PASS (3 tests). If `--accent-amber` isn't a token, the test still passes (CSS isn't asserted); add the token in `assets/base.css` for the visual.

- [ ] **Step 6: Commit**

```bash
bunx oxfmt src/renderer/src/features/control-bar/control-bar.tsx src/renderer/src/features/control-bar/control-bar.test.tsx
git add src/renderer/src/features/control-bar/control-bar.tsx src/renderer/src/features/control-bar/control-bar.module.css src/renderer/src/features/control-bar/control-bar.test.tsx
git commit -m "feat(kaipu-record): floating control bar UI (timer, mic meter, pause/stop)"
```

---

## Task 12: Control bar window root + renderer window-mode switch

**Files:**

- Create: `src/renderer/src/features/control-bar/control-bar-window.tsx`
- Modify: `src/renderer/src/main.tsx` (renderer entry)

- [ ] **Step 1: Implement the bar window root (subscribes to ticks, sends commands)**

```tsx
import React, { useEffect, useState } from "react";
import { ControlBar } from "./control-bar";
import type { RecordingTick } from "@shared/types/ipc";

const INITIAL_TICK: RecordingTick = { elapsedSeconds: 0, levels: [0, 0, 0, 0, 0], status: "recording" };

/** Root mounted in the floating control-bar window (`?window=control-bar`). */
export function ControlBarWindowRoot(): React.JSX.Element {
  const [tick, setTick] = useState<RecordingTick>(INITIAL_TICK);

  useEffect(() => window.electronAPI.onControlTick(setTick), []);

  return (
    <ControlBar
      tick={tick}
      onPause={() => window.electronAPI.controlCommand("pause")}
      onResume={() => window.electronAPI.controlCommand("resume")}
      onStop={() => window.electronAPI.controlCommand("stop")}
    />
  );
}
```

- [ ] **Step 2: Branch the renderer entry on window mode**

In `src/renderer/src/main.tsx`, read the query param and mount the right root. The
existing entry renders the app router; wrap it:

```tsx
import { ControlBarWindowRoot } from "@renderer/features/control-bar/control-bar-window";

const isControlBar = new URLSearchParams(window.location.search).get("window") === "control-bar";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{isControlBar ? <ControlBarWindowRoot /> : <App />}</React.StrictMode>,
);
```

> Match the file's existing import names (`App`, `ReactDOM`/`createRoot`). If the
> entry already calls `createRoot(...).render(<App/>)`, only swap the rendered
> element for the ternary above. For a transparent window, ensure the control-bar
> branch doesn't paint the app's opaque background — add `body[data-window="control-bar"]`
> handling or set the body background to transparent when `isControlBar`.

- [ ] **Step 3: Make the bar window background transparent**

In `main.tsx`, before render:

```tsx
if (isControlBar) document.body.style.background = "transparent";
```

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck:web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
bunx oxfmt src/renderer/src/features/control-bar/control-bar-window.tsx src/renderer/src/main.tsx
git add src/renderer/src/features/control-bar/control-bar-window.tsx src/renderer/src/main.tsx
git commit -m "feat(kaipu-record): mount the control bar in its own window mode"
```

---

## Task 13: Wire the Start button to the real engine

**Files:**

- Modify: `src/renderer/src/features/recording/hooks/use-recording-setup.ts`
- Modify: `src/renderer/src/pages/record/record-page.tsx`
- Modify: `src/renderer/src/features/capture-panel/capture-panel.tsx`

- [ ] **Step 1: Have `use-recording-setup` accept a real start/stop and drop the fake countdown→boolean**

In `use-recording-setup.ts`, the hook currently fakes recording. Wire it to the
real recorder while keeping the countdown UX. Replace the recording-lifecycle
section so `startRecording` runs the countdown and then calls an injected
`onStart`, and `isRecording` reflects the recorder status:

```ts
import { useScreenRecorder } from "@renderer/features/recording/hooks/use-screen-recorder";

// inside useRecordingSetup(), replace the isRecording/start/stop block:
const recorder = useScreenRecorder();
const isRecording = recorder.status === "recording" || recorder.status === "paused";

const startRecording = useCallback(() => {
  if (countdownTimer.current || isRecording || !selectedSource) return;
  let remaining = COUNTDOWN_SECONDS;
  setCountdown(remaining);
  countdownTimer.current = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearCountdown();
      void recorder.start({
        sourceId: selectedSource.id,
        sourceName: selectedSource.name,
        microphoneDeviceId: isMicrophoneEnabled ? (selectedMicrophone?.deviceId ?? null) : null,
        systemAudio: isSystemAudioEnabled,
      });
    } else {
      setCountdown(remaining);
    }
  }, 1000);
}, [
  isRecording, clearCountdown, selectedSource, isMicrophoneEnabled,
  selectedMicrophone, isSystemAudioEnabled, recorder,
]);

const stopRecording = useCallback(() => {
  clearCountdown();
  void recorder.stop();
}, [clearCountdown, recorder]);

const toggleRecording = useCallback(() => {
  if (isRecording) void recorder.stop();
  else startRecording();
}, [isRecording, recorder, startRecording]);
```

Remove the old `setRecording`/`isRecording` `useState` and the old start/stop
bodies. Keep `canStartRecording: Boolean(selectedSource)`.

- [ ] **Step 2: Verify the Record page + Capture Panel need no signature changes**

`record-page.tsx` and `capture-panel.tsx` already call `setup.startRecording` /
`setup.stopRecording` / `setup.toggleRecording`. Confirm they compile against the
new hook (no prop changes). The Record page already gates the button on
`canStartRecording`.

- [ ] **Step 3: Typecheck + lint + full tests**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: PASS, 0 warnings. Existing `use-recording-setup.test.tsx` may need its
recording-lifecycle assertions updated to mock `useScreenRecorder` — if it
asserts the old boolean flip, update it to assert `recorder.start` is called
after the countdown (mock the hook with `vi.mock`).

- [ ] **Step 4: Update the setup hook's test for the new wiring**

In `use-recording-setup.test.tsx`, mock the recorder and assert delegation:

```ts
import { vi } from "vitest";
const start = vi.fn();
const stop = vi.fn();
vi.mock("@renderer/features/recording/hooks/use-screen-recorder", () => ({
  useScreenRecorder: () => ({ status: "idle", start, stop, pause: vi.fn(), resume: vi.fn() }),
}));
// then: advance the 3s countdown with fake timers and expect(start).toHaveBeenCalledWith(
//   expect.objectContaining({ sourceId: ... }))
```

Run: `bunx vitest run src/renderer/src/features/recording/hooks/use-recording-setup.test.tsx`
Expected: PASS.

- [ ] **Step 5: Manual smoke test (real app)**

Run: `bun run dev`
Verify, in order:

1. Record page shows the selected screen; **Start Recording** is enabled.
2. Click Start → 3-2-1 countdown → main window hides, the floating bar appears bottom-center, timer counts up, mic bars move when you speak.
3. Pause → dot turns amber, "Paused", timer freezes. Resume → continues.
4. Stop → bar disappears, main window returns, you land on the new recording in the Library, and it **plays and seeks** correctly.
5. The file in the vault is `<id>.mp4` and opens in QuickTime.

- [ ] **Step 6: Commit**

```bash
bunx oxfmt src/renderer/src/features/recording/hooks/use-recording-setup.ts src/renderer/src/features/recording/hooks/use-recording-setup.test.tsx
git add src/renderer/src/features/recording/hooks/use-recording-setup.ts src/renderer/src/features/recording/hooks/use-recording-setup.test.tsx
git commit -m "feat(kaipu-record): wire Start Recording to the real engine"
```

---

## Task 14: Documentation + changelog

**Files:**

- Create: `apps/documentation/src/content/docs/desktop/recording-pipeline.mdx`
- Modify: `apps/documentation/src/content/docs/desktop/renderer-architecture.mdx`
- Modify: `apps/documentation/src/content/docs/changelog.mdx`

- [ ] **Step 1: Write `recording-pipeline.mdx`**

Document: the Option-A window model (hidden recorder + floating bar + hub),
the mediabunny MP4/H.264+AAC pipeline, positional disk writes (`fd.write@position`,
never append), the elapsed-with-pause clock + mic meter, the IPC contract table,
vault extension-awareness + thumbnails, and the provider seam as the camera/watermark
extension point. Mark camera PiP + watermark as designed-for follow-ups.

- [ ] **Step 2: Cross-link from `renderer-architecture.mdx`**

Add a "Recording" bullet under Related pointing to `/desktop/recording-pipeline`,
and a sentence in "Sharing recording state across windows" noting that recording
itself now runs via `useScreenRecorder` + the hub.

- [ ] **Step 3: Add changelog rows (dated 2026-06-26)**

Two rows: "Screen recording (mediabunny MP4)" 🎥 and "Floating control bar" 🎛️,
each one line summarizing the capability and linking the doc.

- [ ] **Step 4: Commit**

```bash
git add apps/documentation/src/content/docs/desktop/recording-pipeline.mdx apps/documentation/src/content/docs/desktop/renderer-architecture.mdx apps/documentation/src/content/docs/changelog.mdx
git commit -m "docs(kaipu-record): document the recording pipeline + control bar"
```

---

## Final verification

- [ ] `bun run typecheck` → PASS (node + web)
- [ ] `bun run lint` → 0 errors / 0 warnings
- [ ] `bun run test` → all suites PASS
- [ ] Manual smoke test from Task 13 Step 5 passes end-to-end
- [ ] `git status` clean

## Known follow-ups (out of scope, designed-for)

- **Camera PiP** (flagged important): swap `recorder-engine`'s screen track for a canvas
  compositor (`CanvasSource`) drawing screen + camera; the provider seam already isolates this.
- **Watermark**: an extra draw pass in the same compositor.
- **Quality settings**: wire resolution/fps/bitrate to the Settings page (currently fixed).
- **Cloudflare upload**: the MP4 output is ingest/serve-ready (Stream or R2); the upload flow is its own feature.
