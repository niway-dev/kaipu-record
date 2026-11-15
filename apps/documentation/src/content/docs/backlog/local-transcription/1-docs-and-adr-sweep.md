---
title: "Local transcription research 1: docs and ADR sweep"
description: "Written by Claude Haiku, sweeping the docs, ADRs, Linear and hub pages for prior local-transcription work."
sidebar:
  order: 1
---

> Evidence, kept verbatim (2026-11-15, design of [NIW2-818](https://linear.app/niway/issue/NIW2-818/local-transcription-with-parakeet-transcript-panel-and-subtitle-export)). The [spec](/specs/2026-11-15-local-transcription-design/) wins where they disagree.

## Brief

Read-only sweep. Do not edit, commit or create anything.

## Report

## ADR titles

49 ADRs in `apps/documentation/src/content/docs/architecture/decisions/` (0001-0058, with gaps):

- 0001 Mediabunny (WebCodecs) over FFmpeg for the recording pipeline
- 0002 Plan entitlements kept as a module separate from auth
- 0003 An export never replaces the original recording
- 0004 Local-first verification with cloud release gates
- 0005 Draft → Ready for review is the release-candidate readiness signal
- 0006 The desktop E2E suite runs before the tag, not after it
- 0007 Production previews use Version URLs; a development environment waits for a writer
- 0008 Styles are written once, in StyleX, over one typed token source
- 0009 Shared UI components take no dependencies, and labels arrive as props
- 0010 Checks run in Actions on every pull request; the pre-push hook keeps only the fast ones
- 0020 Tags are entities with stable ids, kept in a registry inside the vault
- 0021 Tag sync is opt-in, event-driven, and ordered by a server version
- 0022 Screenshot capture is a mode request served by a per-platform backend; the overlay is shared UI that never captures
- 0023 One desktop release workflow with a build job per OS and a single publish job; Windows ships unsigned until a signing service exists, behind a hook that needs no workflow change
- 0024 Window capture through the OS window list on our overlay; a capture the preferences already handle never opens the editor
- 0025 The desktop signs in through the browser, with Better Auth's Electron plugin
- 0026 Zod is the only environment schema; no varlock, no .env.example
- 0027 Only release candidates are verified in Actions
- 0028 An advisory Claude review on pull requests, as inline review comments
- 0029 Floating windows never change the activation policy, and the policy setter checks AppKit before skipping
- 0030 A recording targets a display, an area or a window; an area is cropped in the recording compositor and the cursor sidecar is normalized to it
- 0031 The desktop app shuts down explicitly, newest first, with a deadline
- 0032 Workspaces — identity in the folder, the list in userData, one active at a time
- 0033 Moving an item between workspaces keeps its identity and never leaves zero copies
- 0034 Per-workspace setting overrides inherit from an all-workspaces level
- 0035 The vault file name follows the title
- 0036 The library reconciles with its folder on demand
- 0037 The webcam is recorded as its own track beside the screen, and the bubble is excluded from the capture
- 0038 The webcam is a viewport layer, composed after the zoom crop and after the output framing
- 0039 Camera sections move and resize the camera with a per-section eased transition, and hiding fades outside the hidden range
- 0040 The timeline keeps typed tracks shown on demand, plus stackable media lanes whose audio stays per source and is mixed at export
- 0041 The camera is a circle, a square or a 3:4 portrait rectangle, with an adjustable corner radius
- 0042 Capture and Copy both end in the preview card; the editor opens only when asked
- 0043 Capture has a destination preference; Copy only confirms
- 0044 The UI state catalog runs the real app on the Mac mini
- 0045 UI catalog images live in a separate repository
- 0046 A typed UI map declares every screen, area and state
- 0047 Native capture crops an area at the source, streams a window's geometry, and has no face-in-screen fallback
- 0048 The Console is admin-kit's panel, authorized by the kit's access policies
- 0049 Flags are a typed registry in code with state in our API; Labs is user opt-in, release flags are owner-only
- 0050 Track visibility is per-user view state; a hidden lane keeps its edits in the preview and the export
- 0051 The video background reuses the screenshot editor's beautify model and is drawn as the outermost composition step inside a fixed output size
- 0052 Release candidates verify only the component they ship
- 0053 The image editor is a canvas, saved as a document beside its flattened export
- 0054 Inspection tools read the pixels of a captured image, inside the editor
- 0055 Text recognition is a port, served by the operating system's engine on each platform
- 0056 The capture widget docks to the work area, not to the selection
- 0057 Clips is one section with levels — a gapless sequence at the bottom, floating items above it anchored to the footage under them
- 0058 Joined recordings share one source axis, each on its own fixed range

## Relevant hits

**ADR bodies (no ADR is about speech or AI):**

- `architecture/decisions/0021-tag-sync-on-events-with-server-version.mdx:19`: "Kaipu is local-first: a user without an account must keep every feature offline, forever."
- `architecture/decisions/0055-text-recognition-is-a-port-served-by-the-os-engine-on-each-platform.mdx:21-22`: "The repository forbids install scripts and keeps native code to one patched npm module and in-house Swift helpers." Its decision is a port in main with a per-OS engine and an "unavailable" fallback, the closest structural precedent for a speech port.
- `architecture/decisions/0001-mediabunny-over-ffmpeg.mdx:44`: removing FFmpeg avoids "~50–80MB of per-arch native binaries" (the bundle cost of native binaries).
- `architecture/decisions/0002-plan-entitlements-separate-from-auth.mdx:19`: "The desktop app burns a watermark into every recording unless the account is paid." Superseded in practice by the hub's free-tier page (below).
- ADR 0049 (flags) and ADR 0046 (UI map) govern how a captions toggle and a transcript panel would ship.

**Docs site (`apps/documentation/src/content/docs/`):**

- `marketing/ai-and-automation.md:35-36` (owner notes): "Transcription runtime: Parakeet, not Whisper. The owner already ships NVIDIA Parakeet TDT v3 (multilingual) in another product."
- `marketing/ai-and-automation.md:57`: "Local inference supports offline use but adds model download, hardware performance, and packaging work… A local-first library does not automatically mean offline AI."
- `marketing/ai-and-automation.md:115`: "transcription stays local. That split is consistent with 'local files, paid network layer.'"
- `marketing/ai-and-automation.md:170`: "Resolve pricing against the existing monetization ADR before assigning these capabilities to paid tiers."
- `backlog/product-growth.mdx:58`: P1 "Captions: Parakeet TDT v3 transcript with timestamps, correction, SRT/VTT export."
- `desktop/filesystem-first-monetization.mdx:148`: under "PAID — Kaipu Cloud / Pro": "Transcripción + resumen AI."
- `desktop/filesystem-first-monetization.mdx:152`: "Regla no-negociable: el valor pago vive en la capa de red/colaboración/hosting, nunca en features locales."
- `specs/2026-10-06-auto-polish-research.md:91`: "Only 'apply everything automatically', transcript or LLM work, and team presets are paid candidates."
- `specs/2026-10-06-auto-polish-research.md:330-331`: "Charging for a local automation conflicts with the monetization ADR ('never charge for local features')."
- `marketing/product-direction.md:153`: Cloud (individual) column includes "transcription."
- `backlog/free-tier-no-watermark.md:22-23`: "local features are free, the network layer is what is sold."

**Linear (team NIW2):**

- NIW2-530 (backlog), https://linear.app/niway/issue/NIW2-530/measure-parakeet-intra-op-threads-and-engine-warm-up-from-openwhispr: measures Parakeet thread count and engine warm-up. Its body is about the owner's other product (Yui), not Kaipu.
- NIW2-658 (unstarted), https://linear.app/niway/issue/NIW2-658/free-allowance-before-sign-in-3-conversations-with-ai-answers-then-the: a free AI allowance before sign-in. It is Yui, not Kaipu, but it is the nearest existing AI paywall pattern.

**Knowledge hub (`general-knowledge`, 13 files matched):**

- `desktop/local-speech-to-text.md` (commit cbb1905, 2026-09-26) is the main page. Its key sentences:
  - "An N-API speech addon cannot run inside Electron." `utilityProcess` "fails identically."
  - "So both families run as sidecars."
  - The transducer server "has **no VAD option at all**." A speech gate has to be built separately.
  - Model files are pinned by SHA-256, since "A version string is not identity."
- `desktop/native-dependencies.md:107` and `desktop/main-process-architecture.md:75` both point to this page for the sidecar rule and lifecycle.
- `README.md:32` and `desktop/README.md:23` index the page.
- `conventions/adr-pattern.md` (around line 110) cites the owner's other product's speech checkpoint benchmark as a measured ADR example.

## Contradictions or constraints

1. **Tier conflict (unresolved).** `filesystem-first-monetization.mdx:148` puts "Transcripción + resumen AI" in the paid tier. Its own rule at line 152 says paid value never lives in local features. The auto-polish spec calls transcript work a paid candidate. `ai-and-automation.md:115` says transcription stays local. A local Parakeet caption feature cannot be paid under the stated rule, so pricing is open until the monetization doc is reopened.
2. **"Monetization ADR" is not in the ADR folder.** The four docs that cite it link to `desktop/filesystem-first-monetization.mdx`, a Spanish design doc outside `architecture/decisions/`. No ADR number records the "never charge for local features" rule.
3. **Repo rule against install-time downloads.** Root `CLAUDE.md`: "`bun install` is not allowed to compile code, download binaries, or run anything you have not read." A Parakeet sidecar binary and model must arrive through an explicit setup or pull step, not a dependency install. The hub asks for SHA-256 pinning of each model file.
4. **Offline and model download.** ADR 0021 requires every feature to work offline for accountless users. A local model needs one download first, so the design must say what happens before that download and how the model is verified.
5. **Shape constraints for the feature.** A transcript panel needs ui-map entries and catalog states (`CLAUDE.md`, ADR 0046). `apps/kaipu-record/src/shared/**` may take only type imports from workspace packages, so the sidecar client cannot sit there with value imports. Gating should use a typed flag (ADR 0049).
6. **Engine constraint.** The hub says the transducer engine has no built-in speech gate, and a Parakeet design needs one upstream of the model.

## Nothing found in

- ADR bodies: no hits for whisper, parakeet, subtitle, caption, speech, STT, ASR, "AI" as a word, or model download.
- Docs-site `specs/` and `plans/`: no transcription spec or plan. Only the auto-polish research mentions it.
- Linear: no Kaipu issue about transcription, captions or subtitles, open or closed. The "whisper" query returned nothing. The other queries returned fuzzy title matches only (the "transcript" and "subtitle" hits were unrelated titles).
- Hub `conventions/` and `mobile/`: no transcription content beyond the ADR-pattern example.
