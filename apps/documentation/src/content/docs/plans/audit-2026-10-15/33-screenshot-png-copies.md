---
title: "33 · Screenshot PNG copies"
description: "Closes SHOT-A3, SHOT-A4, SHOT-A6: a capture's PNG is copied ~6 times before the editor shows it and retained per capture in browser-process history state; main decodes the whole PNG just to read an unused size; pasting a PNG re-encodes it PNG→PNG on the main thread."
---

# Screenshot PNG copies — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A capture reaches the editor with no decode in main, no PNG bytes in router history, and a pasted PNG opens without being decoded and re-encoded.

**Architecture:** A pure `shared/png-size.ts` reads width/height from the IHDR chunk (24 bytes) and replaces the `nativeImage` decode in the capture handler and the canvas round-trip in `paste-image.ts` (PNG shortcut; other formats still re-encode). A `pending-capture.ts` holder in `image-source/` keeps at most 3 blob sources in renderer memory and puts only `{ captureKey }` in router state; `openCapture` holds blob sources, `ScreenshotEditorPage` resolves the key (same object every call, so `useImageSource`'s `[source]` dep stays stable) and redirects to the Editor home when the capture is gone. The main-side `Buffer → ArrayBuffer` slice becomes zero-copy when the Buffer owns its whole slab. Copy-to-clipboard keeps its `nativeImage` decode (needed for the multi-format pasteboard entry).

**Tech Stack:** `DataView` PNG header parsing, react-router state, vitest (node project for `shared/`, jsdom for the renderer).

**Spec:** [Audit report](/audits/2026-10-15/report/) → SHOT-A3, A4, A6 in [screenshot lens A](/audits/2026-10-15/findings/screenshot-a/). Closes: **SHOT-A3, SHOT-A4, SHOT-A6**.

## Global Constraints

- Paths are relative to `apps/kaipu-record/src/`. Tests: `node_modules/.bin/vitest run <file>` from `apps/kaipu-record` — never `bunx`.
- `shared/png-size.ts` imports nothing (preload-bundle rule).
- The IPC payload shapes keep `width`/`height` (now from IHDR; `{0,0}` if unparsable — unused downstream).
- `LegacyScreenshotEditorRedirect` still forwards a raw `ImageSource` as state; `sourceFromState` must accept both a `CaptureRef` and a raw source.
- Behaviour change to state in the PR: a reload on `/editor/capture` used to keep the capture bytes (history state survives reload in Electron); now it lands on the Editor home, and Back past 3 newer captures does too. Mitigated by auto-save (the default).
- `sourceFromState` is a pure lookup, never "take and delete" (StrictMode double render).
- Two existing assertions change: `editor-new-page.test.tsx` (router state is now a key) and `editor-routes.test.tsx:258`.
- Plan 34 edits the `clipboard:peek-image` handler in the same file and also uses `readPngSize`; land this plan first.
- Commit messages in English, conventional-commit style.

## Review Focus

1. `readPngSize` reads 3024×1964 from a header, works on a `Uint8Array` view with a non-zero offset, and returns `null` for JPEG magic / <24 bytes / non-IHDR / zero dimension — Task 1 tests.
2. `decodeToPng` on an `image/png` File returns the input bytes unchanged and never calls `createImageBitmap`; garbage labelled PNG falls through — Task 2 tests.
3. `openCapture(blobSource)` leaves state without a `bytes` property and `sourceFromState(state)` is the same object — Task 3 test.
4. Holding 4 captures evicts the first; an unknown key → `null` — Task 3 tests.
5. Main-process memory stays flat across 5 hotkey captures (manual).

---

### Task 1: `shared/png-size.ts` and the capture handler

**Files:**

- Create: `shared/png-size.ts`, `shared/png-size.test.ts`
- Modify: `main/screenshots/screenshot-ipc.ts:51-58` (capture), `:80-86` (paste fallback)

**Interfaces:**

- Produces: `readPngSize(bytes: ArrayBuffer | Uint8Array): { width: number; height: number } | null`.

- [ ] **Step 1: Write the failing tests** (node project; helper `pngHeader(w, h)` builds signature + length 13 + "IHDR" + w + h via `DataView`)

```ts
import { describe, expect, it } from "vitest";
import { readPngSize } from "./png-size";

function pngHeader(w: number, h: number, chunk = "IHDR"): Uint8Array {
  const out = new Uint8Array(24);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const v = new DataView(out.buffer);
  v.setUint32(8, 13);
  for (let i = 0; i < 4; i++) out[12 + i] = chunk.charCodeAt(i);
  v.setUint32(16, w);
  v.setUint32(20, h);
  return out;
}

describe("readPngSize", () => {
  it("reads width and height from the IHDR chunk", () => {
    expect(readPngSize(pngHeader(3024, 1964))).toEqual({ width: 3024, height: 1964 });
  });
  it("works on a Uint8Array view with a non-zero offset", () => {
    const padded = new Uint8Array(32);
    padded.set(pngHeader(40, 30), 8);
    expect(readPngSize(padded.subarray(8))).toEqual({ width: 40, height: 30 });
  });
  it.each([
    ["jpeg magic", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(20).fill(0)])],
    ["too short", pngHeader(1, 1).subarray(0, 20)],
    ["not IHDR first", pngHeader(1, 1, "IDAT")],
    ["zero dimension", pngHeader(0, 5)],
  ])("returns null for %s", (_n, bytes) => {
    expect(readPngSize(bytes)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail** — module missing.

- [ ] **Step 3: Implement**

```ts
// shared/png-size.ts
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Pixel size of a PNG from its IHDR chunk (the first 24 bytes), or null when the
 * bytes are not a PNG. Reads a header instead of decoding the image.
 */
export function readPngSize(bytes: ArrayBuffer | Uint8Array): { width: number; height: number } | null {
  const view =
    bytes instanceof Uint8Array ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) : new DataView(bytes);
  if (view.byteLength < 24) return null;
  for (let i = 0; i < SIGNATURE.length; i++) if (view.getUint8(i) !== SIGNATURE[i]) return null;
  // Bytes 12-15 are the chunk type: IHDR.
  if (view.getUint32(12) !== 0x49484452) return null;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}
```

`screenshot-ipc.ts` — `import { readPngSize } from "@shared/png-size";`, a module helper, and the capture handler tail:

```ts
/** The Buffer's bytes as an ArrayBuffer, without copying when it owns its whole buffer. */
function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength
    ? (buf.buffer as ArrayBuffer)
    : (buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
}
// ...
    if (!png) return null;
    // Size from the IHDR header: no full decode on the hotkey-to-editor path.
    const { width, height } = readPngSize(png) ?? { width: 0, height: 0 };
    return { png: toArrayBuffer(png), width, height };
```

In `clipboardReadImage` use `toArrayBuffer(png)` for the slice (keep `toPNG()` — non-PNG pasteboard sources need it). Copy handlers unchanged.

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/shared/png-size.test.ts && bun run check-types` → PASS.

```bash
git add src/shared/png-size.ts src/shared/png-size.test.ts src/main/screenshots/screenshot-ipc.ts
git commit -m "perf(desktop): read a capture's size from the PNG header instead of decoding it in main"
```

### Task 2: Paste shortcut for PNG

**Files:**

- Modify: `renderer/src/features/editor/paste-image.ts:28-60`
- Create: `renderer/src/features/editor/paste-image.test.ts`

- [ ] **Step 1: Write the failing tests** (reuse a `pngHeader` helper; `afterEach(() => vi.unstubAllGlobals())`)

```ts
it("uses a pasted PNG's bytes as they are and reads the size from the header", async () => {
  const createImageBitmap = vi.fn();
  vi.stubGlobal("createImageBitmap", createImageBitmap);
  const file = new File([pngHeader(40, 30)], "a.png", { type: "image/png" });
  const out = await decodeToPng(file);
  expect(out).toMatchObject({ width: 40, height: 30 });
  expect(out.png.byteLength).toBe(24);
  expect(createImageBitmap).not.toHaveBeenCalled();
});
it("decodes non-PNG formats through a canvas", async () => {
  vi.stubGlobal("createImageBitmap", vi.fn(() => { throw new Error("decoded"); }));
  await expect(decodeToPng(new File([new Uint8Array(4)], "a.jpg", { type: "image/jpeg" }))).rejects.toThrow("decoded");
});
it("falls through to the decoder for garbage labelled as PNG", async () => {
  vi.stubGlobal("createImageBitmap", vi.fn(() => { throw new Error("decoded"); }));
  await expect(decodeToPng(new File([new Uint8Array(4)], "a.png", { type: "image/png" }))).rejects.toThrow("decoded");
});
```

Also cover `imageFileFromPaste` (first `image/*` item; `null` for text-only) and `pastedImageSource` (kind `blob`, origin `paste`) since the file has no test.

- [ ] **Step 2: Run to verify the first fails** — `createImageBitmap` is called.

- [ ] **Step 3: Implement** — at the top of `decodeToPng`:

```ts
  // Already a PNG (every macOS screenshot): use its bytes as they are and read the
  // size from the header, instead of decoding and re-encoding it.
  if (file.type === "image/png") {
    const png = await file.arrayBuffer();
    const size = readPngSize(png);
    if (size) return { png, ...size };
  }
  // ...existing createImageBitmap path for other formats
```

(import `readPngSize` from `@shared/png-size`; update the doc comment: non-PNG formats are re-encoded.)

- [ ] **Step 4: Run and commit** — `node_modules/.bin/vitest run src/renderer/src/features/editor` → PASS.

```bash
git add src/renderer/src/features/editor/paste-image.ts src/renderer/src/features/editor/paste-image.test.ts
git commit -m "perf(desktop): a pasted PNG opens without a decode/re-encode round trip"
```

### Task 3: Captures out of router history

**Files:**

- Create: `renderer/src/features/screenshots/image-source/pending-capture.ts` (+ test); export from `image-source/index.ts`
- Modify: `renderer/src/features/editor/open-in-editor.ts:81-89`
- Modify: `renderer/src/pages/screenshot-editor/screenshot-editor-page.tsx:76-81`
- Test: `renderer/src/features/editor/open-in-editor.test.ts`, update `renderer/src/pages/editor/editor-new-page.test.tsx` and `editor-routes.test.tsx:258`

**Interfaces:**

- Produces: `holdCapture(source: BlobSource): { captureKey: string }`, `sourceFromState(state: unknown): ImageSource | null`, `type CaptureRef`.

- [ ] **Step 1: Write the failing tests**

`pending-capture.test.ts`:

```ts
it("returns the same object for a held capture", () => {
  const src = { kind: "blob" as const, bytes: new ArrayBuffer(4), title: "t" };
  const ref = holdCapture(src);
  expect(ref).not.toHaveProperty("bytes");
  expect(sourceFromState(ref)).toBe(src);
  expect(sourceFromState(ref)).toBe(src);
});
it("passes a raw source through and maps null/unknown to null", () => {
  const raw = { kind: "local" as const, id: "s1", assetId: "a1" };
  expect(sourceFromState(raw)).toBe(raw);
  expect(sourceFromState(null)).toBeNull();
  expect(sourceFromState({ captureKey: "nope" })).toBeNull();
});
it("keeps at most 3 captures", () => {
  const refs = [1, 2, 3, 4].map(() => holdCapture({ kind: "blob", bytes: new ArrayBuffer(1) }));
  expect(sourceFromState(refs[0]!)).toBeNull();
  expect(sourceFromState(refs[3]!)).not.toBeNull();
});
```

`open-in-editor.test.ts` (new `renderHook` test with a `MemoryRouter` wrapper):

```tsx
it("openCapture keeps PNG bytes out of history state", () => {
  const blob = { kind: "blob" as const, bytes: new ArrayBuffer(8), title: "t" };
  const { result } = renderHook(() => ({ api: useOpenInEditor(), location: useLocation() }), { wrapper });
  act(() => result.current.api.openCapture(blob));
  expect(result.current.location.state).not.toHaveProperty("bytes");
  expect(sourceFromState(result.current.location.state)).toBe(blob);
});
```

Update `editor-new-page.test.tsx`'s first assertion to `expect(sourceFromState(router.state.location.state)).toMatchObject({ kind: "blob", origin: "paste", bytes: fromMain.png, width: 50, height: 40, title: expect.stringMatching(/^Pasted image — /) })` and `editor-routes.test.tsx:258` the same way.

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement**

```ts
// image-source/pending-capture.ts
import type { ImageSource } from "./types";

type BlobSource = Extract<ImageSource, { kind: "blob" }>;

/** Router state for an in-memory capture: a key into the holder, never the bytes. */
export interface CaptureRef {
  captureKey: string;
}

/** How many captures stay reachable for Back/Forward; older ones drop. */
const MAX_HELD = 3;
const held = new Map<string, BlobSource>();

/** Park an in-memory image and return the key to put in router state. */
export function holdCapture(source: BlobSource): CaptureRef {
  const captureKey = crypto.randomUUID();
  held.set(captureKey, source);
  while (held.size > MAX_HELD) held.delete(held.keys().next().value as string);
  return { captureKey };
}

function isCaptureRef(state: unknown): state is CaptureRef {
  return typeof state === "object" && state !== null && "captureKey" in state;
}

/**
 * The source behind an editor-capture route's state: a held capture (same object
 * every call, so the editor's source identity is stable), a raw source from the
 * legacy redirect, or null when the capture is gone (reload, evicted entry).
 */
export function sourceFromState(state: unknown): ImageSource | null {
  if (isCaptureRef(state)) return held.get(state.captureKey) ?? null;
  return (state as ImageSource | null) ?? null;
}
```

`image-source/index.ts`: `export { holdCapture, sourceFromState, type CaptureRef } from "./pending-capture";`.

`open-in-editor.ts`:

```ts
  const openCapture = useCallback(
    (source: ImageSource, options?: { replace?: boolean }) =>
      navigate(ROUTES.editorCapture, {
        // In-memory bytes stay out of history: pushState would clone them and the
        // browser process would keep every capture's copy for the window's life.
        state: source.kind === "blob" ? holdCapture(source) : source,
        replace: options?.replace ?? false,
      }),
    [navigate],
  );
```

`screenshot-editor-page.tsx`:

```tsx
export function ScreenshotEditorPage(): React.JSX.Element {
  const location = useLocation();
  const source = sourceFromState(location.state);
  // A capture the holder no longer has (reload, or evicted by newer captures):
  // nothing to show, so go to the Editor home instead of a dead page.
  if (!source) return <Navigate to={ROUTES.editor} replace />;
  return <ScreenshotEditor key={location.key} source={source} />;
}
```

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/renderer/src/features/editor src/renderer/src/features/screenshots/image-source src/renderer/src/pages/editor src/renderer/src/pages/screenshot-editor && bun run check-types` → PASS.

```bash
git add src/renderer/src/features/screenshots/image-source src/renderer/src/features/editor src/renderer/src/pages/screenshot-editor/screenshot-editor-page.tsx src/renderer/src/pages/editor
git commit -m "perf(desktop): captures are held in renderer memory, never cloned into router history"
```

### Task 4: Ship

- [ ] Open a PR titled `perf(desktop): fewer PNG copies from capture to editor (audit SHOT-A3, SHOT-A4, SHOT-A6)` linking this plan and the findings; state the reload/back behaviour change. End with **How to test it yourself** (`bun run dev`):
  1. Hotkey-capture 5 times; main-process memory in Activity Monitor stays flat (before: grew per capture).
  2. After capture 2, press Back → the earlier capture reopens. Reload on `/editor/capture` → lands on the Editor home.
  3. On the Editor home paste a macOS screenshot (opens instantly) and a JPEG (opens after decode).
- [ ] The PR deletes this plan file and removes its row from `plans/audit-2026-10-15/00-index.md`.
