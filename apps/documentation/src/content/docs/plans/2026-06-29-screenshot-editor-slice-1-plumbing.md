---
title: "Screenshot editor — Slice 1 (plumbing) implementation plan"
description: "Task-by-task plan for the end-to-end screenshot pipeline: capture (Path A) → editor route shows the PNG → Copy/Save to the unified vault → Screenshots page + global hotkey. The foundation the beautify/annotation slices build on."
---

# Screenshot Editor — Slice 1 (Plumbing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the end-to-end screenshot pipeline — capture a region, open it in an editor route, Copy/Save the PNG to the unified library — with a Screenshots page and a global hotkey, but no beautify/annotations yet.

**Architecture:** Main process captures via `screencapture -i` behind a `ScreenshotCaptureProvider` seam, returns a PNG `Buffer` over IPC. The renderer opens `/screenshot-editor` showing the raw PNG with Copy (clipboard) and Save (vault) actions. The existing library vault is extended with a `kind` discriminator so screenshots and recordings share one Library.

**Tech Stack:** Electron (main/preload/renderer), React + react-router-dom (hash router), TypeScript, Vitest. Mac-only capture path.

## Global Constraints

- **Spec:** `apps/documentation/src/content/docs/specs/2026-06-29-screenshot-editor-design.md` is the source of truth.
- **Tokens:** use existing CSS variables in `src/renderer/src/assets/base.css`; never hardcode a hex that duplicates a token. (No new tokens needed in Slice 1 — beautify colors arrive in Slice 2.)
- **Copy:** UI strings in neutral, friendly Spanish (no voseo-formal). Code/comments/docs in English.
- **No enums:** use `as const` arrays + `(typeof x)[number]`, matching `SHORTCUT_ACTIONS`/`IPC_CHANNELS`.
- **IPC discipline:** new channels go in `IPC_CHANNELS` (`src/shared/types/ipc.ts`); a method is only on `KaipuElectronAPI` if it has a live main handler + preload bridge line (TS enforces sync).
- **Capture is mac-only:** guard `screencapture` behind `process.platform === "darwin"`.
- **Commits:** use `--no-verify` (the oxfmt pre-commit hook churns; team policy until the format-config fix lands). End commit messages with the `Co-Authored-By` trailer.
- **Path across IPC:** PNG travels as `ArrayBuffer`/`Buffer`, never a base64 data URL.

---

## File Structure

- **Create**
  - `src/main/screenshots/screenshot-capture.ts` — `ScreenshotCaptureProvider` + `MacNativeProvider` (Path A).
  - `src/main/screenshots/screenshot-capture.test.ts` — provider unit tests (mock `execFile`).
  - `src/main/screenshots/screenshot-ipc.ts` — `registerScreenshotHandlers()` (capture/copy/save).
  - `src/renderer/src/pages/screenshots/screenshots-page.tsx` + `.module.css` — launcher.
  - `src/renderer/src/pages/screenshot-editor/screenshot-editor-page.tsx` + `.module.css` — editor shell.
  - `src/renderer/src/features/screenshots/use-screenshot-capture.ts` — renderer hook (capture → navigate).
- **Modify**
  - `src/shared/types/ipc.ts` — add channels + `captureScreenshot` action + default.
  - `src/shared/types/library-storage.ts` — add `kind` to `LocalRecording`.
  - `src/shared/types/electron-api.ts` — add the three screenshot methods.
  - `src/preload/index.ts` — bridge the three methods.
  - `src/main/library/library-vault.ts` — image (`.png`) support + `kind` in `describe`/`list` + `writeImage`.
  - `src/main/library/index.ts` — `screenshotFilePath(id)` + register screenshot handlers.
  - `src/main/media-protocol.ts` — `kaipu-media://screenshot/<id>` branch.
  - `src/main/shortcuts/global-shortcuts.ts` — `captureScreenshot` in the `status` map.
  - `src/main/index.ts` — wire `registerScreenshotHandlers()` + the `captureScreenshot` handler.
  - `src/renderer/src/app/router.tsx` — `/screenshots` + `/screenshot-editor` routes.
  - `src/renderer/src/shell/sidebar.tsx` — Screenshots `NAV` entry.
  - `src/renderer/src/pages/shortcuts/shortcuts-page.tsx` + `features/shortcuts/use-shortcut-labels.ts` — surface the new action.

---

## Task 1: Shared contract — types, channels, shortcut action

**Files:**
- Modify: `src/shared/types/ipc.ts`
- Modify: `src/shared/types/library-storage.ts`
- Modify: `src/shared/types/electron-api.ts`

**Interfaces:**
- Produces: `IPC_CHANNELS.screenshotCapture = "screenshot:capture"`, `.screenshotCopy = "screenshot:copy"`, `.screenshotSave = "screenshot:save"`; `SHORTCUT_ACTIONS` includes `"captureScreenshot"`; `LocalRecording.kind: "recording" | "screenshot"`; `KaipuElectronAPI` methods `captureScreenshot(): Promise<{ png: ArrayBuffer; width: number; height: number } | null>`, `copyImageToClipboard(png: ArrayBuffer): Promise<void>`, `saveScreenshot(png: ArrayBuffer, meta: { title: string }): Promise<LocalRecording>`.

- [ ] **Step 1: Add the screenshot channels.** In `src/shared/types/ipc.ts`, inside `IPC_CHANNELS` (after the library block, before `recordingCreate`):

```ts
  // Screenshots (renderer ↔ main)
  screenshotCapture: "screenshot:capture",
  screenshotCopy: "screenshot:copy",
  screenshotSave: "screenshot:save",
```

- [ ] **Step 2: Add the shortcut action + default.** In the same file, extend the action list and defaults:

```ts
export const SHORTCUT_ACTIONS = [
  "startRecording",
  "stopRecording",
  "bringToFront",
  "captureScreenshot",
] as const;
```

```ts
export const DEFAULT_SHORTCUTS: ShortcutSettings = {
  startRecording: "Command+Control+C",
  stopRecording: "Command+Control+S",
  bringToFront: "Command+Control+O",
  captureScreenshot: "Command+Control+4", // ⌘⌃4 — mnemonic of macOS Cmd+Shift+4
};
```

- [ ] **Step 3: Add `kind` to the stored item.** In `src/shared/types/library-storage.ts`:

```ts
export interface LocalRecording {
  id: string;
  /** Discriminates a video recording from a screenshot in the unified vault. */
  kind: "recording" | "screenshot";
  title: string;
  filePath: string;
  createdAt: number;
  sizeBytes: number;
  durationSeconds: number;
  thumbnailUrl?: string | null;
}
```

- [ ] **Step 4: Add the API methods.** In `src/shared/types/electron-api.ts`, add to the `KaipuElectronAPI` interface:

```ts
  /** Run the interactive region capture; resolves null if the user cancelled. */
  captureScreenshot(): Promise<{ png: ArrayBuffer; width: number; height: number } | null>;
  /** Put a PNG on the system clipboard. */
  copyImageToClipboard(png: ArrayBuffer): Promise<void>;
  /** Write a PNG into the vault and return the stored item. */
  saveScreenshot(png: ArrayBuffer, meta: { title: string }): Promise<LocalRecording>;
```

(Ensure `LocalRecording` is imported in that file; follow the existing import style.)

- [ ] **Step 5: Verify the contract compiles.**

Run: `cd apps/kaipu-record && npm run typecheck`
Expected: PASS (the new methods aren't bridged/handled yet — that's Tasks 4–5; if `typecheck` flags an unimplemented interface member it's only enforced where the object literal is built, i.e. in preload/handlers, which we complete before wiring). If it errors on `LocalRecording.kind` missing in the vault, that's expected and fixed in Task 3.

- [ ] **Step 6: Commit.**

```bash
git add src/shared/types/ipc.ts src/shared/types/library-storage.ts src/shared/types/electron-api.ts
git commit --no-verify -m "feat(screenshots): add shared IPC/shortcut/storage contract

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Capture provider (Path A)

**Files:**
- Create: `src/main/screenshots/screenshot-capture.ts`
- Test: `src/main/screenshots/screenshot-capture.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface ScreenshotCaptureProvider { captureInteractive(): Promise<Buffer | null> }`; `createScreenshotProvider(): ScreenshotCaptureProvider` (returns `MacNativeProvider`). The PNG is read from a temp file written by `screencapture -i -o`. A user cancel (`Esc`) leaves no file → resolves `null`.

- [ ] **Step 1: Write the failing test.** `src/main/screenshots/screenshot-capture.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We inject the deps so the provider is testable without spawning `screencapture`.
import { MacNativeProvider } from "./screenshot-capture";

describe("MacNativeProvider", () => {
  let runCli: ReturnType<typeof vi.fn>;
  let readPng: ReturnType<typeof vi.fn>;
  let fileExists: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    runCli = vi.fn(async () => {});
    readPng = vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG magic
    fileExists = vi.fn(async () => true);
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns the captured PNG buffer", async () => {
    const provider = new MacNativeProvider({ runCli, readPng, fileExists, tempPath: () => "/tmp/x.png" });
    const out = await provider.captureInteractive();
    expect(runCli).toHaveBeenCalledWith("screencapture", ["-i", "-o", "/tmp/x.png"]);
    expect(out).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it("returns null when the user cancels (no file written)", async () => {
    fileExists = vi.fn(async () => false);
    const provider = new MacNativeProvider({ runCli, readPng, fileExists, tempPath: () => "/tmp/x.png" });
    expect(await provider.captureInteractive()).toBeNull();
    expect(readPng).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it — verify it fails.**

Run: `cd apps/kaipu-record && npx vitest run src/main/screenshots/screenshot-capture.test.ts`
Expected: FAIL — `Cannot find module './screenshot-capture'`.

- [ ] **Step 3: Implement the provider.** `src/main/screenshots/screenshot-capture.ts`:

```ts
import { execFile } from "node:child_process";
import { access, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ScreenshotCaptureProvider {
  /** Interactive region capture; resolves the PNG, or null if cancelled. */
  captureInteractive(): Promise<Buffer | null>;
}

interface Deps {
  runCli(cmd: string, args: string[]): Promise<void>;
  readPng(path: string): Promise<Buffer>;
  fileExists(path: string): Promise<boolean>;
  tempPath(): string;
}

const realDeps: Deps = {
  runCli: async (cmd, args) => { await execFileAsync(cmd, args); },
  readPng: (path) => readFile(path),
  fileExists: async (path) => { try { await access(path); return true; } catch { return false; } },
  // Note: no Date.now()/Math.random() in plan code is fine here — this is runtime, not a workflow.
  tempPath: () => join(tmpdir(), `kaipu-shot-${process.hrtime.bigint()}.png`),
};

/** macOS Path A: `screencapture -i -o` interactive region select to a temp PNG. */
export class MacNativeProvider implements ScreenshotCaptureProvider {
  constructor(private readonly deps: Deps = realDeps) {}

  async captureInteractive(): Promise<Buffer | null> {
    const target = this.deps.tempPath();
    await this.deps.runCli("screencapture", ["-i", "-o", target]);
    if (!(await this.deps.fileExists(target))) return null; // user pressed Esc
    const png = await this.deps.readPng(target);
    await rm(target, { force: true }).catch(() => {});
    return png;
  }
}

export function createScreenshotProvider(): ScreenshotCaptureProvider {
  return new MacNativeProvider();
}
```

- [ ] **Step 4: Run the tests — verify they pass.**

Run: `cd apps/kaipu-record && npx vitest run src/main/screenshots/screenshot-capture.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit.**

```bash
git add src/main/screenshots/screenshot-capture.ts src/main/screenshots/screenshot-capture.test.ts
git commit --no-verify -m "feat(screenshots): Path A capture provider (screencapture -i)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Vault — image support + `kind`

**Files:**
- Modify: `src/main/library/library-vault.ts`
- Test: `src/main/library/library-vault.test.ts` (extend the existing suite)

**Interfaces:**
- Consumes: `LocalRecording.kind` (Task 1).
- Produces: `LibraryVault.writeImage(id: string, png: Buffer): Promise<void>` (writes `<id>.png`); `list()`/`describe()` now also surface `.png` items with `kind: "screenshot"`; recordings get `kind: "recording"`. Screenshot thumbnail URL = `kaipu-media://screenshot/<id>` (the PNG itself).

- [ ] **Step 1: Write the failing test.** Add to `src/main/library/library-vault.test.ts`:

```ts
it("lists a saved screenshot as kind=screenshot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vault-"));        // reuse existing helpers/imports
  const vault = new LibraryVault(dir);
  await vault.writeImage("shot-1", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const items = await vault.list();
  const shot = items.find((i) => i.id === "shot-1");
  expect(shot?.kind).toBe("screenshot");
  expect(shot?.filePath.endsWith("shot-1.png")).toBe(true);
  expect(shot?.thumbnailUrl).toBe("kaipu-media://screenshot/shot-1");
});
```

(If the existing test file lacks `mkdtemp`/`tmpdir` imports, add them to the top — match the file's style.)

- [ ] **Step 2: Run it — verify it fails.**

Run: `cd apps/kaipu-record && npx vitest run src/main/library/library-vault.test.ts`
Expected: FAIL — `vault.writeImage is not a function`.

- [ ] **Step 3: Implement the vault changes.** In `src/main/library/library-vault.ts`:

Add the image ext set near `VIDEO_EXTS`:

```ts
const IMAGE_EXTS = [".png"] as const;
const ALL_EXTS = [...VIDEO_EXTS, ...IMAGE_EXTS] as const;
```

Update `filePath` to scan all exts (keep `.mp4` as the recording default):

```ts
async filePath(id: string): Promise<string> {
  for (const ext of ALL_EXTS) {
    const candidate = join(this.directory, `${id}${ext}`);
    if (await exists(candidate)) return candidate;
  }
  return join(this.directory, `${id}${VIDEO_EXTS[0]}`);
}
```

Update `list()` to include image files:

```ts
const ids = entries
  .filter((f) => ALL_EXTS.some((ext) => f.endsWith(ext)))
  .map((f) => basename(f, ALL_EXTS.find((ext) => f.endsWith(ext))!));
```

Update `describe()` to set `kind` + the right thumbnail:

```ts
async describe(id: string): Promise<LocalRecording | null> {
  const filePath = await this.filePath(id);
  let info;
  try { info = await stat(filePath); } catch { return null; }
  const isImage = IMAGE_EXTS.some((ext) => filePath.endsWith(ext));
  const meta = await this.readSidecar(id);
  return {
    id,
    kind: isImage ? "screenshot" : "recording",
    title: meta.title ?? humanizeId(id),
    filePath,
    createdAt: meta.createdAt ?? info.birthtimeMs,
    sizeBytes: info.size,
    durationSeconds: meta.durationSeconds ?? 0,
    thumbnailUrl: isImage
      ? `kaipu-media://screenshot/${id}`
      : (await exists(this.thumbnailPath(id))) ? `kaipu-media://thumb/${id}` : null,
  };
}
```

Add the writer (near `writeThumbnail`):

```ts
/** Writes a screenshot PNG as `<id>.png` in the vault root. */
async writeImage(id: string, png: Buffer): Promise<void> {
  await mkdir(this.directory, { recursive: true });
  await writeFile(join(this.directory, `${id}.png`), png);
}
```

`remove()` needs **no change**: it already deletes `await this.filePath(id)`, which now resolves `.png` for screenshots. Confirm this by reading the method; do not add a duplicate `rm`.

- [ ] **Step 4: Run the tests — verify they pass.**

Run: `cd apps/kaipu-record && npx vitest run src/main/library/library-vault.test.ts`
Expected: PASS (existing recording tests + the new screenshot test).

- [ ] **Step 5: Commit.**

```bash
git add src/main/library/library-vault.ts src/main/library/library-vault.test.ts
git commit --no-verify -m "feat(screenshots): vault stores PNGs with kind=screenshot

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Main — IPC handlers + media protocol + wiring

**Files:**
- Create: `src/main/screenshots/screenshot-ipc.ts`
- Modify: `src/main/library/index.ts`
- Modify: `src/main/media-protocol.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: `createScreenshotProvider` (Task 2), `currentVault()` + `writeImage` (Task 3), `IPC_CHANNELS.screenshot*` (Task 1).
- Produces: `registerScreenshotHandlers()`; a `screenshotFilePath(id)` resolver; the `kaipu-media://screenshot/<id>` route; a `triggerCaptureScreenshot()` main-side function used by the hotkey (Task 8).

- [ ] **Step 1: Add the resolver.** In `src/main/library/index.ts`, mirror `thumbnailFilePath`:

```ts
export async function screenshotFilePath(id: string): Promise<string> {
  return currentVault().filePath(id); // resolves <id>.png
}
```

- [ ] **Step 2: Add the media-protocol branch.** In `src/main/media-protocol.ts`, in the `protocol.handle` switch on `hostname`, add a `screenshot` case mirroring `recording` (no range needed):

```ts
if (hostname === "screenshot") {
  const target = await screenshotFilePath(id);
  return net.fetch(pathToFileURL(target).toString());
}
```

(Import `screenshotFilePath` from `./library` alongside the existing resolvers; keep the `isUnsafeId(id)` guard.)

- [ ] **Step 3: Write the handlers.** `src/main/screenshots/screenshot-ipc.ts`:

```ts
import { clipboard, ipcMain, nativeImage } from "electron";
import { IPC_CHANNELS } from "@shared/types/ipc";
import type { LocalRecording } from "@shared/types/library-storage";
import { createScreenshotProvider } from "./screenshot-capture";
import { currentVault } from "../library";

const provider = createScreenshotProvider();

/** Stable, sortable id; mirrors the recording writer's timestamp scheme. */
function screenshotId(): string {
  return `screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

export function registerScreenshotHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.screenshotCapture, async () => {
    const png = await provider.captureInteractive();
    if (!png) return null;
    const img = nativeImage.createFromBuffer(png);
    const { width, height } = img.getSize();
    // Buffer → ArrayBuffer slice for structured-clone across IPC.
    return { png: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength), width, height };
  });

  ipcMain.handle(IPC_CHANNELS.screenshotCopy, async (_e, png: ArrayBuffer) => {
    clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(png)));
  });

  ipcMain.handle(
    IPC_CHANNELS.screenshotSave,
    async (_e, png: ArrayBuffer, meta: { title: string }): Promise<LocalRecording> => {
      const id = screenshotId();
      const vault = currentVault();
      await vault.writeImage(id, Buffer.from(png));
      await vault.writeMeta(id, { title: meta.title, createdAt: Date.now() });
      return (await vault.describe(id))!;
    },
  );
}
```

- [ ] **Step 4: Wire it at startup.** In `src/main/index.ts`, inside `app.whenReady()` near `registerLibraryVaultHandlers()`:

```ts
registerScreenshotHandlers();
```

(Import it from `./screenshots/screenshot-ipc`.)

- [ ] **Step 5: Verify the build.**

Run: `cd apps/kaipu-record && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/main/screenshots/screenshot-ipc.ts src/main/library/index.ts src/main/media-protocol.ts src/main/index.ts
git commit --no-verify -m "feat(screenshots): capture/copy/save IPC + media protocol branch

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Preload bridge

**Files:**
- Modify: `src/preload/index.ts`

**Interfaces:**
- Consumes: `IPC_CHANNELS.screenshot*`, the `KaipuElectronAPI` methods (Task 1).
- Produces: `window.electronAPI.captureScreenshot/copyImageToClipboard/saveScreenshot`.

- [ ] **Step 1: Add the bridge lines.** In the `kaipuApi` object in `src/preload/index.ts`:

```ts
  captureScreenshot: () => ipcRenderer.invoke(IPC_CHANNELS.screenshotCapture),
  copyImageToClipboard: (png) => ipcRenderer.invoke(IPC_CHANNELS.screenshotCopy, png),
  saveScreenshot: (png, meta) => ipcRenderer.invoke(IPC_CHANNELS.screenshotSave, png, meta),
```

- [ ] **Step 2: Verify the contract is satisfied.**

Run: `cd apps/kaipu-record && npm run typecheck`
Expected: PASS — `kaipuApi` now fully implements `KaipuElectronAPI`.

- [ ] **Step 3: Commit.**

```bash
git add src/preload/index.ts
git commit --no-verify -m "feat(screenshots): bridge capture/copy/save to the renderer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Renderer — Screenshots launcher page + route + nav

**Files:**
- Create: `src/renderer/src/pages/screenshots/screenshots-page.tsx` (+ `.module.css`)
- Create: `src/renderer/src/features/screenshots/use-screenshot-capture.ts`
- Modify: `src/renderer/src/app/router.tsx`
- Modify: `src/renderer/src/shell/sidebar.tsx`

**Interfaces:**
- Consumes: `window.electronAPI.captureScreenshot`.
- Produces: route `/screenshots`; `useScreenshotCapture()` returning `{ capture: () => Promise<void> }` that captures and navigates to `/screenshot-editor` with the PNG in router state.

- [ ] **Step 1: Write the capture hook.** `src/renderer/src/features/screenshots/use-screenshot-capture.ts`:

```ts
import { useNavigate } from "react-router-dom";

export function useScreenshotCapture(): { capture: () => Promise<void> } {
  const navigate = useNavigate();
  return {
    capture: async () => {
      const shot = await window.electronAPI.captureScreenshot();
      if (!shot) return; // cancelled
      navigate("/screenshot-editor", { state: shot });
    },
  };
}
```

- [ ] **Step 2: Write the launcher page.** `src/renderer/src/pages/screenshots/screenshots-page.tsx` (copy in friendly Spanish; match an existing page's chrome — read `library-page.tsx` for the page wrapper pattern). Minimum content:

```tsx
import { Camera } from "lucide-react";
import { useScreenshotCapture } from "@renderer/features/screenshots/use-screenshot-capture";
import styles from "./screenshots-page.module.css";

export function ScreenshotsPage(): JSX.Element {
  const { capture } = useScreenshotCapture();
  return (
    <div className={styles.page}>
      <p className={styles.overline}>CAPTURAS</p>
      <h1 className={styles.title}>Capturá y documentá</h1>
      <p className={styles.subtitle}>
        Tomá una captura, marcá lo importante con cajas, flechas y texto, y compartila. Todo local, sin cuentas.
      </p>
      <div className={styles.card}>
        <button className={styles.capture} onClick={() => void capture()}>
          <Camera size={18} /> Capturar pantalla
        </button>
        <p className={styles.hint}>Seleccioná un área de la pantalla para empezar.</p>
        <span className={styles.shortcut}>Atajo global ⌘⌃4</span>
      </div>
    </div>
  );
}
```

(Styles: use the token CSS variables — `--bg-card`, `--border`, `--accent-primary`, `--text-*`, `--radius-lg`, `--space-*`. No hardcoded hex.)

- [ ] **Step 3: Register the route.** In `src/renderer/src/app/router.tsx`, add as children of `<AppShell />`:

```tsx
{ path: "/screenshots", element: <ScreenshotsPage /> },
```

- [ ] **Step 4: Add the sidebar entry.** In `src/renderer/src/shell/sidebar.tsx`, add to `NAV`:

```tsx
{ to: "/screenshots", label: "Capturas", Icon: Camera },
```

(Import `Camera` from `lucide-react`.)

- [ ] **Step 5: Verify.**

Run: `cd apps/kaipu-record && npm run typecheck && npm run lint`
Expected: PASS. (Manual: the route renders later, once the editor exists — Task 7.)

- [ ] **Step 6: Commit.**

```bash
git add src/renderer/src/pages/screenshots src/renderer/src/features/screenshots src/renderer/src/app/router.tsx src/renderer/src/shell/sidebar.tsx
git commit --no-verify -m "feat(screenshots): launcher page + route + sidebar entry

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Renderer — editor route shell (show PNG + Copy/Save)

**Files:**
- Create: `src/renderer/src/pages/screenshot-editor/screenshot-editor-page.tsx` (+ `.module.css`)
- Modify: `src/renderer/src/app/router.tsx`

**Interfaces:**
- Consumes: router `state` `{ png: ArrayBuffer; width; height }`; `window.electronAPI.copyImageToClipboard/saveScreenshot`.
- Produces: route `/screenshot-editor`. (Slices 2–3 replace the body with the beautify/annotation canvas; the Copy/Save wiring stays.)

- [ ] **Step 1: Write the editor shell.** `src/renderer/src/pages/screenshot-editor/screenshot-editor-page.tsx`:

```tsx
import { useLocation, useNavigate } from "react-router-dom";
import { useMemo, useState } from "react";
import styles from "./screenshot-editor-page.module.css";

interface ShotState { png: ArrayBuffer; width: number; height: number }

export function ScreenshotEditorPage(): JSX.Element {
  const navigate = useNavigate();
  const shot = useLocation().state as ShotState | null;
  const [saved, setSaved] = useState(false);

  const url = useMemo(
    () => (shot ? URL.createObjectURL(new Blob([shot.png], { type: "image/png" })) : null),
    [shot],
  );
  if (!shot || !url) {
    navigate("/screenshots");
    return <></>;
  }

  return (
    <div className={styles.editor}>
      <div className={styles.toolbar}>
        <span className={styles.title}>EDITANDO CAPTURA</span>
        <div className={styles.actions}>
          <button onClick={() => void window.electronAPI.copyImageToClipboard(shot.png)}>Copiar</button>
          <button
            className={styles.save}
            onClick={async () => {
              await window.electronAPI.saveScreenshot(shot.png, { title: "Captura" });
              setSaved(true);
            }}
          >
            {saved ? "Guardado" : "Guardar"}
          </button>
        </div>
      </div>
      <div className={styles.canvas}>
        <img src={url} alt="Captura" className={styles.shot} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Register the route.** In `src/renderer/src/app/router.tsx`:

```tsx
{ path: "/screenshot-editor", element: <ScreenshotEditorPage /> },
```

- [ ] **Step 3: Verify the build.**

Run: `cd apps/kaipu-record && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 4: Manual end-to-end check.**

Run: `cd apps/kaipu-record && npm run dev`
Steps: open the app → Capturas → "Capturar pantalla" → drag a region → the editor shows the PNG → "Copiar" (paste elsewhere to confirm) → "Guardar" → confirm a `<id>.png` lands in the vault folder and appears in the Library list.
Expected: all steps work; cancelling the capture (Esc) returns to the page with no editor.

- [ ] **Step 5: Commit.**

```bash
git add src/renderer/src/pages/screenshot-editor src/renderer/src/app/router.tsx
git commit --no-verify -m "feat(screenshots): editor shell shows the PNG with Copy/Save

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Global hotkey `captureScreenshot`

**Files:**
- Modify: `src/main/shortcuts/global-shortcuts.ts`
- Modify: `src/main/index.ts`
- Modify: `src/renderer/src/pages/shortcuts/shortcuts-page.tsx`
- Modify: `src/renderer/src/features/shortcuts/use-shortcut-labels.ts`

**Interfaces:**
- Consumes: `SHORTCUT_ACTIONS` now includes `captureScreenshot` (Task 1).
- Produces: pressing `⌘⌃4` captures and opens the editor; the action is listed + rebindable on the Shortcuts page.

- [ ] **Step 1: Add the action to the status map.** In `src/main/shortcuts/global-shortcuts.ts`, the `status` object hardcodes the action keys — add `captureScreenshot: false` alongside the others.

- [ ] **Step 2: Add the handler.** In `src/main/index.ts`, in the `handlers` object passed to `registerGlobalShortcuts({...})`, add:

```ts
captureScreenshot: triggerCaptureScreenshot,
```

And define `triggerCaptureScreenshot` near the other triggers — it must capture and tell the main window to open the editor. Simplest: bring the main window to front and send it an event the renderer listens for, OR (matching this slice) invoke the same capture flow by focusing the window and letting the renderer's `useScreenshotCapture` run. Minimal main-side version:

```ts
import { createScreenshotProvider } from "./screenshots/screenshot-capture";
// reuse the provider singleton via a small exported helper from screenshot-ipc, OR:
async function triggerCaptureScreenshot(): Promise<void> {
  // Focus the main window, then ask the renderer to run capture (it owns navigation).
  bringAppToFront();
  mainWindow?.webContents.send("screenshot:hotkey");
}
```

Add the matching broadcast channel `screenshotHotkey: "screenshot:hotkey"` to `IPC_CHANNELS` and a preload subscription `onCaptureScreenshotHotkey(cb)` (mirror `onUpdateStatus`); have the Screenshots/AppShell renderer subscribe and call `capture()`. *(If the team prefers the capture to run fully main-side, that's a valid alternative — but navigation lives in the renderer, so the broadcast keeps the flow in one place.)*

- [ ] **Step 3: Surface it on the Shortcuts page.** In `shortcuts-page.tsx`, add a row to the appropriate array (`APP_SHORTCUTS`):

```ts
{ action: "captureScreenshot", label: "Capturar pantalla", description: "Abre la selección de área para una captura." },
```

And in `features/shortcuts/use-shortcut-labels.ts`, add the explicit label line for `captureScreenshot` (mirror the existing per-action entries).

- [ ] **Step 4: Verify + manual check.**

Run: `cd apps/kaipu-record && npm run typecheck && npm run lint`
Then `npm run dev`: press `⌘⌃4` anywhere → the region selector appears → the editor opens. Confirm the binding shows on the Shortcuts page and is rebindable.
Expected: PASS + working hotkey.

- [ ] **Step 5: Commit.**

```bash
git add src/main/shortcuts/global-shortcuts.ts src/main/index.ts src/shared/types/ipc.ts src/preload/index.ts src/renderer/src/pages/shortcuts/shortcuts-page.tsx src/renderer/src/features/shortcuts/use-shortcut-labels.ts
git commit --no-verify -m "feat(screenshots): global capture hotkey (⌘⌃4)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Done criteria (Slice 1)

- Capturas page captures a region and opens the editor with the PNG.
- Copy puts the PNG on the clipboard; Save writes `<id>.png` into the vault and it appears in the Library as `kind: "screenshot"`.
- `⌘⌃4` triggers the same flow globally and is rebindable.
- `npm run typecheck`, `npm run lint`, and `npx vitest run` all pass.

## Next slices (separate plans, after Slice 1 validates)

- **Slice 2 — Beautify:** background swatches + padding/corners/shadow + framed export composite (new feature tokens per §7 of the spec).
- **Slice 3 — Annotations:** rough helper + Caveat + box/arrow/text + select/move/resize/delete + undo/redo; export rasterizes them.
- **Slice 4 — Library:** type filter (All / Videos / Screenshots) + screenshot item rendering/opening.
