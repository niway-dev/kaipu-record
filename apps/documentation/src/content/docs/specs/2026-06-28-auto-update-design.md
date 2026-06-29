---
title: Auto-update + download page — design spec
description: Wire electron-updater for the signed macOS app against a public Cloudflare R2 feed, with a silent download + "restart" banner, plus a public download page (CTA) on the web app pointing at the DMGs on R2.
---

# Auto-update + download page — design spec

**Goal:** let installed macOS builds update themselves (silent background download + a "restart to
apply" banner), and give new users a public page to download the installer — both served from a
public Cloudflare R2 bucket.

**Status:** design approved (brainstorming). Branch `feat/auto-update`. Plan to follow via
`writing-plans`.

**Tech stack:** Electron + `electron-updater@6.3.9` (already a dep), React (renderer banner),
TanStack Router + React 19 (web download page), Cloudflare R2 (public feed + installers), GitHub
Actions (existing `release-desktop.yml`).

---

## Why R2 (decisive constraint)

The repo is **private**. Using GitHub Releases as the electron-updater feed would require embedding
a GitHub token in the distributed app — a secret leak. So the feed and the installers are hosted on
a **public Cloudflare R2 bucket** instead; the app and the web page read public URLs, and no secret
ships in the binary. R2 is also where the version-gate JSON lives, keeping all remote config in one
place.

The macOS prerequisite for auto-update — the update must be **signed + notarized with the same
Developer ID** — is already met by `release-desktop.yml`.

---

## Scope

**In scope:**

1. **macOS auto-update** — `electron-updater` wired in main; silent download; "restart to apply"
   banner in the renderer; check on startup + every 6h.
2. **Publish to R2** — a CI step uploads the feed + installers to the bucket on each tagged release.
3. **Web landing page** — a full product landing on `apps/web-hono` (dark/premium) with the
   download CTAs integrated (per macOS arch).

**Out of scope (separate items):**

- **Windows** — `electron-builder.yml` has NSIS config, but CI only builds `--mac` and Windows needs
  its own code-signing cert. Future task.
- **In-app delta/auto-install-without-prompt** — we do silent _download_ but ask the user to restart.
- Triggering the update from the version-gate "Actualizar" button — a one-line follow-up once this
  ships (the gate keeps opening the download page until then).
- Removing GitHub Releases — the release job still attaches assets there for archival; end-user
  distribution moves to R2.

---

## Artifacts: `.dmg` vs `.zip` (they are not interchangeable)

| Artifact                                | Purpose                                      | Consumer                     |
| --------------------------------------- | -------------------------------------------- | ---------------------------- |
| `.dmg` (per arch)                       | Manual installer (drag to Applications)      | A human, via the web CTA     |
| `.zip` + `.blockmap` + `latest-mac.yml` | Auto-update feed (Squirrel.Mac requires zip) | `electron-updater`, silently |

The pipeline already produces both per arch (`…-arm64.dmg`, `…-x64.dmg`, `…-arm64-mac.zip`,
`…-mac.zip`). No packaging change — we keep the **two per-arch DMGs** (no universal build).

---

## R2 bucket layout

```
updates/latest-mac.yml                       # electron-updater feed (points at the versioned zip)
updates/<Kaipu…>-<version>-arm64-mac.zip      # + .blockmap — consumed by the updater
updates/<Kaipu…>-<version>-mac.zip            # + .blockmap (x64)
download/latest/kaipu-arm64.dmg               # stable URL for the web CTA (Apple Silicon)
download/latest/kaipu-x64.dmg                 # stable URL for the web CTA (Intel)
download/<version>/…                          # versioned archive copy of each dmg
```

- The updater reads `updates/latest-mac.yml` (electron-builder generates it; CI uploads it as-is).
- The web CTA links to the fixed `download/latest/*.dmg` URLs, so the page never changes per release.
- CI copies each release's DMG to both `download/<version>/` and `download/latest/`.

`PUBLIC_R2_URL` (the bucket's public base, e.g. `https://updates.<domain>/` or the `…r2.dev`
subdomain) is the single value threaded into `electron-builder.yml` (`publish.url` → `.../updates/`)
and the web page (`.../download/latest/...`).

---

## Component 1 — main updater (`src/main/updater/auto-updater.ts`)

```ts
import { autoUpdater } from "electron-updater";

/** Initialize auto-update. No-op in dev (electron-updater needs a packaged app-update.yml). */
export function initAutoUpdater(getMainWindow: () => BrowserWindow | null): void;
/** Quit and install a downloaded update (called from the "Reiniciar" banner button). */
export function installDownloadedUpdate(): void;
```

Behavior:

- Guard: `if (!app.isPackaged) return;` — dev is a no-op.
- `autoUpdater.autoDownload = true`; `autoUpdater.autoInstallOnAppQuit = true`.
- `void autoUpdater.checkForUpdates()` on init, then `setInterval(..., 6 * 60 * 60 * 1000)`.
- On `update-downloaded` → `getMainWindow()?.webContents.send(IPC_CHANNELS.updateStatus, { state: "ready", version })`.
- On `error` → log + swallow (optionally forward to the existing PostHog main sink). Never throw.
- `installDownloadedUpdate()` → `autoUpdater.quitAndInstall()`.

Wired in `app.whenReady()` next to the other `register*` calls: `initAutoUpdater(() => mainWindow)`.

---

## Component 2 — IPC (3 new channels in `src/shared/types/ipc.ts`)

```ts
updateGetStatus: "update:get-status",  // renderer → main (invoke): current status for late-mounting UI
updateStatus: "update:status",         // main → renderer (event): pushed when an update is ready
updateInstall: "update:install",       // renderer → main: the "Reiniciar" button
```

`UpdateStatus` type (in `shared/types`): `{ state: "idle" } | { state: "ready"; version: string }`.

Preload exposes: `getUpdateStatus()`, `onUpdateStatus(cb)`, `installUpdate()`. Test stub gets
`getUpdateStatus: async () => ({ state: "idle" })`, `onUpdateStatus: () => () => {}`,
`installUpdate: () => {}`.

---

## Component 3 — renderer (`src/renderer/src/features/updater/`)

- `use-update-status.ts` — `useUpdateStatus(): UpdateStatus` — seeds from `getUpdateStatus()` on
  mount, subscribes to `onUpdateStatus`. Returns `{ state: "idle" }` until an update is ready.
- `update-banner.tsx` — reuses the version-gate banner styling. Shown when `state === "ready"`:
  copy `"Hay una versión nueva lista 🎉 Reiniciá para aplicarla."` + a **Reiniciar** button →
  `window.electronAPI.installUpdate()`. Dismissible (per session).
- Mounted in `AppShell` beside the version-gate banner. (If both a soft version-gate banner and an
  update banner are active, stack them; the hard version-gate overlay still wins visually.)

---

## Component 4 — `electron-builder.yml`

```yaml
publish:
  provider: generic
  url: https://<PUBLIC_R2_URL>/updates/   # was https://example.com/auto-updates
```

`provider: generic` is read-only (the app reads the feed from this URL, baked into `app-update.yml`).
electron-builder does **not** publish to a generic provider, so CI uploads the artifacts itself
(below).

---

## Component 5 — CI upload to R2 (`release-desktop.yml`)

After the existing build step (which already runs `electron-builder … --publish never`), add a step
that uploads to R2 via the AWS CLI against R2's S3-compatible endpoint:

```yaml
- name: Publish update feed + installers to R2
  if: startsWith(github.ref, 'refs/tags/')
  working-directory: apps/kaipu-record
  env:
    AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
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

(Exact dmg filenames follow electron-builder's `artifactName: ${name}-${version}-${arch}.${ext}`.)

**New GitHub Secrets** (production environment): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.

---

## Component 6 — web landing page (`apps/web-hono`)

A full product landing for Kaipu Record, **dark / premium** (background `#0c0c0f`, light text, a
single accent color, large type — coherent with the dark desktop app; vibe à la Linear/Raycast).
The landing **replaces the template home** at `routes/index.tsx` (the current page is leftover
scaffolding). Copy is **neutral Spanish**, friendly and benefit-first (emoji ok) — house copy rule.

**Route & structure:**

- `routes/index.tsx` becomes the landing (the marketing home).
- The landing is composed of small, focused section components under
  `apps/web-hono/src/components/landing/`, each one responsibility:
  - `landing-nav.tsx` — minimal top bar: wordmark + a "Descargar" button (scrolls to / links the
    download section).
  - `hero.tsx` — headline ("Grabá tu pantalla, sin complicaciones."), subhead (one benefit line),
    the primary `DownloadButtons`, and an app-preview image placeholder.
  - `features.tsx` — a 3–4 card grid of benefits drawn from what actually shipped: graba pantalla +
    cámara (burbuja flotante), local-first / privado (nada sale de tu equipo), calidad configurable,
    atajos globales. (Copy only — no new product claims.)
  - `download-section.tsx` — the anchored `#download` block with `DownloadButtons` + a one-line note
    ("macOS 11+. Windows próximamente.").
  - `footer.tsx` — wordmark, year, minimal links.
- `download-buttons.tsx` — the shared CTA unit (used by hero + download section + nav). Two buttons:
  **Mac (Apple Silicon)** → `${PUBLIC_DOWNLOAD_URL}/download/latest/kaipu-arm64.dmg`,
  **Mac (Intel)** → `…/kaipu-x64.dmg`, plus a disabled **Windows (próximamente)**.

**Styling:** keep it self-contained — a `landing.module.css` (or co-located module CSS per section)
with the dark palette + accent as CSS variables. Don't pull in a new UI framework; match the repo's
existing styling approach in `web-hono`.

**Config:** `PUBLIC_DOWNLOAD_URL` (the R2 public base) comes from a build-time env
`VITE_PUBLIC_DOWNLOAD_URL`, so URLs aren't hardcoded across files. Add it to `apps/web-hono`'s env
declaration + `.env.example`.

> Auth/todos template routes are out of scope — leave them; we only replace the home and add the
> landing components.

---

## Data flow (auto-update)

1. App launches (packaged) → `initAutoUpdater` → `checkForUpdates()` hits `updates/latest-mac.yml`
   on R2.
2. If the feed version > installed version → electron-updater downloads the `.zip` in the
   background.
3. `update-downloaded` → main sends `update:status { ready, version }` → renderer banner appears.
4. User clicks **Reiniciar** → `update:install` → `quitAndInstall()` → app relaunches updated.
5. If the user never restarts, `autoInstallOnAppQuit` applies it on the next quit.

---

## Error handling

Fail-safe throughout: dev (unpackaged), no network, feed 404/unreachable, or a malformed feed → the
updater logs and does nothing; the app runs normally. An update error never interrupts the user. The
web page links are static, so a missing artifact is a normal 404 from R2 (no app impact).

---

## Testing

- **Main updater** — Electron-coupled (`electron-updater`/`autoUpdater`); no unit test, consistent
  with the rest of `src/main` (global-shortcuts, windows). Validated in prod (see checklist).
- **Renderer** — `useUpdateStatus` (mock `getUpdateStatus`/`onUpdateStatus`: idle → ready on event)
  and `UpdateBanner` (renders on ready; **Reiniciar** calls `installUpdate`; dismiss hides).
- **Web** — `DownloadButtons` renders the two arch links from `VITE_PUBLIC_DOWNLOAD_URL` and the
  disabled Windows button; the landing renders its sections (hero/features/download/footer) without
  crashing. (Marketing copy isn't asserted verbatim — too brittle.)

---

## Provisioning checklist (user action — required for it to actually work)

- [ ] Create a **public** R2 bucket; note its public base URL (`r2.dev` subdomain or custom domain).
- [ ] Create R2 API credentials (Account ID, Access Key ID, Secret).
- [ ] Add GitHub Secrets: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
- [ ] Set `publish.url` in `electron-builder.yml` to `https://<public-r2>/updates/`.
- [ ] Set `VITE_PUBLIC_DOWNLOAD_URL` for `apps/web-hono` to `https://<public-r2>`.

---

## Validate (prod)

- [ ] Install version N, publish N+1 to R2, reopen the app → it downloads silently and shows the
      "Reiniciá" banner; **Reiniciar** relaunches into N+1.
- [ ] Kill the network / point the feed at a bad URL → app runs normally, no error UI.
- [ ] Landing page: renders dark/premium; each download button pulls the right DMG; it installs and
      runs.
