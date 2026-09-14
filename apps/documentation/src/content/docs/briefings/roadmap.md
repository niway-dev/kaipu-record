---
title: Roadmap
description: Where Kaipu Record actually is right now — shipped, in flight, and next.
---

# Roadmap

**Last reviewed: 2026-09-02.** Status determined from GitHub PR history
(`gh pr list --state merged|open` against `csdev19/kaipu-record-monorepo`) — this
repo has real, usable PR history, so no `git log` fallback was needed.

## Shipped

| Capability                                                                                                                                        | Where it landed              |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Core recording (screen + camera bubble, floating control bar, configurable quality, correct aspect ratio, mid-recording/restart failure recovery) | #2, #4, #12, #17–#25         |
| Screenshots — capture, crop, freehand pen, blur redaction, auto-select, resizable/multi-line/re-editable text annotations                         | #13, #14, #15, #50, #51, #52 |
| Quick video editor — timeline, cut/trim, annotations, slides, MP4 export via mediabunny                                                           | #28                          |
| macOS distribution — signed + notarized builds, GitHub Release pipeline, `electron-updater` auto-update via an R2 feed, version-gate kill-switch  | #3, #6, #7                   |
| Feature flags + analytics (PostHog, offline-safe), watermark free→paid seam                                                                       | #2                           |
| i18n — shared en/es message catalog wired through web + desktop                                                                                   | #31, #32                     |
| Shared design-tokens package — dark + light themes, contrast-tested                                                                               | #38, #39, #42                |
| Landing page — feature showcase with looping demo clips                                                                                           | #45, #47                     |
| Library self-healing (recover metadata/thumbnails for imported or interrupted recordings)                                                         | #43, #44                     |
| Global shortcuts + window reachability from any route                                                                                             | #4, #20                      |
| End-to-end test harness (Playwright + Electron)                                                                                                   | #30                          |
| Pre-launch correctness audit — 46 findings, 31 confirmed and fixed                                                                                | #17–#25                      |
| Per-project CI/release pipelines + `release-please` (desktop/web/api version independently)                                                       | #33, #37                     |

## In flight

- **Cloud recordings — accounts + R2 upload (backend).** PR #53 (open): the full
  domain → application → infra-storage → oRPC vertical for uploading a local
  recording to a private, per-user R2 vault via a presigned PUT, confirmed and
  listed through auth-gated `/api/v1/recordings/*` routes. This documentation
  session's own branch (`feat/cloud-recordings-r2-backend`) has further,
  **uncommitted** work on top: contract cleanup (`shared.contract.ts`),
  storage-key layout alignment, a 7-finding correctness review (fixed), and a
  **full local end-to-end validation** (2026-09-02) against the real
  `kaipu-private-bucket` and Postgres — sign-up through delete, all green. Still
  blocked on: production Worker secrets, and the **desktop upload UI** (none of
  that exists yet). A follow-up review also flagged five gaps to close before this
  is production-ready for real accounts — R2 CORS for the Electron origin,
  stronger `confirm` (verify declared size/type, not just existence), a cleanup
  policy for stuck `pending` rows, the Desktop auth/session flow itself, and
  per-user quotas. See
  [Before integrating with Desktop](../backlog/cloud-recordings-upload#before-integrating-with-desktop).
- **`release-please` proposal for desktop v0.5.0.** PR #54 (open, auto-generated) —
  will merge once the changes it bundles (including whatever lands from #53) are
  ready to cut.
- **Design-tokens light theme — production review.** Shipped in code (#38, #39,
  #42) but hasn't had its production visual review pass yet.

## Next

Sourced from the project's own living backlog
([backlog index](../backlog/), [kill-order roadmap](../backlog/roadmap)) — not
promoted from a speculative plan doc.

- **Finish cloud recordings end-to-end**: backend is built and validated locally
  (see above); next is closing the five production-readiness gaps (CORS, confirm
  strength, pending-row lifecycle, Desktop auth, quotas — recommendation: decide
  CORS and Desktop auth together, since "upload from main vs. renderer" drives
  both) and building the **desktop upload UI**. See
  [cloud recordings backlog](../backlog/cloud-recordings-upload) and
  [R2 storage architecture](../backlog/r2-storage-architecture).
- **Telemetry opt-out toggle** in Settings — flagged as a follow-up when PostHog
  flags shipped; no user-facing opt-out exists yet.
- **Editor toolbar responsive layout** and **additional export formats** (PDF,
  today only PNG) — proposed, not started.
- **Screenshot non-destructive re-edit** (a "scene doc" model) — proposed, analysis
  only.
- **Hardware-accelerated encode** (VideoToolbox/NVENC) and **native screen capture**
  (ScreenCaptureKit) — ideas, not started; encode currently runs in the renderer
  via WebCodecs, and capture goes through `getDisplayMedia()`.

## Proposals added after the last full review

- **🔵 Typed styles with StyleX across desktop and web** (2026-09-12) — pending
  analysis; no migration started. Evaluate typed token references, replacing
  Tailwind/CSS Modules, and shared primitives. See the
  [proposal](../backlog/stylex-migration). This addition does not revalidate the
  shipped or in-flight statuses above.
