---
title: "14 · Library thumbnails"
description: "Closes LIB-A6: screenshot cards load the full-resolution PNG as their thumbnail, with no lazy loading and no virtualization."
---

# Library thumbnails — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every card and row shows a ≤640 px JPEG poster, images load lazily, and screenshots saved before this change get a poster the first time one is requested.

**Architecture:** **Do not repoint `thumbnailUrl`** — for screenshots it is also the full-resolution source of the detail viewer (`library-detail-page.tsx:229`) and the editor's `?v=` version token (`open-in-editor.ts:57`). Instead `LocalRecording` gains an optional `posterUrl` (`kaipu-media://thumb/<id>?v=<mtime>`, screenshots only). A pure `screenshot-poster.ts` (`writeScreenshotPoster`, `ensureScreenshotPoster` with per-id in-flight dedupe) and an electron-bound `poster-render.ts` (`nativeImage` → 640 px JPEG q70) write `.kaipu/<id>.jpg` at save time; the `thumb` protocol route generates it lazily on a 404 for older screenshots. A renderer helper `posterSrc(item)` picks `posterUrl ?? thumbnailUrl`; cards, rows, the tag panel, recent screenshots and editor home use it with `loading="lazy" decoding="async"`. Virtualization: **no** at n=500 (3-column grid, ~12.5k nodes; the cost was image bytes, not nodes); reopen above ~2000 items or on measured mount jank — `content-visibility: auto` is the cheaper next step.

**Tech Stack:** Electron `nativeImage`, `kaipu-media://` protocol, vitest (temp-dir style of `gif-save.test.ts`; RTL for cards).

**Spec:** [Audit report](/audits/2026-10-15/report/) → LIB-A6 in [library lens A](/audits/2026-10-15/findings/library-a/). Closes: **LIB-A6**.

## Global Constraints

- Paths are relative to `apps/kaipu-record/src/`. Tests: `node_modules/.bin/vitest run <file>` from `apps/kaipu-record` — never `bunx`.
- `library-detail-page.tsx:229` and `open-in-editor.ts` stay untouched.
- `currentVault()` builds a fresh vault per call, so the in-flight dedupe map lives at module scope keyed by `vault.directory + id`.
- No test for `media-protocol.ts` or `screenshot-ipc.ts`: all logic lives in the pure module; the electron pieces are covered by the manual steps.
- JPEG has no alpha: a pasted transparent PNG gets a black poster background (cosmetic; code comment).
- First Library open after upgrade renders ~15 posters on demand in main (`nativeImage` decode is synchronous, ~30–100 ms each): ≈1 s of main-thread work once. Accepted; note in the PR.
- Side effect to mention: dragging a screenshot out of the app now has an icon (`index.ts:164` reads `thumbnailPath`).
- Commit messages in English, conventional-commit style.

## Review Focus

1. `thumbnailUrl` for a screenshot is still `kaipu-media://screenshot/<id>?v=…` after the change — Task 2 test (guards the repoint mistake).
2. Five concurrent `ensureScreenshotPoster` calls for one id render once — Task 1 test.
3. A poster older than its PNG is regenerated — Task 1 test (`utimes`).
4. A card with `posterUrl` renders that URL with `loading="lazy"` and `decoding="async"`; without it, falls back to `thumbnailUrl` — Task 3 tests.
5. The detail page and the image editor still show full resolution — manual step 3.

---

### Task 1: Pure poster module + electron renderer

**Files:**

- Create: `main/library/screenshot-poster.ts`, `main/library/poster-render.ts`
- Test: `main/library/screenshot-poster.test.ts`

**Interfaces:**

- Produces: `POSTER_WIDTH = 640`, `type RenderPoster = (png: Buffer) => Buffer | null`, `writeScreenshotPoster(vault, id, render): Promise<boolean>`, `ensureScreenshotPoster(vault, id, render): Promise<boolean>`, `renderScreenshotPoster: RenderPoster`.

- [ ] **Step 1: Write the failing tests** (temp dir per test; fake `render = (png) => Buffer.from([0xff, 0xd8, 0xff, png.length])`)

```ts
import { mkdtemp, readFile, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryVault } from "./library-vault";
import { ensureScreenshotPoster, writeScreenshotPoster } from "./screenshot-poster";

describe("screenshot poster", () => {
  let dir: string;
  let vault: LibraryVault;
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const render = vi.fn((bytes: Buffer) => Buffer.from([0xff, 0xd8, 0xff, bytes.length]));
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kaipu-poster-"));
    vault = new LibraryVault(dir);
    render.mockClear();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writeScreenshotPoster writes .kaipu/<id>.jpg from the PNG bytes", async () => {
    await vault.writeImage("s1", png);
    expect(await writeScreenshotPoster(vault, "s1", render)).toBe(true);
    expect([...(await readFile(vault.thumbnailPath("s1")))]).toEqual([0xff, 0xd8, 0xff, png.length]);
  });
  it("returns false and writes nothing when render returns null", async () => {
    await vault.writeImage("s1", png);
    expect(await writeScreenshotPoster(vault, "s1", () => null)).toBe(false);
    await expect(readFile(vault.thumbnailPath("s1"))).rejects.toThrow();
  });
  it("returns false for a non-PNG id", async () => {
    await vault.writeGif("g1", new Uint8Array([0x47, 0x49, 0x46]));
    expect(await writeScreenshotPoster(vault, "g1", render)).toBe(false);
  });
  it("ensureScreenshotPoster generates a missing poster once and reuses it", async () => {
    await vault.writeImage("s1", png);
    expect(await ensureScreenshotPoster(vault, "s1", render)).toBe(true);
    expect(await ensureScreenshotPoster(vault, "s1", render)).toBe(true);
    expect(render).toHaveBeenCalledTimes(1);
  });
  it("regenerates when the PNG is newer than the poster", async () => {
    await vault.writeImage("s1", png);
    await ensureScreenshotPoster(vault, "s1", render);
    const past = new Date(Date.now() - 60_000);
    await utimes(vault.thumbnailPath("s1"), past, past);
    await ensureScreenshotPoster(vault, "s1", render);
    expect(render).toHaveBeenCalledTimes(2);
  });
  it("shares one render across concurrent calls", async () => {
    await vault.writeImage("s1", png);
    await Promise.all([1, 2, 3, 4, 5].map(() => ensureScreenshotPoster(vault, "s1", render)));
    expect(render).toHaveBeenCalledTimes(1);
  });
  it("returns false for an id with no file", async () => {
    expect(await ensureScreenshotPoster(vault, "nope", render)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — module missing.

- [ ] **Step 3: Implement**

```ts
// main/library/screenshot-poster.ts
import { readFile, stat } from "node:fs/promises";
import type { LibraryVault } from "./library-vault";

/** Poster width in px; matches the video posters (renderer/src/lib/generate-thumbnail.ts). */
export const POSTER_WIDTH = 640;

/** PNG bytes -> JPEG bytes at most POSTER_WIDTH wide; null if the bytes are not a decodable image. */
export type RenderPoster = (png: Buffer) => Buffer | null;

async function posterIsFresh(vault: LibraryVault, id: string, pngPath: string): Promise<boolean> {
  try {
    const [jpg, png] = await Promise.all([stat(vault.thumbnailPath(id)), stat(pngPath)]);
    return jpg.mtimeMs >= png.mtimeMs;
  } catch {
    return false;
  }
}

/** Always (re)writes `.kaipu/<id>.jpg` from the current `<id>.png`. Returns false when it could not. */
export async function writeScreenshotPoster(
  vault: LibraryVault,
  id: string,
  render: RenderPoster,
): Promise<boolean> {
  const pngPath = await vault.filePath(id);
  if (!pngPath.endsWith(".png")) return false;
  const jpg = render(await readFile(pngPath));
  if (!jpg) return false;
  await vault.writeThumbnail(id, jpg);
  return true;
}

const inFlight = new Map<string, Promise<boolean>>();

/**
 * Makes sure a fresh poster exists for a screenshot: no-op when `.kaipu/<id>.jpg` is not older
 * than the PNG, otherwise generates it. Concurrent calls for one id share one render (the grid
 * requests many posters at once). Safe to call for non-screenshots: returns false.
 */
export function ensureScreenshotPoster(
  vault: LibraryVault,
  id: string,
  render: RenderPoster,
): Promise<boolean> {
  const key = `${vault.directory}\u0000${id}`;
  const running = inFlight.get(key);
  if (running) return running;
  const job = (async () => {
    const pngPath = await vault.filePath(id);
    if (!pngPath.endsWith(".png")) return false;
    if (await posterIsFresh(vault, id, pngPath)) return true;
    return writeScreenshotPoster(vault, id, render);
  })()
    .catch(() => false)
    .finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}
```

```ts
// main/library/poster-render.ts
import { nativeImage } from "electron";
import { POSTER_WIDTH, type RenderPoster } from "./screenshot-poster";

const POSTER_QUALITY = 70; // same as the video posters (canvas.toBlob(..., 0.7))

/** JPEG has no alpha: a transparent PNG gets a black poster background (cosmetic). */
export const renderScreenshotPoster: RenderPoster = (png) => {
  const image = nativeImage.createFromBuffer(png);
  if (image.isEmpty()) return null;
  const { width } = image.getSize();
  // Never upscale a small capture; height follows the aspect ratio when only width is given.
  const scaled = width > POSTER_WIDTH ? image.resize({ width: POSTER_WIDTH, quality: "good" }) : image;
  return scaled.toJPEG(POSTER_QUALITY);
};
```

- [ ] **Step 4: Run and commit** — PASS, 7 tests.

```bash
git add src/main/library/screenshot-poster.ts src/main/library/poster-render.ts src/main/library/screenshot-poster.test.ts
git commit -m "feat(desktop): screenshot posters — pure generator with in-flight dedupe"
```

### Task 2: `posterUrl` on `LocalRecording`; write at save; lazy backfill in the protocol

**Files:**

- Modify: `shared/types/library-storage.ts:28`
- Modify: `main/library/library-vault.ts:166-174` (`describe` tail)
- Modify: `main/screenshots/screenshot-ipc.ts` (imports; after `vault.writeImage`)
- Modify: `main/media-protocol.ts:1-7`, `:102-108`
- Test: `main/library/library-vault.test.ts`

- [ ] **Step 1: Write the failing test** (in the "LibraryVault — screenshots" describe)

```ts
it("lists a screenshot with a posterUrl on the thumb route sharing the ?v token", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vault-"));
  dirs.push(dir);
  const vault = new LibraryVault(dir);
  await vault.writeImage("shot-1", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const shot = (await vault.list()).find((i) => i.id === "shot-1")!;
  expect(shot.thumbnailUrl).toMatch(/^kaipu-media:\/\/screenshot\/shot-1\?v=\d+$/);
  const v = shot.thumbnailUrl!.split("?v=")[1];
  expect(shot.posterUrl).toBe(`kaipu-media://thumb/shot-1?v=${v}`);
});

it("recordings have no posterUrl", async () => {
  await writeRecording("clip");
  expect((await vault.describe("clip"))!.posterUrl).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

`shared/types/library-storage.ts` after `thumbnailUrl`:

```ts
  /** Screenshots only: 640 px JPEG for cards and rows. `thumbnailUrl` stays the full-size PNG. */
  posterUrl?: string | null;
```

`library-vault.ts` `describe` tail — keep `thumbnailUrl` exactly as is and add:

```ts
      // Downsized (640 px) JPEG for list/grid cards. thumbnailUrl stays the full PNG because the
      // detail viewer and the image editor read their bytes from it. The poster is generated at
      // save time, or lazily by the media protocol for screenshots saved before this existed.
      posterUrl: isImage ? `kaipu-media://thumb/${id}?v=${Math.round(info.mtimeMs)}` : undefined,
```

`screenshot-ipc.ts` — imports `writeScreenshotPoster` from `../library/screenshot-poster` and `renderScreenshotPoster` from `../library/poster-render`; after `await vault.writeImage(id, Buffer.from(png));`:

```ts
      // Best-effort: a missing poster is cosmetic (the protocol rebuilds it on first request).
      await writeScreenshotPoster(vault, id, renderScreenshotPoster).catch(() => false);
```

`media-protocol.ts` — imports: `import { currentVault, recordingFilePath, screenshotFilePath, thumbnailFilePath } from "./library";`, `ensureScreenshotPoster`, `renderScreenshotPoster`; replace the `try/catch` around `streamFile`:

```ts
    try {
      return await streamFile(target, request.headers.get("range"));
    } catch {
      // A missing poster may be a screenshot saved before posters existed: build it once, retry once.
      if (hostname === "thumb" && (await ensureScreenshotPoster(currentVault(), id, renderScreenshotPoster))) {
        try {
          return await streamFile(target, request.headers.get("range"));
        } catch {
          /* fall through to 404 */
        }
      }
      return new Response("Not found", { status: 404 });
    }
```

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/main/library && bun run check-types` → PASS.

```bash
git add src/shared/types/library-storage.ts src/main/library/library-vault.ts src/main/library/library-vault.test.ts src/main/screenshots/screenshot-ipc.ts src/main/media-protocol.ts
git commit -m "feat(desktop): posterUrl for screenshots, written at save and backfilled by the media protocol"
```

### Task 3: Renderer uses the poster, lazily

**Files:**

- Modify: `renderer/src/features/library/types.ts:26`, `map-item.ts:15`
- Create: `renderer/src/features/library/poster-url.ts` (+ test)
- Modify: `renderer/src/features/library/components/video-card.tsx:60-67`, `video-row.tsx:60-67`, `tag-panel.tsx:166-167`, `renderer/src/features/screenshots/recent-screenshots.tsx:45`, `renderer/src/pages/editor/editor-home-page.tsx:246`
- Test: `video-card.test.tsx`, `video-row.test.tsx`, `map-item.test.ts`

- [ ] **Step 1: Write the failing tests**

`poster-url.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { posterSrc } from "./poster-url";

describe("posterSrc", () => {
  it("prefers the poster, then the thumbnail, then null", () => {
    expect(posterSrc({ posterUrl: "p", thumbnailUrl: "t" })).toBe("p");
    expect(posterSrc({ posterUrl: null, thumbnailUrl: "t" })).toBe("t");
    expect(posterSrc({ posterUrl: null, thumbnailUrl: null })).toBeNull();
  });
});
```

`video-card.test.tsx` (mirror in `video-row.test.tsx`):

```tsx
it("uses the poster, lazily", () => {
  const { container } = render(
    <VideoCard
      video={{ ...video, kind: "screenshot", thumbnailUrl: "kaipu-media://screenshot/s?v=1", posterUrl: "kaipu-media://thumb/s?v=1" }}
      onNavigate={vi.fn()}
      onDelete={vi.fn()}
    />,
  );
  const img = container.querySelector("img")!;
  expect(img.getAttribute("src")).toBe("kaipu-media://thumb/s?v=1");
  expect(img.getAttribute("loading")).toBe("lazy");
  expect(img.getAttribute("decoding")).toBe("async");
});

it("falls back to the thumbnail without a poster", () => {
  const { container } = render(
    <VideoCard video={{ ...video, thumbnailUrl: "kaipu-media://thumb/r" }} onNavigate={vi.fn()} onDelete={vi.fn()} />,
  );
  expect(container.querySelector("img")!.getAttribute("src")).toBe("kaipu-media://thumb/r");
});
```

`map-item.test.ts`: assert `posterUrl` passes through and is `null` when absent (extend any `toEqual` whole-object expectations with `posterUrl: null`).

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement**

`types.ts`: `posterUrl?: string | null;` after `thumbnailUrl`. `map-item.ts`: `posterUrl: item.local?.posterUrl ?? null,`.

```ts
// renderer/src/features/library/poster-url.ts
import type { LibraryVideo } from "./types";

/** The image a card should show: the small poster when there is one, else the thumbnail. */
export function posterSrc(item: Pick<LibraryVideo, "posterUrl" | "thumbnailUrl">): string | null {
  return item.posterUrl ?? item.thumbnailUrl ?? null;
}
```

`video-card.tsx` / `video-row.tsx`: `const poster = posterSrc(video);` above the return, then

```tsx
      <div className={styles.poster}>
        {poster ? (
          <img src={poster} alt="" className={styles.posterImage} loading="lazy" decoding="async" />
        ) : (
          <div className={styles.posterFallback} aria-hidden>
            <Film size={26} strokeWidth={1.5} />
          </div>
        )}
```

`tag-panel.tsx:166-167`, `editor-home-page.tsx:246`: `src={posterSrc(video) ?? undefined}` plus `loading="lazy" decoding="async"`. `recent-screenshots.tsx:45` (`shot` is a `LocalRecording`, structurally compatible): `const src = shot.posterUrl ?? shot.thumbnailUrl;` and `{src && <img src={src} alt={shot.title} loading="lazy" decoding="async" />}`.

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/renderer/src/features/library src/renderer/src/features/screenshots src/renderer/src/pages/editor && bun run check-types` → PASS.

```bash
git add src/renderer/src/features/library src/renderer/src/features/screenshots/recent-screenshots.tsx src/renderer/src/pages/editor/editor-home-page.tsx
git commit -m "perf(desktop): cards use the 640px poster and load images lazily"
```

### Task 4: Ship

- [ ] Open a PR titled `perf(desktop): screenshot posters and lazy card images (audit LIB-A6)` linking this plan and the finding; include the virtualization verdict and its reopen condition; mention the one-time backfill cost and the drag-icon side effect. End with **How to test it yourself**:
  1. Take a screenshot → `ls -l "<vault>/.kaipu/<id>.jpg"` exists, far smaller than the PNG, 640 px wide.
  2. Delete one older screenshot's `.kaipu/<id>.jpg`, open the Library → its card shows an image and the jpg reappears.
  3. Open that screenshot's detail page and the image editor → both still show the full-resolution image.
  4. Edit + Save the screenshot, return to the Library → the card shows the updated image.
  5. With ~50 screenshots, watch DevTools Network while idle: only on-screen cards requested images.
- [ ] The PR deletes this plan file and removes its row from `plans/audit-2026-10-15/00-index.md`.
