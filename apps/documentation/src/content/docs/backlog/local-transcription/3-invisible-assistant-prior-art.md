---
title: "Local transcription research 3: invisible-assistant prior art"
description: "Written by Claude Sonnet, researching Parakeet prior art in the invisible-assistant codebase."
sidebar:
  order: 3
---

> Evidence, kept verbatim (2026-11-15, design of [NIW2-818](https://linear.app/niway/issue/NIW2-818/local-transcription-with-parakeet-transcript-panel-and-subtitle-export)). The [spec](/specs/2026-11-15-local-transcription-design/) wins where they disagree.

## Brief

Read-only investigation. Do not edit, commit, install or run anything heavy. Repo: `~/Documents/Workspace/Personal/invisible-assistant` (use the main checkout; ignore `.claude/worktrees/`). It is a desktop app where the owner already ran NVIDIA Parakeet locally and found it better than Whisper. We want to reuse what they learned in another Electron app (Kaipu Record, a screen recorder) to transcribe recordings offline and produce subtitles + a transcript with word timestamps.

## Report

Parakeet v3 (int8) runs as a child process, sherpa-onnx's offline websocket server. The app bundles that server, signs it with the app, and downloads the weights separately. Every item below comes from reading the repo. I ran no benchmark myself.

## 1. Runtime, packaging, launch, model files

- **Runtime:** `sherpa-onnx-offline-websocket-server` v1.13.8 (prebuilt `osx-arm64-shared-no-tts`), launched with `--model-type=nemo_transducer` (`apps/desktop/src/main/transcription/sherpa-process.ts:31,94-105`).
- **Why a child process:** `sherpa-onnx-node` throws "External buffers are not allowed" inside Electron 44.1.1. `utilityProcess` runs the same Node, so it fails too (`sherpa-process.ts:12-17`, ADR 0017).
- **Launch:**
  - The app spawns the binary with stderr piped (`sherpa-process.ts:180-185`).
  - It sets `DYLD_LIBRARY_PATH` to the `lib/` directory. The binary also finds `libonnxruntime.dylib` through its `@loader_path/../lib` rpath (`:182-184`, ADR 0024).
  - There is no `/health` endpoint. Readiness is a real decode of 100 ms of silence over websocket, probed every 250 ms, with a 60 s timeout (`:57,132-171,177`).
  - A malformed payload kills the server process (`:24-26`).
  - Shutdown is SIGTERM, then SIGKILL after 3 s (`:245-251`).
  - An orphan record written at spawn lets a later launch reap a ~1.2 GB leftover child (`:208-223`).
- **Packaging (ADR 0024):**
  - Executables ship in `extraResources` at `Contents/Resources/engines/`, signed and notarized with the app. Weights are downloaded.
  - `apps/desktop/scripts/stage-engines.sh` copies only the server and one dylib (44 MB total with llama-server). It refuses non-arm64 files and writes `engines/manifest.json` with SHA-256s.
  - CI builds the engines inside `release-desktop.yml`. The release is arm64 only.
  - Engines are signed with `entitlements.mac.inherit.plist`, which dropped `com.apple.security.inherit` because the app is not sandboxed (ADR 0024 amendment).
  - The locator checks bundled resources first, then `userData/runtimes/sherpa-onnx/v1.13.8` (`sherpa-process.ts:64-69`).
- **Known gap:** the sherpa-onnx archive itself has no pinned checksum (`setup-local-sherpa.sh:17-19`, ADR 0024 "Still open").
- **Model files:**
  - They are downloaded, not bundled, to `<userData>/models/parakeet/parakeet-tdt-0.6b-v3-int8/` (`sherpa-process.ts:85-87`).
  - The pinned source is Hugging Face `csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8` at revision `2bda32ec…` (`apps/desktop/src/shared/models/parakeet-catalog.json`).
  - It is four files with per-file byte counts and SHA-256: `encoder.int8.onnx` 652 MB, `decoder` 11.8 MB, `joiner` 6.4 MB, and `tokens.txt` 94 KB. The total is about 642 MB.
  - `parakeet-download.ts:49-99` fetches each file resumably into a `.partial` staging directory, checks SHA-256, then renames the whole directory in one step. The engine therefore never sees a half-installed checkpoint.

## 2. Checkpoint, quantization, language

- **Checkpoint:** `parakeet-tdt-0.6b-v3`, int8 ONNX. ADR 0022 chose v3 over v2 because v2 hears English only. The four files are one unit, so v3 installs beside v2 and is never updated in place.
- **Language handling:** the transducer has no language argument. The app does not set a language, and the engine reports none (`lang` was empty in the smoke test). v3 covers 25 languages, and the catalog states the 25 tags, not `["*"]` (ADR 0022 decisions 2-3).
- **Routing English to v2 is disproved:** v2 on Spanish scores 82.18% WER and returns confident half-Spanish, not an error (ADR 0025 "Alternatives rejected").
- **Threads:** the server runs with `--num-work-threads=4`. On an M5 Pro, 2 threads gave a 278 ms median per segment and 4 gave 84 ms (`sherpa-process.ts:89-93`).

## 3. Measured results

- **WER, M4 Pro 24 GB, 300 segments per corpus** (`docs/learning/2026-09-26-parakeet-v3-vs-whisper.md`; ADR 0022 and 0025):

| Corpus                   | Whisper turbo | Parakeet v2 | Parakeet v3 |
| ------------------------ | ------------- | ----------- | ----------- |
| LibriSpeech, English     | 3.75%         | 1.85%       | 2.45%       |
| FLEURS, English          | not run       | 6.00%       | 9.22%       |
| FLEURS, Spanish (es_419) | 6.91%         | 82.18%      | 4.54%       |

- **Per-segment latency on that run:** Whisper p50 is about 1150-1280 ms. v3 is 226 ms on LibriSpeech and 330-394 ms on FLEURS, with p95 between 600 and 720 ms.
- **Earlier spike, v2, M5 Pro** (`docs/learning/2026-09-22-streaming-stt-spike.md`, ADR 0017):
  - WER on LibriSpeech was 1.73% for v2 against 3.60% for Whisper.
  - Peak RSS was 1.21 GB for Parakeet against 1.65 GB for Whisper.
  - Weights were 0.63 GB against 1.62 GB.
  - Parakeet ran on CPU only. Whisper used Metal.
  - With a Qwen 4B model generating, Parakeet's median was 195 ms and Whisper's was 1472 ms.
  - The sherpa CLI measured an RTF of 0.049.
  - Those v2 numbers describe a checkpoint the app no longer installs (ADR 0022 Consequences).
- **Owner voice, 47 segments, 153 s of audio** (`.stt-bench/own-*.jsonl`, computed by me from the logs):
  - With 2 threads, Parakeet had p50 278 ms and an RTF of about 0.11.
  - With 4 threads: p50 84 ms, p95 297 ms, RTF about 0.036.
  - With 8 threads: p50 74 ms, RTF about 0.035.
  - Whisper: p50 879 ms, RTF about 0.27.
  - Treat these as per-segment decode speed, not file-level throughput. The audio had already been cut into segments.
- **Not measured:** Parakeet v3 memory, and Spanglish, accents or crosstalk. The v3 smoke test used two clear studio clips only (ADR 0022 "What was verified"). I found no v3 RSS figure.

## 4. Streaming vs batch, feeding, timestamps

- **Audio is cut into segments, and each segment is decoded as a batch.**
  - The app's energy VAD (`packages/overlay-core/src/vad.ts`) closes a segment after 560 ms of silence. The maximum segment length is 12 s (`vad.ts:108`).
  - Input is 16 kHz mono 16-bit WAV, which the service enforces (`transcription-service.ts:1197`). The port decodes it to float32 (`sherpa-transcription.ts:32-54`).
  - The wire format per utterance is 4 bytes of little-endian sample rate, 4 bytes of payload length, then float32 samples in frames of at most 10 KiB. There is one websocket connection per segment (`sherpa-transcription.ts:11-17,29,56-63`).
- **Cutting short and re-decoding was measured but not built** (the "provisional" layer, streaming-stt-spike §6).
- **Timestamps are produced and used.**
  - The reply carries `tokens`, `timestamps` in seconds from the segment start, and `ys_log_probs`.
  - `wordsFromTokens` merges sub-word pieces into words, starting a new word at a leading space or `▁`. A word ends where the next begins, and the last ends at the audio length (`sherpa-transcription.ts:97-144`). These words drive the call replay highlight.
  - Timestamps are per token, so word ends are inferred from the next word's start, not measured.
  - ADR 0023 originally left timestamps unread (Non-goals), but the code now uses them.
- **Transcripts spell numbers out** ("two point seven"), where Whisper writes digits. Nothing normalizes this (ADR 0017 Consequences).

## 5. Problems and reversals

- **0017 to 0025:** v2 was English-only, so Whisper stayed. ADR 0022 switched to v3, then ADR 0023 gave Parakeet its own speech gate. The 2026-09-26 benchmark showed Whisper losing on both languages at about three times the latency, so ADR 0025 removed Whisper and retired ADR 0016's Silero gate. It saves about 2 GB of install and removes a cmake build.
- **Objections the owner accepted:**
  - Whisper was measured without its Silero gate. Its 182 Spanish insertions against v3's 39 make 6.91% an ungated number.
  - 99 languages against 25 was not measured.
  - The reopen condition is a language outside Parakeet's 25, or a Parakeet regression with no fallback.
- **v3 regressed on English against v2** by 0.6 to 3.2 points. It also returned two empty results on LibriSpeech where v2 transcribed. It shipped anyway, with the cost recorded.
- **Hallucination:**
  - Whisper produced "Thank you." on 77 of 116 mic segments in one meeting (ADR 0016).
  - Parakeet invents less but not nothing: "Okay." from typing or a knock, "Uh" from quiet noise (ADR 0023).
  - The sherpa offline server has no VAD option, so Silero could not be reused. A separate VAD sidecar was rejected for cost.
- **Confidence gate (ADR 0023):**
  - A segment is dropped if the mean `ys_log_probs` over all tokens is below -0.3 (`packages/overlay-core/src/transcript-filter.ts:68`).
  - Everything invented scored -0.474 or lower. Every real utterance scored -0.091 or higher (n=12).
  - A non-finite entry means "no opinion", never a drop (`sherpa-transcription.ts:76-84`).
  - Every drop is logged as `transcription.segmentDropped`.
  - Whisper's `no_speech_prob` was inert at about 1e-10 and was removed.
  - `tools/stt-bench/gate-report.ts` exists to measure false drops on real speech. I found no recorded result.
- **Bench provenance bugs (`tools/stt-bench/README.md`):**
  - `engines.sh` printed `vad=1` while omitting `--vad`.
  - It also pointed at v2 after the app moved to v3. Model hashes are now recorded per run.
  - Whisper measured 3.60% then 3.75% with nothing to explain the gap.

## 6. Licensing and attribution (`THIRD_PARTY_NOTICES.md:13-40`)

- **Model:** Parakeet v3 is CC-BY-4.0. The app shows the credit "Speech recognition: NVIDIA Parakeet (CC-BY-4.0)" and ships the license in Settings > Licenses. The ONNX conversion is by the sherpa-onnx community, and the weights stay NVIDIA's, unmodified.
- **Engine:** sherpa-onnx is Apache-2.0, and the full text ships in `licenses/Apache-2.0.txt`. ONNX Runtime is MIT. A NOTICE file was not seen upstream, but a hidden one is not ruled out.
- **Provenance:** revision and hashes are pinned in `docs/provenance-ledger.md`.

## 7. Reuse for 5-60 min recordings

### Reusable as-is

- The runtime choice: the sherpa-onnx server as a child process, and the reasons it can't be an Electron addon.
- The int8 v3 checkpoint, its four-file catalog and pinned SHA-256s, and the all-or-nothing download with a staged directory (`parakeet-download.ts`, `model-download.ts`).
- The bundling and signing recipe: `stage-engines.sh`, `extraResources`, the inherit entitlements, arm64 only.
- The readiness probe, orphan reaping, and the wire format (`sherpa-ws-client.ts`, `sherpa-transcription.ts`).
- `wordsFromTokens`, which turns token timestamps into words.
- Four threads, and the licensing and attribution text.
- `tools/stt-bench`: environment capture with model hashes, corpus digests, and the WER scorer.

### Needs adapting

- **Long audio must be segmented.**
  - The model was only measured on segments up to 12 s. No measurement exists for a 5-60 min input.
  - Extract 16 kHz mono with ffmpeg, then cut with a VAD, or cut at fixed windows with overlap.
  - The sherpa `sherpa-onnx-vad-with-offline-asr` demo binary does this offline, and ADR 0023 notes it exists only as a file-in/file-out demo.
  - Offset each segment's word timestamps by its start time.
- **Subtitles need a cue layer.**
  - Word `endMs` is inferred, and nothing here groups words into cues. You must add line length, duration and punctuation splitting.
  - Punctuation and capitalization come from the model.
- **The confidence gate (-0.3) is calibrated on 12 short clips** of live mic audio. For recordings, log drops rather than silently deleting, and re-check it with `gate-report.ts`.
- **Throughput is likely far faster than real time** (RTF about 0.04 on segments). Verify on a long file before promising a duration.
- **Disk and memory:**
  - Expect about 642 MB of weights and a resident process around 1.2 GB (a v2 figure).
  - ADR 0060 suggests the local LLM tier by machine RAM. The same idea could gate this feature on small Macs.

### Lessons to not repeat

- Don't start with two engines on a partial measurement. Measure first, with a pinned environment and corpus digests.
- Don't compare engines with different gates. Whisper ran ungated, which weakens the 6.91% figure.
- Don't trust a directory name as model identity, and don't benchmark through a path the app can't use (the addon).
- Don't treat the sherpa archive as verified. It has no pinned checksum and no NOTICE check.
- Don't ship an English-only checkpoint where mixed Spanish is possible.
- Don't assume empty results are errors. v3 returned silent empties on real speech.
- Don't let a malformed payload reach the server, because it exits instead of replying.
- Don't tune a threshold on a dozen clips without logging drops.
- A packaged build without its engines looks healthy and has no local models.
