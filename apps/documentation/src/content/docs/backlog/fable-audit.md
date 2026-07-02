---
title: Pre-testers correctness audit (Claude Fable 5)
description: A deep, pre-testers correctness audit of kaipu-record's critical pipeline — recording, screenshots, and settings/IPC — run with Claude Fable 5 using parallel finders plus adversarial verification. Self-contained so it can be picked up in a fresh session.
---

# Pre-testers correctness audit — run with Claude Fable 5

> **Status: 🟢 Executed 2026-07-02 — see [results](./fable-audit-results).** 46 distinct
> confirmed findings (4 critical, 9 high). Scope was expanded beyond the three areas below
> with three extra finders: flow isolation (record ⇄ screenshot must never break each
> other), design conformance vs the docs guides, and main-flow UX improvements. Next step
> is triage, not re-running.

## Why

The aspect-ratio fix ([#12](./aspect-ratio-distortion), merged as `c3ec7fd`) plus the four
screenshot PRs (#13–#16) landed fast. Before real users touch the app, we want one deep
correctness pass over the parts that would ruin a testing session if they broke: the
recording pipeline, the screenshot editor, and the settings/IPC/persistence layer.

This is a **correctness** audit — real bugs, wrong output, crashes, stuck states — not a
security review and not a style pass.

## Model: Claude Fable 5 (`claude-fable-5`)

Run this audit with **Claude Fable 5**, Anthropic's most capable widely-released model. It
is meaningfully stronger at code review and debugging (higher recall _and_ precision on real
bugs), repository-history search, and parallel sub-agent delegation — exactly the shape of
this task.

Two things to keep in mind:

- **Cost.** Fable 5 is **$10 / $50 per million tokens (in/out)** — roughly 2× Opus 4.8. A
  broad audit is token-heavy; the scope below is deliberately bounded to the critical
  pipeline.
- **Security analysis is out of scope anyway.** Fable 5's improvements exclude
  security-focused analysis, and its safety classifiers can refuse cyber/bio tasks. That's
  fine here — we're after correctness bugs in a desktop screen recorder, not exploits.
- **Long turns.** Individual Fable 5 turns on hard tasks can run several minutes. That's
  normal — it's reasoning and self-verifying more. Prompt it with the **goal + constraints**,
  not step-by-step, and let it delegate to sub-agents and verify its own work.

**How to run it:** either switch the whole Claude Code session to Fable 5 via `/model` (if
the picker offers it), or keep an Opus 4.8 session as the orchestrator and spawn **Fable 5
sub-agents** with the model override — same result, isolated cost.

## Method

Not a single linear read. Fan out, then verify:

1. **Parallel finders** (Fable 5, effort `high`) — one per area below. Each sweeps its area
   for correctness bugs and returns candidates with file/line + a concrete failure scenario.
2. **Adversarial verification** (Fable 5) — every candidate goes to a verifier prompted to
   **refute** it. Only findings that survive refutation are reported. This kills
   plausible-but-wrong findings.
3. **Synthesis** — one ranked list by severity, each with a concrete repro, ready to decide
   what to fix before testers.

## Scope — three areas

### 1. Recording pipeline

The highest-stakes area; a bug here ruins every recording.

- **`recorder-engine.ts`** — the newly merged aspect-ratio path: `fitToCap()` (height-cap +
  source-AR width, even rounding, never-upscale), the native-ceiling capture, the measured
  `getSettings()` source size, and the **compositor-vs-raw** decision (`needsResize ||
watermark`). Check: odd/edge source dimensions, missing `getSettings()` values (fallback
  path), portrait/ultrawide/window sources, thumbnail sizing.
- **`recording-compositor.ts`** (renamed from `watermark-compositor.ts`) — uniform reframe
  preserving AR, high-quality downscale, watermark-optional, per-frame cost, the canvas track
  vs the original `screenTrack` for failure detection.
- **`shared/recording-quality.ts`** — presets, `qualityToEngine`, `sanitizeQuality`,
  bitrate/fps/resolution threading; the interaction with `fitToCap` now that
  `RESOLUTION_DIMENSIONS` is a height cap, not the frame.
- **Cross-window state** — the single source of truth for recording settings in the hub,
  broadcast to every window; `useRecordingSettings` (query-on-mount + subscribe + optimistic
  write); Record page ⇄ Capture Panel ⇄ camera-bubble sync; `display_id` resolution for the
  control bar; Dock/app-switcher restore on stop.
- **Mid-recording failure recovery** — `onError` routing (source `errorPromise` + screen
  track `ended`), the robust `stop()` (finalize-or-abort + always restore window/Dock/bar),
  `stoppingRef` double-teardown guard. Look for states where the app can get stuck or a
  window/Dock is left in the wrong mode.

### 2. Screenshots

- **Annotations** — freehand pen (smoothing), blur/redaction boxes, auto-select on create +
  resize handles, the scene model, compositor (SVG/canvas export). Watch the
  [clip-path + translate double-shift gotcha](/backlog/) and the crop viewBox rework.
- **Crop** — non-destructive, canvas/frame-relative (viewBox), native-pixel export.
- **Beautify** — backgrounds, padding, the beautified-frame export path.
- **Re-edit** — loading a saved scene back into the editor without loss.
- **Export** — PNG today; check dimension/quality correctness and the save/naming path.

### 3. Settings / IPC / persistence

- **`settings-store.ts`** — `settings.json` read/write, `settings:get/update` IPC, the OS
  side effects (`applyDockPolicy`), validation/merge purity.
- **IPC contracts** (`shared/types/ipc.ts`) — preload exposure vs main handlers vs renderer
  callers actually line up; no declared-but-unwired channels being called.
- **Permissions bridge** and **library vault** (`library-vault.ts`) — real disk vault,
  filters, the media protocol.

## What "done" looks like

A ranked list of **confirmed** correctness findings (severity-ordered, each with a concrete
repro and file/line), plus an explicit note of anything intentionally not covered. Then decide
per finding: fix before testers, or accept and track.

## How to resume in a fresh session

1. Open this doc.
2. Switch to Fable 5 (`/model`) or plan to spawn Fable 5 sub-agents.
3. Run the method above over the three areas. Start with **Recording pipeline** — it's the
   one that would most break a testing session.
4. When findings are fixed, fold the lasting lessons into the relevant `desktop/` reference
   doc and drop this from the backlog map.

Related: [aspect-ratio-distortion](./aspect-ratio-distortion),
[recording-compositor-perf](./recording-compositor-perf), [screenshots](./screenshots),
[settings-roadmap](./settings-roadmap).
