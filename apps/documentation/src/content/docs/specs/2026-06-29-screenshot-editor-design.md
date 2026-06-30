---
title: "Screenshot editor — design spec (v1)"
description: "Technical design for Kaipu's screenshot capture → beautify → annotate → export flow. Path A capture, React+SVG annotation editor (hand-drawn look, no rough.js dependency), unified storage. The source of truth for implementation."
---

# Screenshot editor — design spec (v1)

> **Status: 🟢 Approved design, ready to plan.** Brainstormed and agreed with the owner.
> Design mockups exist (launcher / editor / capture) and the exact visual values are captured
> below. Next step: implementation plan → subagents. Branch: `feat/screenshots`.

## 1. Vision & scope

A fast `capture → beautify → annotate → export` loop that lives inside Kaipu Record. Press a
hotkey (or the **Capturar** button), select a screen region, and it opens in an in-app editor where
you frame the shot on a nice background (**beautify**) and mark it up with simple hand-drawn
annotations (**box, arrow, text**), then **Copy** (`⌘C`) or **Save** to the unified library.

This is the first slice of a larger media vision (owner's priority order): record screen ✅ →
**screenshot + beautify + edit (this spec)** → video editing → multi-image compositor. The editor
is built as a layered canvas so the future compositor is an extension, not a rewrite.

**In v1**
- Capture a region (Path A — `screencapture -i`, see §3).
- Editor (route in the main window): beautify (background / padding / corners / shadow) + 3
  annotation tools (box, arrow, text) with select / move / resize / delete + undo/redo.
- Export: composite once → PNG; **Copy** to clipboard + **Save** to the unified vault.
- Unified storage: a `kind` discriminator; screenshots appear in the Library with a type filter.
- Entry points: global hotkey `captureScreenshot` (default `⌘⌃X`) + a Screenshots page.

**Out of v1 (later phases)**
- Branded custom-overlay capture (Path B), video editing, multi-image compositor.
- Re-editable saved screenshots (persist a scene doc) — v1 exports a flat PNG.
- More tools (blur/redaction, highlighter, numbered steps, crop), tray entry, export formats.

## 2. Key decisions (resolved)

| Topic | Decision | Why |
| --- | --- | --- |
| Capture engine (v1) | **Path A** `screencapture -i` behind a `ScreenshotCaptureProvider` seam | `-i` is interactive **region** select (not full-screen). Ships now, pixel-perfect, Retina/multi-monitor free. Branded overlay (Path B) is a later iteration; the editor is unchanged. |
| Hand-drawn look | **Custom SVG "rough" helper (~30 lines), NOT the rough.js library** | The mockup proves a seeded-RNG double-stroke jitter reproduces the look exactly. Zero dependency. |
| Annotation font | **Caveat** (Google Font, OFL) | The mockup's hand-drawn font. OFL → bundle legally. |
| Editor rendering | **React + SVG scene** (matches the mockup 1:1), hand-rolled interaction layer | The design is SVG; the rough helper emits SVG paths. No Konva dependency for v1. **Fallback:** if the interaction layer (drag/resize/hit-test) proves too heavy during the annotations slice, swap the annotation *renderer* to Konva — keep the scene model renderer-agnostic so this is localized. |
| Editor surface | **Route in the main window** (`/screenshot-editor`) | Simpler; reuses routing/chrome. |
| Storage | **Unified vault**, `kind: "recording" \| "screenshot"` | One Library, one vault. |
| Tokens | **Use the existing design-system CSS variables**; new tokens only for genuinely feature-specific values, defined once | See §7 — hard rule. |

## 3. Capture (Path A, seam for B)

Behind a thin provider so the editor never knows which engine ran:

```ts
interface ScreenshotCaptureProvider {
  // Resolves to the captured PNG, or null if the user cancelled (Esc).
  captureInteractive(): Promise<Buffer | null>;
}
```

- **v1 — `MacNativeProvider`:** main process runs `screencapture -i -o <temp>.png`, waits, reads the
  temp PNG → `Buffer` (null if the user cancelled). Mac-only, behind a platform guard.
- **Later — `OverlayProvider` (Path B):** transparent full-screen window + `desktopCapturer` +
  crop, rendering the branded dashed-box overlay from the mockup. No editor changes.
- Pass a `Buffer`/temp-path across IPC, **not** a base64 data URL (large captures).

## 4. The editor

### 4.1 Scene model (renderer-agnostic)

A plain data model in React state, so the renderer (SVG now, possibly Konva later) is swappable and
the future compositor can extend it:

```ts
type Tool = "select" | "box" | "arrow" | "text";

interface SceneDoc {
  shot: { src: string; width: number; height: number };   // the captured PNG
  beautify: { bg: BackgroundId; padding: number; radius: number; shadow: number };
  annotations: Annotation[];                                // z-ordered
}

type Annotation =
  | { id: string; kind: "box";   x: number; y: number; w: number; h: number; color: ColorId; stroke: 0|1|2; seed: number }
  | { id: string; kind: "arrow"; x1: number; y1: number; x2: number; y2: number; color: ColorId; stroke: 0|1|2; seed: number }
  | { id: string; kind: "text";  x: number; y: number; text: string; color: ColorId; size: 0|1|2; rotation: number };
```

- `seed` makes the hand-drawn jitter **stable** across re-renders (re-rolling on every paint would
  make shapes wiggle). Undo/redo = a stack of `SceneDoc` snapshots (or command list).
- Composition order (back→front): **background → framed shot (padding, rounded, shadow) →
  annotations**.

### 4.2 The hand-drawn helper (port from the mockup)

Two pure functions, unit-testable, ported from the design's JS:

```ts
roughRect(w, h, radius, seed): string   // SVG path: jittered rounded rect
roughArrow(x1, y1, x2, y2, seed): string // SVG path: curved body + arrowhead
```

Each shape is drawn as **two stroked paths** (main + a lighter `opacity .55`, `stroke-width ×0.7`
offset) for the sketchy double-line. Box also gets a translucent fill (`--anno-fill`).
Stroke widths: `[2, 3.4, 5.4]`. Text: Caveat, sizes S/M/L, slight `rotate(-5deg)` default.

### 4.3 Tools & interaction (v1)

- **Select** — click an annotation → 8 resize handles (white `8×8`, stroke `--accent-primary`) +
  dashed bounding box; drag to move, drag handles to resize, `Delete` to remove.
- **Box / Arrow** — drag on the canvas to create; box resizes via handles, arrow via its two
  endpoints.
- **Text** — click to place a caret, type; size via the S/M/L toolbar control.
- Global: **undo/redo** (`⌘Z` / `⌘⇧Z`), `Esc` deselects.

### 4.4 Beautify panel — exact values

- **Background** — 5-col swatch grid, 9 presets (selected ring = `0 0 0 2px var(--bg-sidebar),
  0 0 0 3.5px var(--accent-primary)`):
  `Ninguno` (transparent checker) · `Oscuro` (`--bg-app`) · `Carbón` (`--bg-card`) · `Magenta`
  `linear-gradient(135deg,#ff2d6e,#a3044a)` · `Púrpura` `#a855f7→#6d28d9` · `Océano`
  `#2563eb→#06b6d4` · `Atardecer` `#f59e0b→#ef4444` · `Bosque` `#22c55e→#0ea5e9` · `Grafito`
  `#3f3f46→#18181b`.
- **Relleno (padding)** — slider `min 0, max 96, default 40` (px).
- **Esquinas (corner radius)** — slider `min 0, max 28, default 12` (px).
- **Sombra (shadow)** — slider `min 0, max 100, default 60` (%). CSS:
  `0 {round(v·.45)}px {round(v·.9+8)}px -{round(v·.18)}px rgba(0,0,0,{(.12 + v/100·.5)})`.
- **Frame radius** = `bg === "Ninguno" ? radius : max(8, radius + 4)`.
- Slider style: track `var(--border)` 4px, thumb 15px white, 2px `var(--accent-primary)` ring.

### 4.5 Export (deterministic)

Composite the scene **once** to an offscreen canvas at the framed size, then use that single PNG for
**both** Copy and Save (identical pixels). Draw order = background → shot (padding/radius/shadow) →
annotations (rough paths rasterized; Caveat must be loaded before export — `document.fonts.ready`).
- **Copy:** PNG buffer → main → `clipboard.writeImage(nativeImage.createFromBuffer(buf))`.
- **Save:** PNG buffer → vault writer (§6) → appears in Library.

## 5. Layout & visual reference

Window 1100×760. **Rail** 66px (`--bg-sidebar`), items 42×42 radius `--radius-lg`, active
`background: color-mix(accent 15%)` / color `--accent-primary`. **Editor toolbar** 54px: tool group
(`--bg-modal`, border `--border`, radius 7) → contextual controls (COLOR palette, TRAZO/ TAMAÑO) →
Undo/Redo + **Copiar** (outline `--border-light`) + **Guardar** (`--accent-primary`). **Canvas**
`--bg-app`, padding 38, centered framed shot. **Beautify panel** 280px (`--bg-sidebar`, left border
`--border`). The full mockup HTML is the visual reference; all spacing/radii match the tokens in §7.

The **Screenshots launcher page** (`/screenshots`): overline "CAPTURAS", H1 "Captura y documenta",
subtitle, a card with a primary **Capturar pantalla** button + `⌘⌃X` hint chip, and a **Recientes**
strip (the Library filtered to screenshots) with an empty state. (Copy is **neutral Spanish, no
voseo** — the project copy rule overrides the voseo in the original mockups.)

## 6. Storage & Library (unified)

Extend the existing vault (`apps/kaipu-record/src/main/library/`), don't fork it.

- **Model** (`src/shared/types/library-storage.ts`): add `kind: "recording" | "screenshot"` to the
  stored item + the `Sidecar`. `LocalRecording` stays as the `kind: "recording"` shape during
  migration (avoid a big-bang rename).
- **Vault** (`library-vault.ts`): teach it an image extension (`.png`); screenshots live in a
  `screenshots/` subfolder; reuse the `.kaipu/<id>.json` sidecar + `.kaipu/<id>.jpg` thumbnail
  mechanism. Add a parallel list/describe that tags `kind`.
- **Media protocol** (`src/main/media-protocol.ts`): add a `kaipu-media://screenshot/<id>` branch +
  a `screenshotFilePath(id)` resolver (mirrors `recording`/`thumb`).
- **Library UI**: add a type filter (All / Videos / Screenshots) to the existing filter infra
  (`library-filters.ts`, `use-library-filters.ts`); a screenshot item opens the editor or a
  detail/preview (recordings still open the player). Extend `LibraryVideo`/`toLibraryVideo` with
  `kind`.

## 7. Design tokens — hard rule

**Use the existing system variables (`src/renderer/src/assets/base.css`) for everything that has
one. Never hardcode a hex that duplicates an existing token. New tokens only for genuinely
feature-specific values, defined once.**

Already covered by existing tokens (use the variable, not the hex): `#f6055c`→`--accent-primary`,
`#0f0f11`→`--bg-app`, `#0c0c0e`→`--bg-sidebar`, `#131315`→`--bg-modal`, `#171719`→`--bg-card`,
`#1a1a1c`→`--bg-input`, `#26262a`→`--border`, `#32323a`→`--border-light`,
`#e5e5e7`/`#a1a1aa`/`#6b7280`→`--text-primary`/`secondary`/`muted`, the annotation palette
`#eab308`/`#ef4444`/`#22c55e`/`#a855f7`→`--accent-yellow`/`red`/`green`/`purple`, radii 4/5/8 →
`--radius-sm`/`md`/`lg`.

New feature tokens (define once, e.g. in `base.css` or a feature token module — follow the
shared-tokens-package direction):
- **Beautify backgrounds:** `--shot-bg-magenta|purpura|oceano|atardecer|bosque|grafito` (the
  gradients above), plus `oscuro`/`carbon` reuse `--bg-app`/`--bg-card`.
- **Annotation neutrals:** `--anno-ink: #1a1a1a` and `--anno-on-light: #f5f5f5` (intentionally
  distinct from UI text — they draw on the screenshot, not chrome).
- **Annotation fill:** `--anno-fill: rgba(234,179,8,.18)`.
- **Fonts:** add **Caveat** (annotations) alongside Geist / Geist Mono.

## 8. Entry points

- **Global hotkey** — add `"captureScreenshot"` to `SHORTCUT_ACTIONS` + `DEFAULT_SHORTCUTS`
  (default `⌘⌃X`), the `status` map in `global-shortcuts.ts`, the `handlers` map in `main/index.ts`,
  and the two UI lists (`shortcuts-page.tsx`, `use-shortcut-labels.ts`). Rebindable.
- **Screenshots page** — the **Capturar pantalla** button calls the same capture path.

## 9. Architecture / where code lives

Following the existing main/preload/renderer split (from the integration map):

- **Shared** — `IPC_CHANNELS` (`screenshot:capture` / `screenshot:copy` / `screenshot:save`) and
  `KaipuElectronAPI` methods in `ipc.ts` / `electron-api.ts`; `kind` in `library-storage.ts`;
  `captureScreenshot` in `SHORTCUT_ACTIONS`.
- **Main** — `src/main/screenshots/screenshot-capture.ts` (provider, Path A),
  `screenshot-ipc.ts` (`registerScreenshotHandlers()`, wired in `index.ts` under `whenReady`);
  vault + media-protocol + shortcut extensions.
- **Preload** — `captureScreenshot()`, `copyImageToClipboard(buf)`, `saveScreenshot(buf, meta)`.
- **Renderer** — `pages/screenshots/screenshots-page.tsx` (launcher; sidebar `NAV` entry + route),
  `features/screenshot-editor/` (scene model, SVG renderer, rough helper, toolbar, beautify panel,
  export), route `/screenshot-editor`; Library filter + `kind` rendering.

## 10. Testing strategy

- **Pure units (TDD):** `roughRect`/`roughArrow` (stable output for a fixed seed; valid path
  shape), the beautify geometry (frame radius rule, shadow CSS formula), the export compositor's
  layout math (framed size from shot + padding), the scene reducer (create/move/resize/delete,
  undo/redo), the storage `kind` mapping, the Library type filter.
- **Integration (glue, manual/where feasible):** the capture provider (mock `screencapture`), IPC
  round-trips, clipboard/save. The interactive canvas is verified by running the app.

## 11. Build order (slices → subagents)

1. **Plumbing slice:** capture provider (Path A) + IPC + preload + `kind` storage model + media
   protocol branch + `/screenshots` page (Capture button) + `/screenshot-editor` route that shows
   the raw PNG + **Copy/Save** (flat, no beautify/annotations) + the `captureScreenshot` hotkey.
   *Proves the whole pipeline end-to-end.*
2. **Beautify slice:** background swatches + padding/corners/shadow + the framed composite for
   export.
3. **Annotations slice:** rough helper + Caveat + box/arrow/text + select/move/resize/delete +
   undo/redo; export rasterizes them.
4. **Library slice:** type filter + screenshot item rendering/opening.

Each slice is independently shippable and testable.

## 12. Open questions (minor, resolve in-flight)

- **Editor open target:** new route vs reusing a modal-like surface — going with a route.
- **Re-edit:** v1 saves flat PNG; persisting a re-editable `SceneDoc` is a later phase.
- **Konva fallback trigger:** decide during slice 3 only if hand-rolled resize/hit-testing for the
  arrow endpoints gets fiddly.
