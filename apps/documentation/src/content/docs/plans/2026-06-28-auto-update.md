---
title: Auto-update + landing — implementation plan
description: Task-by-task plan to wire macOS electron-updater against a Cloudflare R2 feed (silent download + restart banner), publish artifacts to R2 from CI, and build a dark product landing with download CTAs on web-hono.
---

# Auto-update + Landing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Installed macOS builds update themselves (silent download + "restart" banner) from a public Cloudflare R2 feed, CI publishes the feed + installers to R2, and a dark product landing on `web-hono` offers per-arch download CTAs.

**Architecture:** Part A (desktop) — a main-process `electron-updater` module emits status over IPC; a renderer hook + banner show "restart to apply"; `electron-builder.yml` points at the R2 feed; a CI step uploads artifacts to R2. Part B (web) — replace the template home with a Tailwind dark landing whose CTAs link to stable R2 DMG URLs.

**Tech Stack:** Electron, `electron-updater`, React + Vitest (desktop renderer), TanStack Router + React 19 + Tailwind + `@kaipu/web-ui` (web), GitHub Actions + AWS CLI (R2 upload).

**Spec:** `/specs/2026-06-28-auto-update-design`

**Conventions:**
- Code/comments English; end-user copy neutral Spanish (emoji ok).
- No TS enums — `as const` + derived types.
- Desktop: commit with `git commit --no-verify` (oxfmt churn hold); tests from `apps/kaipu-record` via `bunx vitest run <path>`.
- web-hono has **no test framework** — verify web tasks with `bun run typecheck` + `bun run build` (do not add a test runner).

---

## File Structure

**Part A — desktop (`apps/kaipu-record/`):**
- **Modify** `src/shared/types/ipc.ts` — 3 update channels + `UpdateStatus` type + `ElectronAPI` methods.
- **Create** `src/main/updater/auto-updater.ts` — `initAutoUpdater`, `installDownloadedUpdate`.
- **Modify** `src/main/index.ts` — wire `initAutoUpdater` + the 3 IPC handlers.
- **Modify** `src/preload/index.ts` — expose `getUpdateStatus`, `onUpdateStatus`, `installUpdate`.
- **Modify** `src/renderer/src/test/setup.ts` — stub the 3 methods.
- **Create** `src/renderer/src/features/updater/use-update-status.ts` (+ test).
- **Create** `src/renderer/src/features/updater/update-banner.tsx` (+ `.module.css` + test).
- **Create** `src/renderer/src/features/updater/index.ts` — barrel.
- **Modify** `src/renderer/src/shell/app-shell.tsx` — mount the update banner.
- **Modify** `electron-builder.yml` — `publish.url`.
- **Modify** `.github/workflows/release-desktop.yml` — R2 upload step.

**Part B — web (`apps/web-hono/`):**
- **Create** `src/lib/download.ts` — resolve the per-arch DMG URLs from env.
- **Create** `src/vite-env.d.ts` (if absent) — type `VITE_PUBLIC_DOWNLOAD_URL`.
- **Create** `src/components/landing/download-buttons.tsx`.
- **Create** `src/components/landing/hero.tsx`, `features.tsx`, `download-section.tsx`, `footer.tsx`, `landing-nav.tsx`.
- **Modify** `src/routes/index.tsx` — render the landing.
- **Modify** `src/routes/__root.tsx` — hide the template `Header` on `/`; set the page title.
- **Modify** `.env.example` (web-hono).

---

## Part A — macOS auto-update

### Task A1: IPC channels + UpdateStatus type

**Files:**
- Modify: `src/shared/types/ipc.ts`
- Modify: `src/shared/types/electron-api.ts`

- [ ] **Step 1: Add channels + type**

In `src/shared/types/ipc.ts`, add to `IPC_CHANNELS` (after `getAppVersion`):

```ts
  updateGetStatus: "update:get-status",
  updateStatus: "update:status",
  updateInstall: "update:install",
```

And add the status type (near `RecordingStatus`):

```ts
/** Auto-update state surfaced to the renderer. `ready` = a build is downloaded and installable. */
export type UpdateStatus = { state: "idle" } | { state: "ready"; version: string };
```

- [ ] **Step 2: Add API methods**

In `src/shared/types/electron-api.ts`, import `UpdateStatus` from `./ipc` (extend the existing import) and add to `KaipuElectronAPI` (after `getAppVersion`):

```ts
  /** Current auto-update status (for UI that mounts after the event fired). */
  getUpdateStatus(): Promise<UpdateStatus>;
  /** Subscribe to auto-update status changes. Returns an unsubscribe fn. */
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
  /** Quit and install a downloaded update (the "Reiniciar" button). */
  installUpdate(): void;
```

- [ ] **Step 3: Typecheck + commit**

Run: `bunx tsc --noEmit -p tsconfig.web.json` and `-p tsconfig.node.json` — expected: no errors.

```bash
git add src/shared/types/ipc.ts src/shared/types/electron-api.ts
git commit --no-verify -m "feat(updater): IPC channels + UpdateStatus type"
```

---

### Task A2: main updater module

**Files:**
- Create: `src/main/updater/auto-updater.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: Write the updater module**

```ts
// src/main/updater/auto-updater.ts
import { app, type BrowserWindow } from "electron";
import electronUpdater from "electron-updater";
import { IPC_CHANNELS, type UpdateStatus } from "@shared/types";

const { autoUpdater } = electronUpdater;

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6h while running

let status: UpdateStatus = { state: "idle" };

/** The last known status, for renderers that mount after `update-downloaded`. */
export function getUpdateStatus(): UpdateStatus {
  return status;
}

/** Quit and install a downloaded update (called from the renderer "Reiniciar" button). */
export function installDownloadedUpdate(): void {
  if (status.state === "ready") autoUpdater.quitAndInstall();
}

/**
 * Wire electron-updater. No-op in dev (electron-updater needs a packaged
 * app-update.yml). Silent background download; the renderer shows a "restart"
 * banner once `update-downloaded` fires. Fail-safe: errors are logged, never thrown.
 */
export function initAutoUpdater(getMainWindow: () => BrowserWindow | null): void {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-downloaded", (info) => {
    status = { state: "ready", version: info.version };
    getMainWindow()?.webContents.send(IPC_CHANNELS.updateStatus, status);
  });
  autoUpdater.on("error", (err) => {
    console.error("[auto-updater] error", err);
  });

  void autoUpdater.checkForUpdates().catch((err) => console.error("[auto-updater] check failed", err));
  setInterval(() => {
    void autoUpdater.checkForUpdates().catch((err) => console.error("[auto-updater] check failed", err));
  }, CHECK_INTERVAL_MS);
}
```

(`electron-updater` is CommonJS; import the default and destructure `autoUpdater` — the named export is unreliable under electron-vite's ESM.)

- [ ] **Step 2: Wire it in main**

In `src/main/index.ts`, add the imports near the other feature imports:

```ts
import { initAutoUpdater, getUpdateStatus, installDownloadedUpdate } from "./updater/auto-updater";
```

Inside `app.whenReady().then(() => { … })`, after `registerLibraryVaultHandlers();` (or alongside the other `register*` calls), add:

```ts
  // Auto-update (packaged builds only). Silent download; renderer shows a restart banner.
  initAutoUpdater(() => mainWindow);
  ipcMain.handle(IPC_CHANNELS.updateGetStatus, () => getUpdateStatus());
  ipcMain.on(IPC_CHANNELS.updateInstall, () => installDownloadedUpdate());
```

- [ ] **Step 3: Typecheck + commit**

Run: `bunx tsc --noEmit -p tsconfig.node.json` — expected: no errors.

```bash
git add src/main/updater/auto-updater.ts src/main/index.ts
git commit --no-verify -m "feat(updater): electron-updater main module (silent download, 6h checks)"
```

---

### Task A3: preload + test stub

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/test/setup.ts`

- [ ] **Step 1: Expose in preload**

In `src/preload/index.ts`, add to the `kaipuApi` object (after `getAppVersion`):

```ts
  getUpdateStatus: () => ipcRenderer.invoke(IPC_CHANNELS.updateGetStatus),
  onUpdateStatus: (callback) => {
    const handler = (_e: unknown, status: Parameters<typeof callback>[0]): void => callback(status);
    ipcRenderer.on(IPC_CHANNELS.updateStatus, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.updateStatus, handler);
  },
  installUpdate: () => ipcRenderer.send(IPC_CHANNELS.updateInstall),
```

- [ ] **Step 2: Add to the renderer test stub**

In `src/renderer/src/test/setup.ts`, add to the `window.electronAPI` stub (after `getAppVersion`):

```ts
  getUpdateStatus: async () => ({ state: "idle" }),
  onUpdateStatus: () => () => {},
  installUpdate: () => {},
```

- [ ] **Step 3: Typecheck + commit**

Run: `bunx tsc --noEmit -p tsconfig.web.json` — expected: no errors.

```bash
git add src/preload/index.ts src/renderer/src/test/setup.ts
git commit --no-verify -m "feat(updater): preload bridge + test stub"
```

---

### Task A4: `useUpdateStatus` hook

**Files:**
- Create: `src/renderer/src/features/updater/use-update-status.ts`
- Test: `src/renderer/src/features/updater/use-update-status.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// use-update-status.test.tsx
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useUpdateStatus } from "./use-update-status";
import type { UpdateStatus } from "@shared/types";

describe("useUpdateStatus", () => {
  it("seeds from getUpdateStatus on mount", async () => {
    window.electronAPI.getUpdateStatus = async () => ({ state: "ready", version: "1.2.0" });
    const { result } = renderHook(() => useUpdateStatus());
    await waitFor(() => expect(result.current).toEqual({ state: "ready", version: "1.2.0" }));
  });

  it("updates when an onUpdateStatus event fires", async () => {
    let emit: ((s: UpdateStatus) => void) | null = null;
    window.electronAPI.getUpdateStatus = async () => ({ state: "idle" });
    window.electronAPI.onUpdateStatus = (cb) => {
      emit = cb;
      return () => {};
    };
    const { result } = renderHook(() => useUpdateStatus());
    await waitFor(() => expect(result.current).toEqual({ state: "idle" }));
    act(() => emit?.({ state: "ready", version: "2.0.0" }));
    expect(result.current).toEqual({ state: "ready", version: "2.0.0" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/renderer/src/features/updater/use-update-status.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// use-update-status.ts
import { useEffect, useState } from "react";
import type { UpdateStatus } from "@shared/types";

/** Track auto-update status: seeds from the main process, then live-updates on events. */
export function useUpdateStatus(): UpdateStatus {
  const [status, setStatus] = useState<UpdateStatus>({ state: "idle" });
  useEffect(() => {
    let active = true;
    void window.electronAPI.getUpdateStatus().then((s) => {
      if (active) setStatus(s);
    });
    const unsubscribe = window.electronAPI.onUpdateStatus(setStatus);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return status;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/renderer/src/features/updater/use-update-status.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/features/updater/use-update-status.ts src/renderer/src/features/updater/use-update-status.test.tsx
git commit --no-verify -m "feat(updater): useUpdateStatus hook"
```

---

### Task A5: `UpdateBanner` + mount in AppShell

**Files:**
- Create: `src/renderer/src/features/updater/update-banner.tsx` + `.module.css`
- Create: `src/renderer/src/features/updater/index.ts`
- Test: `src/renderer/src/features/updater/update-banner.test.tsx`
- Modify: `src/renderer/src/shell/app-shell.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// update-banner.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UpdateBanner } from "./update-banner";

describe("UpdateBanner", () => {
  it("renders the version and installs on click", () => {
    const install = vi.fn();
    window.electronAPI.installUpdate = install;
    render(<UpdateBanner version="2.0.0" />);
    expect(screen.getByText(/2\.0\.0/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /reiniciar/i }));
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("can be dismissed", () => {
    render(<UpdateBanner version="2.0.0" />);
    fireEvent.click(screen.getByRole("button", { name: /cerrar/i }));
    expect(screen.queryByText(/2\.0\.0/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/renderer/src/features/updater/update-banner.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component, styles, and barrel**

```tsx
// update-banner.tsx
import React from "react";
import styles from "./update-banner.module.css";

interface Props {
  version: string;
}

/** Slim dismissible banner shown when an update is downloaded and ready to apply. */
export function UpdateBanner({ version }: Props): React.JSX.Element | null {
  const [dismissed, setDismissed] = React.useState(false);
  if (dismissed) return null;
  return (
    <div className={styles.banner}>
      <span className={styles.message}>Hay una versión nueva lista 🎉 (v{version}). Reiniciá para aplicarla.</span>
      <button className={styles.action} onClick={() => window.electronAPI.installUpdate()}>
        Reiniciar
      </button>
      <button className={styles.close} aria-label="Cerrar" onClick={() => setDismissed(true)}>
        ×
      </button>
    </div>
  );
}
```

```css
/* update-banner.module.css */
.banner {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 1rem;
  background: var(--accent-muted, #1e3a2f);
  font-size: 0.875rem;
}
.message {
  flex: 1;
}
.action {
  padding: 0.3rem 0.75rem;
  border: 0;
  border-radius: 6px;
  background: var(--accent, #3fb27f);
  color: white;
  cursor: pointer;
}
.close {
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 1.1rem;
  line-height: 1;
  cursor: pointer;
}
```

```ts
// index.ts
export { useUpdateStatus } from "./use-update-status";
export { UpdateBanner } from "./update-banner";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/renderer/src/features/updater/update-banner.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Mount in AppShell**

In `src/renderer/src/shell/app-shell.tsx`, add the import (next to the version-gate import):

```ts
import { useUpdateStatus, UpdateBanner } from "@renderer/features/updater";
```

After `const gate = useVersionGate();` add:

```ts
  const update = useUpdateStatus();
```

In the JSX, render the update banner just below the version-gate soft banner (inside `.shell`, above `.body`):

```tsx
      {update.state === "ready" && <UpdateBanner version={update.version} />}
```

- [ ] **Step 6: Typecheck + commit**

Run: `bunx tsc --noEmit -p tsconfig.web.json` — expected: no errors.

```bash
git add src/renderer/src/features/updater/ src/renderer/src/shell/app-shell.tsx
git commit --no-verify -m "feat(updater): restart banner mounted in AppShell"
```

---

### Task A6: electron-builder feed URL + CI upload to R2

**Files:**
- Modify: `electron-builder.yml`
- Modify: `.github/workflows/release-desktop.yml`

> Uses a placeholder R2 host until the user sets the real one. The build still works; only
> auto-update needs the real URL + the R2 secrets to function.

- [ ] **Step 1: Point the feed at R2**

In `apps/kaipu-record/electron-builder.yml`, replace the `publish` block:

```yaml
publish:
  provider: generic
  url: https://updates.kaipu.app/updates/ # R2 public base + /updates/ — replace host with the real R2 domain
```

- [ ] **Step 2: Add the R2 upload step to the release workflow**

In `.github/workflows/release-desktop.yml`, add a step after "Build, sign & notarize" and before/after the existing upload steps:

```yaml
      - name: Publish update feed + installers to R2
        if: startsWith(github.ref, 'refs/tags/')
        working-directory: apps/kaipu-record
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          AWS_DEFAULT_REGION: auto
          R2_ACCOUNT_ID: ${{ secrets.R2_ACCOUNT_ID }}
          R2_BUCKET: ${{ secrets.R2_BUCKET }}
        run: |
          ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
          VERSION="${GITHUB_REF_NAME#v}"
          # Update feed (zip + blockmap + latest-mac.yml) → updates/
          aws s3 cp dist/ "s3://${R2_BUCKET}/updates/" --recursive \
            --exclude "*" --include "*-mac.zip" --include "*-mac.zip.blockmap" --include "latest-mac.yml" \
            --endpoint-url "$ENDPOINT"
          # Installers → download/<version>/ and download/latest/
          for arch in arm64 x64; do
            SRC="dist/kaipu-record-${VERSION}-${arch}.dmg"
            aws s3 cp "$SRC" "s3://${R2_BUCKET}/download/${VERSION}/kaipu-${arch}.dmg" --endpoint-url "$ENDPOINT"
            aws s3 cp "$SRC" "s3://${R2_BUCKET}/download/latest/kaipu-${arch}.dmg" --endpoint-url "$ENDPOINT"
          done
```

(`macos-latest` runners have the AWS CLI preinstalled. R2 is S3-compatible; `--endpoint-url` targets it.)

- [ ] **Step 3: Commit**

YAML only — no typecheck/test. Validate the workflow file is well-formed (indentation) by eye.

```bash
git add electron-builder.yml ../../.github/workflows/release-desktop.yml
git commit --no-verify -m "ci(updater): point feed at R2 + upload feed/installers on release"
```

---

## Part B — web landing

> web-hono uses Tailwind + `@kaipu/web-ui` (Button/Card) + lucide-react. **No test framework** —
> verify with `bun run typecheck` and `bun run build` from `apps/web-hono`. Dark/premium look via
> explicit Tailwind dark classes (self-contained, independent of any theme toggle).

### Task B1: download URL helper + env

**Files:**
- Create: `apps/web-hono/src/lib/download.ts`
- Create/Modify: `apps/web-hono/src/vite-env.d.ts`
- Modify: `apps/web-hono/.env.example`

- [ ] **Step 1: Type the env var**

Create (or extend) `apps/web-hono/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_PUBLIC_DOWNLOAD_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 2: Write the helper**

```ts
// src/lib/download.ts
/**
 * Resolve the public download URLs for the desktop app. The base is the R2 public
 * bucket (set VITE_PUBLIC_DOWNLOAD_URL at build); falls back to a sane default so
 * the page still renders in dev. Stable `download/latest/` paths — CI keeps them current.
 */
const BASE = import.meta.env.VITE_PUBLIC_DOWNLOAD_URL ?? "https://updates.kaipu.app";

export const downloadUrls = {
  macArm64: `${BASE}/download/latest/kaipu-arm64.dmg`,
  macX64: `${BASE}/download/latest/kaipu-x64.dmg`,
} as const;
```

- [ ] **Step 3: Document the env var**

Append to `apps/web-hono/.env.example`:

```
# Public base URL of the R2 bucket that hosts the desktop installers (download/latest/*.dmg).
VITE_PUBLIC_DOWNLOAD_URL=https://updates.kaipu.app
```

- [ ] **Step 4: Typecheck + commit**

Run (from `apps/web-hono`): `bun run typecheck` — expected: no errors.

```bash
git add apps/web-hono/src/lib/download.ts apps/web-hono/src/vite-env.d.ts apps/web-hono/.env.example
git commit --no-verify -m "feat(web): download URL helper + VITE_PUBLIC_DOWNLOAD_URL"
```

---

### Task B2: DownloadButtons

**Files:**
- Create: `apps/web-hono/src/components/landing/download-buttons.tsx`

- [ ] **Step 1: Write the component**

```tsx
// download-buttons.tsx
import { Apple } from "lucide-react";
import { downloadUrls } from "@/lib/download";

/** Per-arch macOS download CTAs + a disabled Windows placeholder. */
export function DownloadButtons() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <a
        href={downloadUrls.macArm64}
        className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-3 font-semibold text-zinc-950 transition hover:bg-emerald-400"
      >
        <Apple className="h-5 w-5" /> Descargar para Mac (Apple Silicon)
      </a>
      <a
        href={downloadUrls.macX64}
        className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-5 py-3 font-semibold text-zinc-100 transition hover:border-zinc-500"
      >
        <Apple className="h-5 w-5" /> Mac (Intel)
      </a>
      <span className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 px-5 py-3 font-semibold text-zinc-500">
        Windows (próximamente)
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

Run (from `apps/web-hono`): `bun run typecheck` — expected: no errors.

```bash
git add apps/web-hono/src/components/landing/download-buttons.tsx
git commit --no-verify -m "feat(web): download buttons (per-arch macOS CTAs)"
```

---

### Task B3: landing sections

**Files:**
- Create: `apps/web-hono/src/components/landing/landing-nav.tsx`, `hero.tsx`, `features.tsx`, `download-section.tsx`, `footer.tsx`

- [ ] **Step 1: Nav**

```tsx
// landing-nav.tsx
export function LandingNav() {
  return (
    <nav className="flex items-center justify-between px-6 py-4">
      <span className="flex items-center gap-2 font-bold text-zinc-100">
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Kaipu
      </span>
      <a href="#download" className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-white">
        Descargar
      </a>
    </nav>
  );
}
```

- [ ] **Step 2: Hero**

```tsx
// hero.tsx
import { DownloadButtons } from "./download-buttons";

export function Hero() {
  return (
    <section className="mx-auto max-w-4xl px-6 pt-16 pb-12 text-center md:pt-24">
      <h1 className="text-4xl font-bold tracking-tight text-zinc-50 md:text-6xl">
        Grabá tu pantalla,
        <span className="mt-2 block text-emerald-400">sin complicaciones.</span>
      </h1>
      <p className="mx-auto mt-6 max-w-2xl text-lg text-zinc-400">
        Kaipu Record graba tu pantalla y tu cámara en alta calidad, directo en tu equipo. Privado,
        rápido y sin cuentas.
      </p>
      <div className="mt-10">
        <DownloadButtons />
      </div>
      <div className="mx-auto mt-14 aspect-video max-w-3xl rounded-xl border border-zinc-800 bg-zinc-900/60" />
    </section>
  );
}
```

- [ ] **Step 3: Features**

```tsx
// features.tsx
import { Monitor, Shield, SlidersHorizontal, Keyboard } from "lucide-react";

const FEATURES = [
  { icon: Monitor, title: "Pantalla + cámara", body: "Grabá tu pantalla con una burbuja de cámara flotante, lista para tutoriales y demos." },
  { icon: Shield, title: "Local-first y privado", body: "Todo se procesa y guarda en tu equipo. Nada sale a la nube sin que vos quieras." },
  { icon: SlidersHorizontal, title: "Calidad configurable", body: "Elegí resolución, fluidez y peso con presets claros — de liviano a máxima calidad." },
  { icon: Keyboard, title: "Atajos globales", body: "Iniciá, detené y traé la app al frente desde cualquier lado con atajos rebindeables." },
];

export function Features() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-16">
      <div className="grid gap-6 sm:grid-cols-2">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
            <Icon className="h-6 w-6 text-emerald-400" />
            <h3 className="mt-4 font-semibold text-zinc-100">{title}</h3>
            <p className="mt-2 text-sm text-zinc-400">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Download section**

```tsx
// download-section.tsx
import { DownloadButtons } from "./download-buttons";

export function DownloadSection() {
  return (
    <section id="download" className="mx-auto max-w-3xl px-6 py-20 text-center">
      <h2 className="text-3xl font-bold text-zinc-50">Descargá Kaipu Record</h2>
      <p className="mt-3 text-zinc-400">Gratis para macOS 11+. Windows próximamente.</p>
      <div className="mt-8">
        <DownloadButtons />
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Footer**

```tsx
// footer.tsx
export function Footer() {
  return (
    <footer className="border-t border-zinc-900 px-6 py-8 text-center text-sm text-zinc-500">
      <span className="flex items-center justify-center gap-2 font-semibold text-zinc-300">
        <span className="h-2 w-2 rounded-full bg-emerald-500" /> Kaipu Record
      </span>
      <p className="mt-2">Grabá. Compartí. Sin vueltas.</p>
    </footer>
  );
}
```

- [ ] **Step 6: Typecheck + commit**

Run (from `apps/web-hono`): `bun run typecheck` — expected: no errors.

```bash
git add apps/web-hono/src/components/landing/
git commit --no-verify -m "feat(web): dark landing sections (nav, hero, features, download, footer)"
```

---

### Task B4: render the landing + hide template header on home

**Files:**
- Modify: `apps/web-hono/src/routes/index.tsx`
- Modify: `apps/web-hono/src/routes/__root.tsx`

- [ ] **Step 1: Replace the home route with the landing**

Replace the entire contents of `apps/web-hono/src/routes/index.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { LandingNav } from "@/components/landing/landing-nav";
import { Hero } from "@/components/landing/hero";
import { Features } from "@/components/landing/features";
import { DownloadSection } from "@/components/landing/download-section";
import { Footer } from "@/components/landing/footer";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

function LandingPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <LandingNav />
      <Hero />
      <Features />
      <DownloadSection />
      <Footer />
    </div>
  );
}
```

- [ ] **Step 2: Hide the template Header on the landing**

In `apps/web-hono/src/routes/__root.tsx`, find where `<Header />` is rendered in the root component. Import the router-state hook and skip the header on `/`:

```ts
import { useRouterState } from "@tanstack/react-router";
```

In the root component body, before the return:

```ts
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isLanding = pathname === "/";
```

Wrap the header render:

```tsx
  {!isLanding && <Header />}
```

Also update the root `head()` title from `"Monorepo Template"` to `"Kaipu Record — Grabá tu pantalla, sin complicaciones"`.

- [ ] **Step 3: Typecheck + build**

Run (from `apps/web-hono`):
- `bun run typecheck` — expected: no errors.
- `bun run build` — expected: builds successfully.

- [ ] **Step 4: Commit**

```bash
git add apps/web-hono/src/routes/index.tsx apps/web-hono/src/routes/__root.tsx
git commit --no-verify -m "feat(web): render the Kaipu landing as the home page"
```

---

## Final verification

- [ ] From `apps/kaipu-record`: `bunx tsc --noEmit -p tsconfig.web.json && bunx tsc --noEmit -p tsconfig.node.json` — clean.
- [ ] From `apps/kaipu-record`: `bunx vitest run` — all pass (new: useUpdateStatus ×2, UpdateBanner ×2).
- [ ] From `apps/kaipu-record`: `bunx oxlint src` — 0/0.
- [ ] From `apps/web-hono`: `bun run typecheck && bun run build` — clean.
- [ ] From repo root: `bunx oxfmt --check .` — clean (run `bunx oxfmt .` if not).

---

## Self-Review notes

- **Spec coverage:** updater module (A2), IPC (A1/A3), hook+banner (A4/A5), 6h checks + silent download + restart (A2/A5), electron-builder feed (A6), CI→R2 (A6), R2 layout (A6 paths), landing dark/premium with sections + per-arch CTAs (B2/B3/B4), env (B1), Windows-disabled (B2), provisioning (user-side, documented in spec). Covered.
- **Type consistency:** `UpdateStatus` (`{state:"idle"} | {state:"ready";version}`), `getUpdateStatus`/`onUpdateStatus`/`installUpdate`, `initAutoUpdater`/`installDownloadedUpdate`, `downloadUrls.macArm64/macX64` used identically across tasks.
- **No web tests:** web-hono has no test runner; B tasks verified by typecheck + build (consistent with the repo). Honest, not a gap.
- **Out of scope (confirmed not built):** Windows build/signing, in-app auto-install without prompt, version-gate→updater wiring.
