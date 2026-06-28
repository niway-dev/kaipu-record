---
title: "Watermark (free → paid) — Implementation Plan"
description: "Burn a Kaipu wordmark watermark into recordings for free users, removable for paid, gated through a single useWatermark hook."
---
**Goal:** Burn a "Kaipu" wordmark watermark into recordings for free users, removable for paid — all gated through ONE hook (`useWatermark`) that today is a local stub and tomorrow consumes a backend + feature flag. A dev-only env override (`VITE_WATERMARK_FORCE`) lets us flip it while developing; it is statically eliminated from prod builds.

**Architecture:** `useWatermark()` is the single decision seam (entitlement stub + flag stub + dev force → `enabled` + `config`). When enabled, the engine routes the screen track through a `<canvas>` compositor (draw frame + white-silhouette wordmark) and encodes the canvas's `captureStream`. When disabled, the original screen track goes straight to the encoder (zero added cost).

**Tech:** Electron + React 19, mediabunny, canvas 2D compositing, `import.meta.env.DEV` static guard. No backend, no new IPC.

---

### Task 1: Pure watermark model — `features/watermark/watermark.ts`
- `as const` sets (no enums): `WATERMARK_POSITIONS`, `WATERMARK_VARIANTS`, `WATERMARK_TINTS` + derived types.
- `WatermarkConfig { variant, position, tint, opacity, heightRatio, marginRatio }`, `DEFAULT_WATERMARK_CONFIG` (wordmark · bottom-right · white · 0.9 · 0.045 · 0.03).
- Pure `watermarkRect(canvasW, canvasH, assetAspect, config) → {x,y,width,height}` (corner math).
- Pure `resolveWatermarkEnabled({flagOn, isPaid, devForce}) → boolean` (devForce overrides; `flagOn && !paid`).
- Test `watermark.test.ts`: rect for each corner + center; resolveWatermarkEnabled (free→on, paid→off, flag off→off, devForce overrides).

### Task 2: The hook — `features/watermark/use-watermark.ts`
- `useWatermark(): { enabled, config }`. Stubs: `isPaid=false` (TODO backend), `flagOn=true` (TODO PostHog). `devForceEntitlement()` reads `VITE_WATERMARK_FORCE` ONLY under `import.meta.env.DEV` (branch erased in prod).
- `env.d.ts`: augment `ImportMetaEnv` with `VITE_WATERMARK_FORCE?: string`.
- Test `use-watermark.test.tsx`: default → enabled true + config = default.

### Task 3: Canvas compositor — `features/recording/watermark-compositor.ts`
- `startWatermarkCompositor(screenStream, config, frameRate) → { track, stop() }`: hidden `<video>` of the screen, load asset (wordmark/mark url), optional white-silhouette tint (compositing `source-in`), rAF draw loop (frame + watermark at `watermarkRect` with opacity + soft shadow), `canvas.captureStream(frameRate)`. `stop()` cancels rAF + stops track + releases video. Guard `getContext` (no `!`).

### Task 4: Engine consumes it — `recorder-engine.ts`
- `EngineOptions.watermark?: WatermarkConfig | null`. If set: composite → encode the canvas track; else encode `screenTrack` directly. Keep the `screenTrack` "ended" failure listener on the ORIGINAL track. `stop()` also calls `compositor?.stop()` after finalize.

### Task 5: Wire at start
- `use-screen-recorder.ts`: `StartInput.watermark?: WatermarkConfig | null` → forward to `startEngine`.
- `use-recording-setup.ts`: `const watermark = useWatermark()` (ref), pass `watermark.enabled ? watermark.config : null` into `recorder.start`.

### Task 6: Verify + docs
- typecheck (node+web) + lint + tests green.
- recording-pipeline.mdx: watermark section (hook seam, dev env override never-in-prod, compositor, zero-cost-when-off). changelog row. backlog #6 → 🔨 (gating seam shipped; real entitlement/flag pending #4). Commit `--no-verify`.
