---
title: "34 · Clipboard peek on focus"
description: "Closes SHOT-A5 and VID-A7 (same issue): the Editor home decodes the whole clipboard image in the main process on every window focus, just to show its size."
---

# Clipboard peek on focus — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Focusing the window with a 5K image on the clipboard costs main a 24-byte header read, not a full bitmap decode; focus bursts collapse into one peek.

**Architecture:** The `clipboard:peek-image` handler gates on `clipboard.availableFormats()` (any `image/*`), reads only the compressed PNG with `clipboard.readBuffer("public.png")` and takes the size from its IHDR via the shared `readPngSize` (plan 33); it falls back to `readImage().getSize()` only when an image is present but not as PNG (TIFF-only sources). The renderer's `useClipboardImageSize` gets a 2 s leading+trailing throttle, skips while `document.hidden`, and never overlaps peeks. Rejected: a change-detection cache keyed on `availableFormats()` + `readText()` — neither value changes when one image replaces another, so it would show a stale size; and an optimistic "Paste" card without dimensions (new UI state for no remaining cost). The IPC contract, preload and the explicit paste path are unchanged.

**Tech Stack:** Electron `clipboard`, vitest (fake timers for the hook; the handler itself has no test — covered by the manual step).

**Spec:** [Audit report](/audits/2026-10-15/report/) → SHOT-A5 in [screenshot lens A](/audits/2026-10-15/findings/screenshot-a/), VID-A7 in [video lens A](/audits/2026-10-15/findings/video-a/). Closes: **SHOT-A5, VID-A7**.

## Global Constraints

- Paths are relative to `apps/kaipu-record/src/`. Tests: `node_modules/.bin/vitest run <file>` from `apps/kaipu-record` — never `bunx`.
- Depends on plan 33's `shared/png-size.ts` (`readPngSize`). Land 33 first (or inline the same helper and dedupe later).
- **Unverified on macOS:** `availableFormats()` is expected to return MIME types (`image/png`, `image/tiff`) while `readBuffer` takes the UTI (`public.png`). If the gate is wrong the card disappears silently and Electron-mocked tests cannot catch it. Fallback plan: drop the `some(…)` gate and rely on `readBuffer` length 0 → `readImage()`; the decode is still avoided in the common PNG case. The manual step must confirm the gate.
- The mount peek stays immediate, so the existing Editor home test (`editor-routes.test.tsx:241`) passes unchanged.
- An image copied while the window stays focused is still not refreshed (same as today; only `focus` triggers).
- Commit messages in English, conventional-commit style.

## Review Focus

1. Mount peeks once; a focus after the 2 s gap peeks again — Task 2 test.
2. Three focus events within 500 ms → one trailing peek after the gap — Task 2 test.
3. No peek while `document.hidden` — Task 2 test.
4. Unmount stops listening — Task 2 test.
5. Handler: PNG on the clipboard → size from the header, no `readImage`; TIFF-only → `readImage` fallback; text → `null` — manual steps.

---

### Task 1: Header-based peek in main

**Files:**

- Modify: `main/screenshots/screenshot-ipc.ts:72-75`

- [ ] **Step 1: Implement** (import `readPngSize` from `@shared/png-size`)

```ts
  ipcMain.handle(IPC_CHANNELS.clipboardPeekImage, () => {
    // Cheap first: the format list says whether an image is there at all.
    if (!clipboard.availableFormats().some((f) => f.startsWith("image/"))) return null;
    // Then the size from the PNG header: no decode of a possibly 5K bitmap on the main thread.
    const png = clipboard.readBuffer("public.png");
    const size = png.byteLength > 0 ? readPngSize(png) : null;
    if (size) return size;
    // Image present but not as PNG (e.g. TIFF only): decode, as before.
    const img = clipboard.readImage();
    return img.isEmpty() ? null : img.getSize();
  });
```

`clipboardReadImage` (explicit paste) stays untouched.

- [ ] **Step 2: Type check** — `bun run check-types` → green.

- [ ] **Step 3: Commit**

```bash
git add src/main/screenshots/screenshot-ipc.ts
git commit -m "perf(desktop): clipboard peek reads the PNG header instead of decoding the image"
```

### Task 2: Throttled, visibility-aware peek in the renderer

**Files:**

- Modify: `renderer/src/pages/editor/editor-home-page.tsx:156-178` (`useClipboardImageSize`)
- Test: `renderer/src/pages/editor/editor-routes.test.tsx` (`describe("EditorHomePage")`)

- [ ] **Step 1: Write the failing tests** (`vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })`, `vi.useRealTimers()` in `afterEach`; `setLibrary([])` then `renderAt("/editor")`; `peek = window.electronAPI.peekClipboardImage` is a `vi.fn`)

```tsx
it("peeks on mount and again on focus after the 2 s gap", async () => {
  setLibrary([]);
  renderAt("/editor");
  await waitFor(() => expect(peek).toHaveBeenCalledTimes(1));
  vi.advanceTimersByTime(2100);
  fireEvent(window, new Event("focus"));
  await waitFor(() => expect(peek).toHaveBeenCalledTimes(2));
});

it("collapses a burst of focus events into one trailing peek", async () => {
  setLibrary([]);
  renderAt("/editor");
  await waitFor(() => expect(peek).toHaveBeenCalledTimes(1));
  for (let i = 0; i < 3; i++) {
    vi.advanceTimersByTime(150);
    fireEvent(window, new Event("focus"));
  }
  expect(peek).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(2000);
  await waitFor(() => expect(peek).toHaveBeenCalledTimes(2));
});

it("does not peek while the document is hidden", async () => {
  setLibrary([]);
  renderAt("/editor");
  await waitFor(() => expect(peek).toHaveBeenCalledTimes(1));
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  vi.advanceTimersByTime(2100);
  fireEvent(window, new Event("focus"));
  vi.advanceTimersByTime(2100);
  expect(peek).toHaveBeenCalledTimes(1);
});

it("stops listening on unmount", async () => {
  setLibrary([]);
  const { unmount } = renderAt("/editor"); // adapt if renderAt returns only the router
  await waitFor(() => expect(peek).toHaveBeenCalledTimes(1));
  unmount();
  vi.advanceTimersByTime(2100);
  fireEvent(window, new Event("focus"));
  expect(peek).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run to verify they fail** — `node_modules/.bin/vitest run src/renderer/src/pages/editor/editor-routes.test.tsx` → the burst test sees 4 calls.

- [ ] **Step 3: Implement**

```tsx
/** Do not peek more often than this; focus can fire in bursts (app switching, reveal after capture). */
const CLIPBOARD_PEEK_MIN_GAP_MS = 2000;

/**
 * The clipboard image's size, refreshed whenever the window regains focus (the
 * user copies elsewhere, then comes back). null when it holds no image. Peeks are
 * throttled (leading + trailing), skipped while the document is hidden, and never overlap.
 */
function useClipboardImageSize(): { width: number; height: number } | null {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    let alive = true;
    let inFlight = false;
    let lastAt = -Infinity;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const peek = (): void => {
      if (document.hidden || inFlight) return;
      inFlight = true;
      lastAt = Date.now();
      void window.electronAPI
        .peekClipboardImage()
        .then((s) => alive && setSize(s))
        .catch(() => alive && setSize(null))
        .finally(() => {
          inFlight = false;
        });
    };
    const onFocus = (): void => {
      const wait = CLIPBOARD_PEEK_MIN_GAP_MS - (Date.now() - lastAt);
      if (wait <= 0) return peek();
      // Inside the gap: schedule one trailing peek so the final state is never missed.
      clearTimeout(timer);
      timer = setTimeout(peek, wait);
    };
    peek();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
  return size;
}
```

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/renderer/src/pages/editor && bun run check-types` → PASS.

```bash
git add src/renderer/src/pages/editor/editor-home-page.tsx src/renderer/src/pages/editor/editor-routes.test.tsx
git commit -m "perf(desktop): throttle the Editor home clipboard peek and skip it while hidden"
```

### Task 3: Ship

- [ ] Open a PR titled `perf(desktop): cheap clipboard peek on focus (audit SHOT-A5, VID-A7)` linking this plan and both findings; state the unverified `availableFormats` gate and the fallback. End with **How to test it yourself**:
  1. Editor home → Images tab; copy a 5K/Retina region screenshot (⌘⌃⇧4); switch to another app and back → the card shows the correct "W × H" immediately with no main-process stall (Activity Monitor / main profile).
  2. Copy an image from Preview (TIFF-only) → the card still shows a size (fallback path).
  3. Copy plain text → the card disappears. Switch apps rapidly 5 times → only one peek after the burst (temporary `console.count` in the handler).
- [ ] The PR deletes this plan file and removes its row from `plans/audit-2026-10-15/00-index.md`.
