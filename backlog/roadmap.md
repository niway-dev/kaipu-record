# Kaipu Record — Backlog

Living backlog. We kill these **one by one**; each is marked done when shipped
(code + tests + docs). Product is **offline-only until the first prod upload** — no
cloud/Cloudflare work for now.

Status legend: ⬜ todo · 🔨 in progress · ✅ done

---

## Kill order

| # | Feature | Priority | Status | Depends on |
| - | ------- | -------- | ------ | ---------- |
| 1 | Camera bubble (floating window) | High | 🔨 | — |
| 2 | Start recording from the Capture Panel (#4) | High · easy | ⬜ | — |
| 3 | Floating bar on the recorded display (#7) | High · easy | ⬜ | — |
| 4 | Feature flags via PostHog | Medium | ⬜ | — (base for #6) |
| 5 | Configurable quality (non-technical copy) | Medium | ⬜ | — |
| 6 | Watermark, free → paid (scalable plan) | Medium | ⬜ | #4 + plan/entitlement |
| 7 | Builds + distribution | Medium | ⬜ | — (parallel) |

---

## 1 — Camera bubble 🔨

A floating, always-on-top **webcam bubble** (circular), like the control-bar widget:
draggable, and **captured into the recording because it's on screen** (no canvas
compositing).

**Decisions (locked):**
- Approach: **floating window**, captured by the screen recording (not CanvasSource).
- Appears when the **Camera toggle is on** (preview + position before recording, stays
  during).
- The **control bar is excluded from the video** (`setContentProtection(true)`); the
  camera bubble is NOT protected so it IS captured. (Verify exact macOS behavior on impl.)

**Scope (v1):** new `camera-bubble-window` (frameless/transparent/always-on-top, drag
region) showing the live cam via the existing tested `useCameraPreview`; IPC to show/hide
it from the Camera toggle; control bar gets content-protection. Reuses `useCameraPreview`
(already tested), so little new untested surface.

**Follow-ups:** camera device picker, resize/shape options, sync the bubble with the
Capture Panel's camera toggle (v1 is driven by the Record page).

## 2 — Start recording from the Capture Panel (#4)

Today the panel's **Start** just opens the main window (recording runs in the main
renderer, not the transparent panel). Make panel **Start** trigger recording in the main
window directly: panel → IPC → main shows the window + runs its `startRecording`. One-click
record from the tray.

**Open question:** which settings win when started from the panel — the main window's
setup (recommended, since recording runs there) — both default to the same source via
`useSourceSelection`.

## 3 — Floating bar on the recorded display (#7)

Multi-monitor only. The bar currently positions by **cursor** display; place it on the
**recorded** display. Plumb the source's `display_id` (from `desktopCapturer`) through
`RecordingStartInfo` → hub → `ControlBarWindow.position()`. Single-monitor: no change.

## 4 — Feature flags via PostHog

Add PostHog + a thin flag/entitlement layer. Foundation for #6 (watermark gating) and for
rolling out #1/#5/#7. Needs: SDK init (main or renderer), a `useFlag(name)` helper, and a
way to define flags. Keep it offline-safe (flags default sensibly when offline).

## 5 — Configurable quality (non-technical copy)

Expose resolution / fps / bitrate in Settings (currently hardcoded 1080p/30/auto), wired
into `recorder-engine`. **Hard requirement:** each control has **plain-language copy** for
non-technical users explaining what raising/lowering it does (size vs sharpness vs
smoothness), not just numbers.

## 6 — Watermark, free → paid (scalable plan)

A watermark drawn on the recording **only for free users**; paying removes it. The
definition of "paid" must be a **configurable, scalable plan/entitlement** (driven by #4's
flags / an entitlement check), not a hardcoded boolean. Watermark itself is a draw pass
(canvas compositor — the same `videoProvider` seam as the camera, if we composite; or a
burned overlay).

## 7 — Builds + distribution

electron-builder config, macOS **code signing + notarization**, an **auto-update** channel,
and a release/distribution plan (where the app is hosted/served). Largely independent of
the feature work; can run in parallel.
