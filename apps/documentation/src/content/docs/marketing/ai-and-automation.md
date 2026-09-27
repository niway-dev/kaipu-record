---
title: AI and automation opportunities
description: Technical feasibility and smallest useful experiments for captions, audio summaries, and agent-controlled editing.
---

# AI and automation opportunities

**Feasibility notes · 2026-09-27.** Relative effort estimates based on a targeted source review, not a full implementation design or delivery estimate. No provider, package split, inference runtime, or command protocol is selected. Any structural choice needs its own design and ADR before implementation.

## Current foundation

- `apps/kaipu-record/src/renderer/src/features/video-editor/session.ts` serializes and validates a versioned JSON edit session, including clips, overlays, zooms, and redactions.
- `export/export-plan.ts` builds the render plan; `export/use-video-export.ts` orchestrates export through a React hook, Electron IPC, a custom media URL, and a browser Worker.
- `export/overlay-raster.ts` uses DOM canvas creation. The worker path does not make the complete exporter runnable as a plain Node/Bun command.
- Exports use a fresh recording writer and preserve `derivedFromAssetId`; this is a useful non-destructive foundation.
- A targeted search of desktop source found no transcription or caption implementation. Ordinary UI subtitle labels are not video captions.
- The [standalone editor proposal](/backlog/standalone-editor/) already identifies external-file import and the single-source timeline as constraints. The existing cursor-track diagnostic CLI is not a product editing API.

## Opportunity order

| Opportunity                        | Smallest useful slice                                                    | Relative difficulty             | Main uncertainty                                                 |
| ---------------------------------- | ------------------------------------------------------------------------ | ------------------------------- | ---------------------------------------------------------------- |
| Automatic captions                 | On-demand transcript with timestamps, correction, SRT/VTT export         | Medium                          | Recognition accuracy, timing, inference runtime and distribution |
| Captions visible in exported video | One readable preset, preview/export parity                               | Medium–high after transcription | Layout, font rasterization, wrapping, and timeline mapping       |
| Audio-based summary                | Editable title and short summary linked to the transcript                | Low–medium after transcription  | Whether it saves enough writing and stays faithful               |
| Find by spoken words               | Search transcript text and jump to a timestamp                           | Medium after transcription      | Retrieval demand and source/output timestamp mapping             |
| CLI library inspection             | List/inspect existing items with structured output                       | Low–medium                      | Stable command contract and packaged-app access                  |
| CLI edit and export                | Apply a bounded recipe to one existing recording and create a new output | High                            | Reusing Electron export without UI orchestration                 |
| Agent takes any video and edits it | Import, inspect, propose edits, preview, export                          | High–very high                  | Input compatibility plus all CLI/export dependencies             |

“Low” means a narrow extension of an existing flow; “medium” introduces a meaningful subsystem or integration; “high” crosses runtime and lifecycle boundaries. These are not calendar promises.

## Owner notes (2026-09-27)

- **Transcription runtime: Parakeet, not Whisper.** The owner already ships NVIDIA Parakeet
  TDT v3 (multilingual) in another product. There is no reason to evaluate Whisper first:
  Parakeet v3 is faster on CPU, handles English and Spanish, and the packaging is a known
  quantity. The evaluation below is therefore "does Parakeet meet the bar on our clips," not
  a bake-off. Whisper stays as the fallback if a language Parakeet lacks becomes a priority.
- **Export presets** and **prompt-driven editing** are explained in their own sections below,
  because the owner asked how they would work.
- **Whisper versus Parakeet, briefly.** Whisper was trained on about 680k hours of audio
  paired with transcripts scraped from the web, much of it subtitle-style text. That is why it
  reads fluently and also why it sometimes paraphrases or invents words in silence. Parakeet
  TDT v3 is trained on curated speech corpora with a transducer architecture, which gives
  tighter word timestamps, far higher throughput on CPU, and a smaller model. For captions
  that must line up with a timeline, timestamps matter more than fluency, so Parakeet is the
  better fit. Its limit: v3 covers 25 European languages, so no Japanese, Korean or Chinese;
  if that becomes a need, Whisper is the fallback for those languages only.

## Captions first

The immediate value is understanding a recording without sound. Start after recording finishes; live captions, translation, speaker identification, and decorative word-by-word animation are separate problems.

Evaluate the same representative English/Spanish clips with technical terms, silence, noisy microphones, and long pauses. Compare timing, correction effort, latency, memory, and package/model size. SRT/VTT alone is useful only where the recipient's player supports it; burned-in captions are a separate export milestone.

Local inference supports offline use but adds model download, hardware performance, and packaging work. Hosted inference is often faster to prototype but introduces connectivity, cost, retention, and explicit audio-transfer UX. Neither option is selected. A local-first library does not automatically mean offline AI.

Captions must follow kept clips after trim/cut operations; source timestamps cannot simply be written into the final output. Avoid exporting transcript text from removed sections. Provide text correction, cancellation, visible failure, and a usable original recording when transcription fails.

## Summaries second

Generate from a transcript rather than adding a second audio pipeline. First output: an editable title and a few factual lines users can copy beside their recording. A bug-report draft is a possible format experiment, not a promise to diagnose the bug.

An audio-based summary knows what was said, not everything shown. It must not claim to understand a silent UI failure or invent reproduction steps. Link supporting timestamps, allow edits, and handle no-speech recordings plainly. Visual reasoning, OCR, and automatic sensitive-data detection are separate research items.

Measure how often users keep/copy the result, how much they correct it, and time saved versus writing their own description. Transcript search may eventually reinforce the library more strongly than a generic chat interface, but should wait for demonstrated retrieval demand.

## Export presets

A preset is a **named bundle of export settings** chosen for a destination, applied with one
click instead of six fields:

| Preset            | What it fixes                                                            | Why it matters                                                   |
| ----------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| GitHub issue / PR | MP4 under the 10 MB attachment limit, or GIF with loop, max 1280 px wide | The clip pastes into the issue without a "file too large" bounce |
| Slack / Teams     | MP4, 720p, capped bitrate, keeps audio                                   | Plays inline, uploads fast                                       |
| Docs / README     | GIF, no audio, looping, trimmed to the action                            | The format docs actually embed                                   |
| Full quality      | The current default                                                      | Unchanged                                                        |

Nothing here is AI. It is a table of encoder targets plus a size guard that re-encodes at a
lower bitrate until the file fits the limit. It is cheap, and it is the feature that makes
the "record a bug repro and paste it" story true end to end. It belongs in the export sheet
of the editor, and the GIF preset depends on [GIF export](/backlog/product-growth/) landing.

## Prompt-driven editing: how hard is it really

The owner's question: "could we give the app a prompt, or a video, and have AI modify parts
of it, and get that back in the editor?"

The honest shape of the answer is that it is **three layers**, and only the top one is AI:

1. **A deterministic edit API.** Every edit the editor can make (trim a range, cut a range,
   add a zoom at a time, add a text annotation, blur a rectangle, change speed on a range)
   already exists as a change to the versioned edit-session JSON. Exposing those as named
   commands with a stable schema is plumbing, not research. This is the same work the CLI
   needs. Difficulty: medium.
2. **Signals the model can reason over.** A prompt like "cut the part where I was looking
   for the file" is unanswerable without a transcript with timestamps (Parakeet, above), the
   cursor track the app already records, and silence detection. With those, the model has
   something to point at. Difficulty: medium, and captions deliver most of it.
3. **The model turns a request into a list of commands, and the user reviews it.** Given
   the schema from (1) and the signals from (2), a Claude call returns a proposed edit list;
   the editor shows it as pending changes on the timeline; the user accepts or discards. The
   session format is already non-destructive
   ([ADR 0003](/architecture/decisions/0003-export-never-replaces-the-original/)), so a bad
   proposal costs nothing. Difficulty: low once (1) and (2) exist.

So: **it is not hard, it is sequenced.** The trap is starting at layer 3 with a chat box and
no command schema underneath. Build the commands, then the signals, and the prompt is the
last and smallest step. This is the same sequence the CLI section below describes, which is
why the two features share one foundation.

Hosted inference is the natural choice for layer 3 (a short structured call per request);
transcription stays local. That split is consistent with "local files, paid network layer."

## CLI and agent editing

**What the CLI would do** (owner question, 2026-09-27), in the order it would be built:

```
kaipu screenshot                    # capture the whole screen, exactly like the menu-bar
                                    # screenshot button but without the region picker;
                                    # saves to the library and prints the PNG path
kaipu screenshot --region           # the interactive picker, for completeness
kaipu record --screen 1 --mic       # start a recording from a script or a launcher
kaipu stop                          # stop and print the path of the MP4
kaipu list                          # the library as JSON: id, title, duration, path
kaipu export <id> --preset github   # export an existing recording with a preset
kaipu trim <id> --from 0:12 --to 1:04 --out <path>
kaipu open <id>                     # open it in the editor
```

`screenshot` and `record` come first: they are the commands a launcher needs, and they reuse
the app's existing capture paths over IPC rather than a second implementation. The editing
commands follow once the edit API exists.

**Integrations built on the CLI** (owner request, 2026-09-27; a friend of the owner asked for
this specifically):

| Surface                                     | What it looks like                                                                                | Cost once the CLI exists              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Raycast / Tinycast extension                | "Kaipu: Screenshot", "Kaipu: Record", "Kaipu: Stop", "Kaipu: Open library" as commands with icons | Low: a thin extension calling the CLI |
| Finder Quick Action (Shortcuts / Automator) | Right-click a recording → "Export for GitHub", "Trim in Kaipu"                                    | Low: a Shortcut that runs the CLI     |
| Shell alias / Stream Deck                   | `kaipu record` bound to a key                                                                     | Zero                                  |
| Agents                                      | The same commands with `--json` output                                                            | Zero                                  |

Who uses it: people who want to capture and record without touching the app, plus scripts,
test suites that record their own failures, and agents. It is the automation surface the
prompt-driven editing above sits on, and it is the kind of feature developers write about.

**Related, already shipped:** the menu-bar-only mode (Settings → App → "Dock app" off) hides
Kaipu from the Dock and ⌘-Tab. The owner's note is that it exists but people do not find it;
the fix is copy, not code. See the [Dock decision](/backlog/dock-and-app-switcher/).

The monorepo helps share types and pure logic. It does not provide an automation interface by itself. Distinguish **developer scripts for maintaining Kaipu**, **a product CLI that controls Kaipu**, and **an agent that chooses edits through that CLI**. The owner request is primarily the latter two, not autonomous source-code modification.

A useful eventual journey is: inspect a recording → select ranges or apply a preset → preview the edit → export a new file. Start with exact, deterministic edits on an existing library recording before accepting natural-language instructions or arbitrary external files.

Research must compare an app-backed command runner with a standalone rendering runtime. The former may reuse Chromium capabilities but needs launch/lifecycle coordination; the latter requires replacing or adapting browser/Electron dependencies. Do not silently build a second FFmpeg exporter with different output semantics.

The feasibility spike should prove one trim/export outside the visible editor, preserving audio timing, original files, cancellation behavior, and source lineage. It should also identify a stable schema, structured errors/progress, app/CLI version compatibility, and behavior when the UI edits the same session. Directly overwriting private sidecars is not a supported command API.

Only after deterministic commands work should an agent translate a request into a bounded edit recipe. A phrase such as “remove the irrelevant part” requires interpretation and review; it is not equivalent to trimming an explicit range. Imported videos may have no cursor track, so current auto-zoom detection cannot be presumed to apply.

## Scope and monetization

First AI experiment: captions. First automation experiment, if repeated user demand warrants it: one deterministic trim/export spike. No general autonomous editor, multi-source timeline, MCP server, or chat panel is committed here.

Hosted AI has ongoing costs; local AI has packaging and support costs. Resolve pricing against the existing [monetization ADR](/desktop/filesystem-first-monetization/) before assigning these capabilities to paid tiers. Track execution in the [growth roadmap](/backlog/product-growth/).
