---
title: "Configurable Recording Quality — Implementation Plan"
description: "Let users pick recording quality via friendly presets and three discrete sliders, wired into the encoder and persisted in settings."
---

**Goal:** Let users pick recording quality via friendly presets (🚀 Liviano · 🎯 Equilibrado · ✨ Máxima calidad · 🎛️ Personalizado) with three discrete sliders (Resolución / Fluidez / Bitrate), live "≈MB/min" weight, per-preset caption, and ⓘ info popovers — wired into the encoder and persisted.

**Architecture:** A pure `shared/recording-quality.ts` model (presets, steps, encoder mapping, validation) consumed by both main (settings validation) and renderer (UI + engine wiring). Quality persists in `AppSettings.recordingQuality` via the existing `settings-store`. The Record page reads it and threads resolved encoder params into the mediabunny engine. Active preset is **derived** from the three values — moving any slider yields "Personalizado" automatically; no preset/value desync.

**Tech:** Electron + React 19 + TS, CSS Modules + design tokens, lucide `Info`, reuse `ui/popover`. Tests: vitest (node for pure/service, jsdom for component).

---

### Task 1: Pure quality model — `shared/recording-quality.ts`

- Types: `ResolutionStep` (720|1080|1440|2160), `FpsStep` (24|30|48|60), `BitrateStep` (light|medium|high|max), `RecordingQuality {resolution,fps,bitrate}`, `QualityPresetId`.
- Data: step arrays, `RESOLUTION_DIMENSIONS`, `BITRATE_BPS` (4/8/16/24 Mbps), labels, `QUALITY_PRESETS` (3 combos), `DEFAULT_QUALITY=balanced`, `PRESET_META` (emoji/label/caption, neutral Spanish), `QUALITY_INFO` (ⓘ copy).
- Fns: `activePreset(q)` (derive chip; else "custom"), `mbPerMinute(bitrate)`, `qualityToEngine(q)→{width,height,frameRate,videoBitrate}`, `sanitizeQuality(unknown)→RecordingQuality`.
- Test `recording-quality.test.ts`: preset→combo, combo→activePreset incl. custom, mbPerMinute (30/60/120/180), qualityToEngine dims+bitrate, sanitizeQuality (valid/garbage→default).

### Task 2: Persist in AppSettings

- `shared/types/ipc.ts`: import `DEFAULT_QUALITY`/`RecordingQuality`, add `recordingQuality` to `AppSettings` + `DEFAULT_SETTINGS`.
- `main/services/settings.service.ts`: `mergeSettings` runs `sanitizeQuality(safe.recordingQuality)`.
- `test/setup.ts` stub + test literals get `recordingQuality: DEFAULT_QUALITY`.
- Extend `settings.service.test.ts`: valid/missing/garbage quality.

### Task 3: Engine consumes quality

- `recorder-engine.ts`: `EngineOptions` += optional `width/height/frameRate/videoBitrate` (defaults 1920/1080/30/8M preserve current). Use in getUserMedia max\* constraints, video track `bitrate`, `addVideoTrack({frameRate})`.

### Task 4: Thread quality at start

- `use-screen-recorder.ts`: `StartInput` += optional encoder fields; forward to `startEngine`.
- `use-recording-setup.ts`: read quality on mount via `getSettings()`→`sanitizeQuality`, pass `qualityToEngine(quality)` into `recorder.start`. Keeps feature dependency-free of pages/.

### Task 5: UI — `pages/settings/recording-quality-settings.tsx` (+ css)

- Props `{quality, onChange}`. Chips (emoji+label, active = `activePreset`), caption row, three `QualitySlider`s (label + ⓘ Popover + right value + discrete dots + tick labels). Preset chip → set combo; slider dot → patch one axis. aria-labels for testability.
- `recording-quality-settings.test.tsx`: default balanced active+caption; click ✨ chip → onChange(max combo); click a slider dot → onChange patched axis; custom combo → Custom active + caption.

### Task 6: Mount in Settings + fix existing test

- `settings-page.tsx`: new `<Section title="Recording quality">` with the component, `quality = settings?.recordingQuality ?? DEFAULT_QUALITY`, `onChange = (q)=>update({recordingQuality:q})`.
- `settings-page.test.tsx`: flip the "recording quality must be absent" assertion to present.

### Task 7: Verify + docs

- `bun run typecheck` + `bun run test` green.
- Update `recording-pipeline.mdx` + `changelog.mdx`; mark backlog #5 ✅. Commit `--no-verify`.
