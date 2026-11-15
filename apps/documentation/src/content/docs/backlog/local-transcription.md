---
title: Local transcription with Parakeet
description: Transcribe recordings on the user's machine with NVIDIA Parakeet, show the transcript in an editor side panel that follows the edit, and export SRT, VTT and TXT.
---

> 🔵 Proposed: [NIW2-818](https://linear.app/niway/issue/NIW2-818/local-transcription-with-parakeet-transcript-panel-and-subtitle-export).
> Design: [spec](/specs/2026-11-15-local-transcription-design/),
> [ADR 0062](/architecture/decisions/0062-speech-recognition-runs-in-a-bundled-sherpa-onnx-cli-with-a-downloaded-pinned-model/) (engine and model download),
> [ADR 0063](/architecture/decisions/0063-a-transcript-is-stored-per-recording-in-source-time-and-projected-through-the-edit/) (transcript file and projection).

## What

Kaipu turns a recording's speech into words with timestamps, locally, after a one-time model
download the user agrees to. The editor gets a **Transcript** panel in its right column: the text
of the edited video, with click to seek and the spoken word highlighted during playback. The
transcript exports as **SRT, VTT or TXT**, timed to the edited video.

## Phases

The spec's [Phases](/specs/2026-11-15-local-transcription-design/#phases) section has the scope and
the acceptance criteria of each.

1. **M0** — spike on 5, 20 and 60 minute recordings; numbers into ADR 0062.
2. **M1** — the engine, the consented model download, and the transcript file.
3. **M2** — the Transcript panel.
4. **M3** — SRT, VTT and TXT export.

Later: a separate microphone track, word corrections, burned-in captions, more models, Windows.

## Research

Kept verbatim; the spec wins where they disagree.

1. [Docs and ADR sweep](/backlog/local-transcription/1-docs-and-adr-sweep/)
2. [Kaipu audio and editor code](/backlog/local-transcription/2-kaipu-audio-and-editor-code/)
3. [invisible-assistant prior art](/backlog/local-transcription/3-invisible-assistant-prior-art/)
4. [Subtitle formats and protocols](/backlog/local-transcription/4-subtitle-formats-and-protocols/)
5. [Parakeet runtimes](/backlog/local-transcription/5-parakeet-runtimes/)
6. [Competitor transcript UX](/backlog/local-transcription/6-competitor-transcript-ux/)
7. [Weak points: engine pipeline](/backlog/local-transcription/7-attack-engine-pipeline/)
8. [Weak points: transcript model and panel](/backlog/local-transcription/8-attack-transcript-model-and-panel/)
