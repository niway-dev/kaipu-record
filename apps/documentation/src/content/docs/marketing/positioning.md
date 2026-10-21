---
title: Positioning Kaipu beyond beautiful recordings
description: A workflow-led competitive strategy, landing direction, and evidence boundaries for the Recordly comparison.
---

# Positioning Kaipu beyond beautiful recordings

**Working proposal · 2026-09-27.** Product and market hypotheses, pending user validation.

## Owner decisions (2026-09-27)

Taken after the Recordly review; the rest of this page is the reasoning around them.

| Decision                                                                                                        | Where it lives                                                                |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| The free app ships **without a watermark**; a "Made with Kaipu" badge stays as an opt-in toggle, off by default | [Free tier without watermark](/backlog/free-tier-no-watermark/) — implemented |
| **No Tauri rewrite.** The June ADR stands; Recordly is Electron too, so the framework is not the gap            | [Electron vs Tauri](/desktop/electron-vs-tauri/)                              |
| **Open source under AGPL-3.0**, the whole monorepo, at launch, after the security pass                          | [Open source](/marketing/open-source/) — license already switched             |
| **Windows ships as a recording-only beta** without waiting for screenshots                                      | [Windows beta](/backlog/windows-beta/)                                        |
| Message reinforcement runs on four fronts: landing, product, content, long-term trust                           | [Messaging playbook](/marketing/messaging-playbook/)                          |
| Benchmarks page and comparison pages: **low priority**, comparison pages must stay respectful                   | [Messaging playbook](/marketing/messaging-playbook/)                          |
| GIF export, keystroke visualizer, captions with Parakeet, silence cutting and a CLI join the roadmap            | [Product growth](/backlog/product-growth/)                                    |

## Where Kaipu stands against Recordly

Said plainly so the strategy is not built on flattery.

**Recordly is ahead today on:** Windows and Linux, output polish (backgrounds, padding, shadow,
cursor motion blur and click bounce, GIF with loop), "free with no watermark" as a headline,
and open-source traction. The first two are being closed (Windows beta, the beautiful-default
slice, GIF); the third was closed on this branch; the fourth is the open-source plan.

**Kaipu differentiates on:**

1. **The audience and the loop.** The person who records ten things a day, not the person
   producing one demo. `⌘⇧R → record → trim → export`, not "make a video."
2. **Filesystem-first library.** A folder with atomic sidecars, metadata that travels with
   the files, crash recovery, lineage between a recording and its exports. Recordly saves
   isolated `.recordly` project files.
3. **Video and screenshots in one app.** Recordly is video only.
4. **A reliable pipeline.** WebCodecs with hardware encoding, a seekable MP4 from the first
   frame. Recordly's documented weak spot is FFmpeg export crashes and audio desync.
5. **A maintained, signed product.** Notarized builds, auto-update, version gate, legal pages,
   tests and CI gates. Recordly's macOS binaries are unsigned and the project had a two-month
   outage.
6. **Capture without opening the app.** Global shortcuts and the widget.

Points 4 and 5 are only claims until the [benchmarks](/marketing/messaging-playbook/#the-benchmarks-page)
and the trust strip put evidence beside them.

## Competitive picture

[Recordly's official landing](https://recordly.dev/) was reviewed during the initial discussion. It promises “Make beautiful screen recordings” and advertises auto-zoom, animated cursors, backgrounds, a dynamic webcam bubble, timeline editing, microphone/system audio, `.recordly` projects, MP4/GIF exports, and a free open-source product without hidden limits. Its page identifies demos, walkthroughs, and product videos as use cases.

The owner's research also reported cross-platform support, AGPL licensing, unsigned macOS builds, maintenance interruptions, export/audio issues, competing forks, and an ambiguously related premium domain. Those details were not independently verified in this session. They are research leads, not approved comparison-page claims. The cited secondary leads were ScreenKite, iTechGuides, TheSweetBits, a “Recordly is back” blog post, GitHub, and recordly.vip; exact article URLs and applicable versions still need verification.

Recordly's visible strengths are output polish, a clear promise, and free positioning. Cross-platform availability would be another advantage if confirmed for current releases. Do not build our story around a maintainer's personal circumstances or presume those weaknesses persist.

## The customer and the moment

Initial audience hypothesis: people building software who repeatedly explain bugs, UI changes, feedback, and internal walkthroughs.

This is not an exclusive “developers versus marketers” division. Recordly can serve developers too. Differentiate by the task:

| Moment                            | User need                                 | Kaipu opportunity                                        |
| --------------------------------- | ----------------------------------------- | -------------------------------------------------------- |
| Publish a polished demo           | Presentation and production control       | Competitive parity only where it helps the core workflow |
| Show what is happening now        | Fast capture and an understandable result | Primary acquisition wedge                                |
| Find what was explained last week | Retrieval and reuse                       | Library-led retention                                    |

Other competitors include a long written explanation, a repeated call, and files lost on the desktop.

## Translate capabilities into benefits

| Capability                          | User-facing value                          | Evidence needed                                                            |
| ----------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| Global shortcuts and capture widget | Start without breaking your flow           | Demonstrate the real shortcut and capture sequence                         |
| Video and annotated screenshots     | Choose the fastest way to explain          | Complete both workflows with current builds                                |
| Trim, zoom, annotations, redaction  | Make the point clear                       | Preview/export parity and readable output                                  |
| Filesystem-first library            | Your files stay yours and are easy to find | Demonstrate Finder access, search, and metadata behavior                   |
| Original/export lineage             | Return to the source and reuse your work   | Validate navigation in the packaged app                                    |
| Recovery and distribution work      | Confidence in daily use                    | Version-specific recovery checks and signed/notarized release verification |

Atomic sidecars and lineage are supporting mechanisms, not hero copy. Recordly could add a library; our advantage must be execution and accumulated workflow value, not alleged impossibility for a competitor.

The earlier phrase “Recordly makes a beautiful video once; Kaipu is where all your recordings live” captures an internal intuition, but is unsuitable as a literal comparison: Recordly supports repeat use. A standalone articulation is **“Capture it. Make it clear. Find it again.”**

## Landing proposal

**Hero:** “Show it. Get back to work.”

**Supporting copy:** “Capture a bug, explain a change, or annotate a screenshot. Make it clear, and keep everything in a library on your Mac.”

**CTA:** “Download for macOS.”

Show a real result together with the library, rather than only a video inside a decorative frame. Follow with:

1. **Capture without breaking your flow:** shortcut to recording or screenshot.
2. **Make the point clear:** trim, annotate, and hide sensitive details.
3. **Find it when you need it again:** search, source, and exports.
4. **Keep your files:** show the actual folder and explain local ownership.
5. **Trust evidence:** supported systems, current distribution facts, and specific tested recovery behavior.

Reuse the existing [landing showcase](/backlog/landing-redesign/) and demo infrastructure. Prototype copy and a short, authentic bug-report journey before a broad redesign. Check light/dark, mobile, keyboard access, and reduced motion. Localize approved copy through the existing i18n catalog.

Validate whether prospective users can explain the product after seeing the page, then observe download-to-first-use and repeat use. Confirm instrumentation coverage before promising dashboards or numerical uplift.

## Reliability and pricing boundaries

WebCodecs does not guarantee hardware acceleration on every system. FFmpeg does not imply software-only encoding. Signing/notarization does not prove crash recovery. Avoid “never lose a recording,” “flawless sync,” and unconditional performance comparisons. Prefer specific demonstrations and measured conditions.

The watermark tension is resolved: the free app carries no watermark
([decision](/backlog/free-tier-no-watermark/)), in line with the
[monetization ADR](/desktop/filesystem-first-monetization/). Removing it is not a revenue
model by itself; the revenue stays in the cloud layer, and the Kaipu-branded share page takes
over the marketing job the watermark was doing.

## What not to chase now

Full cursor-effects parity, a general-purpose video editor, and a broad theme marketplace.
Windows is **not** on this list any more: the build works, and the owner decided to ship it as
a recording-only beta ([plan](/backlog/windows-beta/)) rather than wait for parity.
