---
title: Website refresh — Capture, live demos, export, beta roadmap
description: UI-only refresh of kaipu.app so it shows today's capture flow, the desktop onboarding demos, the export presets, upcoming tools and a beta state on the roadmap, with a tighter mobile layout.
---

- **Status:** proposed (2026-11-20), built in GSD. Tracker: [NIW2-897](https://linear.app/niway/issue/NIW2-897).
- **ADRs:** none.

## Summary (one minute)

kaipu.app still shows recording and screenshots as separate chapters and an older UI. Today both
start from one capture widget (Screenshot P / Recording V, Frame / Screen, Free ratio, Capture).
This refresh merges the Record and Capture chapters into one Capture chapter built around the real
widget, ports the desktop onboarding demos (video editor, workspaces, edit and share) to the web,
gives the export-by-destination presets their own section, adds an "On the way" section for image
tools and camera moves, and adds a "Private beta" state to the roadmap for macOS features that
exist behind flags. Mobile gets single-column demo cards. Website UI only: no backend change.

## What changes

| Thing | Today | After |
| --- | --- | --- |
| Home chapters | 01 Record, 02 Capture, 03 Edit, 04 Find | Capture (one widget for both), Edit, Share, Find |
| Capture visual | Older mocks | The current capture widget, animated |
| Product demos | Static mocks | The desktop onboarding demos, running on the web |
| Export | One line in Edit | Its own section: GitHub · Slack · YouTube 1440p/4K · Reels 9:16 |
| Upcoming tools | Not shown | "On the way" section, each tile marked Private beta |
| Roadmap states | Shipped, In progress, Planned | Plus "Private beta" for flagged macOS features |
| Mobile (≤ 640 px) | Two-column mocks squeezed | One full-width card per demo, compact sections |

## Decisions

| # | Decision | Options considered | Chosen, and why | Assumed? | ADR |
| --- | --- | --- | --- | --- | --- |
| 1 | Product name | Rename to "Kaipu Capture"; keep "Kaipu Record" and merge chapters | Keep the name, merge the chapters | No, owner confirmed in chat | none |
| 2 | Label for flagged macOS features | "Beta"; "Coming soon"; "Private beta" | "Private beta": the code has no Labs page yet (ADR 0049 is design only), so no user can turn them on; "Private beta" is true and still says it exists | Yes, your call | none |
| 3 | Which features get Private beta | Every flag; only flags with merged code | Merged and flagged: text recognition (OCR), inspect (measure, colors), image canvas (grid, move), clips levels, zoom filmstrip, local transcription, screenshots while recording | Yes, your call | none |
| 4 | Camera moving over time | Private beta; Planned | Planned: the webcam track design is not fully merged | Yes, your call | none |
| 5 | Demo source | Copy the demos into web-hono; share a package | Copy into `apps/web-hono/src/components/demos/` with a header naming the source: a shared package is a refactor beyond this PR (follow-up) | Yes, your call | none |
| 6 | Copy languages | EN only; EN and ES | Both, the parity test requires it | No, owner said go | none |
| 7 | Release | One PR | One PR: website only, no flags, revert is one commit | No, repository practice | none |

## Out of scope

- Renaming the product, the Labs page in the desktop app, a shared demos package, new pages.

## Failures this must protect against

- A planned feature reads as available (brand rule): every upcoming tile carries its state badge.
- A demo animation burns CPU off screen or ignores reduced motion: demos pause when not visible
  and respect `prefers-reduced-motion`.
- ES copy missing a key: the parity test fails.
- Horizontal scroll at 375 px.

## Acceptance criteria

- [ ] **AC1** The home shows one Capture chapter with the current widget (Screenshot P / Recording V, Frame, Screen, Free, Capture); no "Record" chapter remains.
- [ ] **AC2** The editor, workspaces and edit-and-share onboarding demos run on the home page and stop animating under `prefers-reduced-motion`.
- [ ] **AC3** An export section lists GitHub · Jira · Linear, Slack · Discord · Email, YouTube 16:9 1440p or 4K, and Reels · TikTok · Shorts 9:16.
- [ ] **AC4** An "On the way" section shows OCR, measure, colors, image grid and move, and camera moves, each with its roadmap state badge.
- [ ] **AC5** The roadmap supports a `beta` state rendered "Private beta" (ES "Beta privada"), used by the rows in decision 3.
- [ ] **AC6** At 375 px width the home and roadmap have no horizontal scroll and each demo is one full-width card.
- [ ] **AC7** `web-hono` tests, typecheck and build pass, including the i18n parity test.
