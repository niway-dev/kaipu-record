---
title: "Local transcription research 4: subtitle formats and protocols"
description: "Written by Claude Sonnet, researching subtitle and caption formats and protocols for the editor."
sidebar:
  order: 4
---

> Evidence, kept verbatim (2026-11-15, design of [NIW2-818](https://linear.app/niway/issue/NIW2-818/local-transcription-with-parakeet-transcript-panel-and-subtitle-export)). The [spec](/specs/2026-11-15-local-transcription-design/) wins where they disagree.

## Brief

Research task, read-only (web search/fetch allowed; do not edit files). Answer in English with URLs for every finding.

## Report

## Research: transcripts, subtitles and captions for the editor

Items marked (unverified) come from my own knowledge or from secondary sources, not from a primary page I read in this session.

## 1. Subtitle formats

**SRT**

- Block layout: a counter line, then `HH:MM:SS,mmm --> HH:MM:SS,mmm`, then 1–2 text lines, then a blank line.
- It uses a comma for milliseconds.
- There is no formal spec and no styling or positioning.
- Players tolerate `<i>`, `<b>` and `<font>`, but this is de facto behaviour.
- Encoding is UTF-8.
- YouTube's help page says it supports only basic SRT, doesn't recognise style markup, and requires plain UTF-8: https://support.google.com/youtube/answer/2734698

**WebVTT** (spec: https://www.w3.org/TR/webvtt1/)

- The file starts with `WEBVTT`, followed by a blank line. It is UTF-8, and a BOM is allowed.
- Timestamps are `[hh:]mm:ss.ttt`. Hours are optional and milliseconds are exactly 3 digits. A period separates the milliseconds.
- Cue timing line: `start --> end`. Cue starts must be non-decreasing and each end must be after its start.
- Cue settings are `vertical`, `line`, `position`, `size`, `align` and `region`.
- Supported text tags are `<c.class>`, `<b>`, `<i>`, `<u>`, `<ruby>`, `<v Name>` and `<lang xx>`. `STYLE` blocks hold CSS and `NOTE` blocks are comments.
- Cue text can't contain `-->` or blank lines. Escape `&` and `<` as `&amp;` and `&lt;`.
- Word-level karaoke uses inline cue timestamps such as `<00:00:01.000>` inside the cue text.
  - Each timestamp must fall strictly between the cue start and end, and values must increase.
  - Example: `00:00:01.000 --> 00:00:03.000` followed by `Hello <00:00:01.400>world <00:00:02.100>again`.
  - Browsers expose these through the `:past` and `:future` CSS pseudo-classes (unverified).
  - YouTube's page says nothing about word-level timing, so assume it uses cue-level timing only.

**Platforms**

- **YouTube:** accepts SRT, SBV, LRC, VTT, TTML, SCC and others. SCC is its stated preference, and VTT support is described as "initial": positioning works, styling is limited to b/i/u. https://support.google.com/youtube/answer/2734698
- **Vimeo:** accepts SRT and WebVTT, recommends WebVTT, and requires UTF-8. https://help.vimeo.com/hc/en-us/articles/21956884955537-How-to-add-captions-or-subtitles-to-your-video
- **LinkedIn:** the official help article describes attaching an SRT before posting. Secondary sources say this is desktop only. https://www.linkedin.com/help/linkedin/answer/93997
- **X:** the official help covers uploading an `.srt` in the post composer and in Media Studio. https://help.x.com/en/using-x/upload-caption-srt-file

**Takeaway:** export SRT as the universal format, because every platform above takes it. Export VTT for the web player and Vimeo. Word-level karaoke only works in your own player or in a burn-in, not on the platforms.

## 2. Soft subtitles

- **MP4:** the encodable codec is `mov_text`, also called tx3g. The command is `-c:s mov_text -metadata:s:s:0 language=eng`. Use ISO 639-2 three-letter codes, for example `eng` or `spa`. Source: https://www.liquidsoap.info/doc-dev/ffmpeg_subtitles.html and https://www.cincopa.com/learn/automated-subtitle-embedding-using-ffmpeg
- **WebM:** the subtitle codec is `webvtt`, and only VP8/VP9 video and Vorbis/Opus audio are allowed. Same liquidsoap source.
- **MKV:** ffmpeg writes the WebM-style `D_WEBVTT/SUBTITLES` flavour, not the newer `S_TEXT/WEBVTT`. Some players may not recognise it. https://lists.ffmpeg.org/archives/list/ffmpeg-trac@ffmpeg.org/thread/3KF3Z6FKH4P4ZISW6ZPEDUWBH2ALHBAJ/
- **Player support (unverified):**
  - QuickTime and VLC show `mov_text`.
  - Browsers' `<video>` ignore tracks embedded in MP4. They need a separate `<track>` pointing at a VTT.
  - Styling in `mov_text` is minimal.
- **YouTube and embedded tracks:** I found no primary source saying YouTube ignores embedded tracks. YouTube's help documents only separate caption-file uploads. Plan on uploading SRT separately and don't rely on the embedded track.

## 3. Burn-in

- ffmpeg has two filters, `subtitles` (reads SRT, VTT or ASS) and `ass`. Both need ffmpeg built with libass. Docs: https://ffmpeg.org/ffmpeg-filters.html (I couldn't read those sections, so the details below are from knowledge, unverified).
  - `subtitles=f.srt:force_style='FontName=Inter,FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Alignment=2,MarginV=40'`
  - Related options: `original_size`, `fontsdir`, `charenc`.
- Burn-in forces a re-encode of the video, so it can't be a stream copy. Since the app already composites frames, this adds no new decode/encode pass.
- **Karaoke in ASS:** use `\k<centiseconds>` tags before each word, for example `{\k45}Hello {\k30}world`. `\kf` gives a smooth fill and `\ko` an outline-only fill. SecondaryColour is the not-yet-sung colour and PrimaryColour is the sung colour. The ASS spec is at https://github.com/libass/libass (unverified).
- **Alternative, rendering captions ourselves as an overlay in the compositor:**
  - This gives pixel-identical captions between preview and export.
  - Word-by-word highlight is simple, because your own timeline drives it.
  - It needs no libass or font dependency in the bundled ffmpeg.
  - The cost is that you own the layout, line breaking and font rendering.
- **Recommendation:** render the overlay ourselves for burn-in. It reuses the existing compositor, so the preview matches the export, and the ASS route stays available as a fallback.

## 4. Readability guidelines

- **Netflix (English, adult programmes):**
  - 42 characters per line, 2 lines maximum, and a reading speed of 20 characters per second (17 for children's programmes). https://partnerhelp.netflixstudios.com/hc/en-us/articles/217350977-English-Timed-Text-Style-Guide
  - Line breaks: prefer a bottom-heavy layout, and don't leave one or two words on the top line.
  - Break after punctuation, or before conjunctions and prepositions.
  - Don't split a noun from its article or adjective, a first name from a last name, a subject pronoun from its verb, or a verb from its auxiliary or negation. Same page.
  - Minimum duration is 20 frames (about 0.83 s at 24 fps), reserved for one- or two-word cues. Minimum gap is 2 frames. A gap of 3–11 frames is closed to 2, so gaps are 2 frames or at least half a second. The guide gives no maximum duration. https://partnerhelp.netflixstudios.com/hc/en-us/articles/360051554394-Timed-Text-Style-Guide-Subtitle-Timing-Guidelines
- **BBC:** I couldn't fetch the BBC page. Secondary sources say 160–180 words per minute and 2 lines maximum. The 37-characters-per-line figure is contested: another source says the BBC prescribes no limit. https://clevercast.com/bbc-subtitling-guidelines
- **W3C and FCC:** I did not retrieve either, so I cite nothing. The FCC requirements concern accuracy, synchronicity, completeness and placement, not numeric limits (unverified).

## 5. Transcript data models

- **AssemblyAI** words have `text`, `start`, `end` in milliseconds, `confidence` from 0 to 1, and `speaker` (null when diarization is off). https://www.assemblyai.com/docs/api-reference/transcripts/get
- **Whisper `verbose_json`:** segments carry `id`, `start`, `end` and `text`, and words carry `word`, `start` and `end`, in seconds (unverified). I did not fetch it.
- **Deepgram:** words carry `word`, `start`, `end`, `confidence`, `punctuated_word` and `speaker` (unverified).
- **Descript, Apple SFTranscription:** not checked.

**Proposed minimal schema (words in source-media time):**

```json
{
  "schemaVersion": 1,
  "mediaId": "...",
  "language": "en",
  "engine": { "name": "parakeet-tdt-0.6b-v2", "runtime": "sherpa-onnx", "version": "..." },
  "sourceDurationMs": 123456,
  "words": [
    { "id": "w1", "text": "Hello", "startMs": 1000, "endMs": 1400, "confidence": 0.93, "track": "mic", "segmentId": "s1" }
  ],
  "segments": [
    { "id": "s1", "startMs": 1000, "endMs": 3000, "wordIds": ["w1"] }
  ],
  "edits": []
}
```

- Use integer milliseconds. They are exact, and the formats above convert easily.
- `text` is the display form, including punctuation.
- Optional fields: `speaker`, and `corrected` for user edits.
- For versioning, bump `schemaVersion` on breaking changes and migrate on read. Keep `engine` so the transcript can be regenerated.

## 6. Tokens to words (Parakeet TDT)

- **sherpa-onnx** returns token-level data. The result struct has `text`, `tokens`, `timestamps` (token start times in seconds), and `durations` (per-token durations in seconds, parallel to `tokens`). `timestamps` may be NULL when the model gives none. https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/master/sherpa-onnx/c-api/c-api.h
  - A wrapper's docs say `durations` is valid for TDT models: https://www.mintlify.com/xdcobra/react-native-sherpa-onnx/api/stt/types
  - I did not confirm whether the Node binding exposes `durations`, so check this before building on it.
- **NeMo** has word, segment and char timestamps, enabled with `timestamps=True` or the decoding-config route. Frame stride is 80 ms (8 × 10 ms). https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2 and https://docs.nvidia.com/nemo/speech/latest/asr/intro.html
- **Merging tokens:** a token starting with `▁` begins a new word. Append the others to the current word.
  - Word start = the first token's timestamp. Word end = the last token's `start + duration`, or the next word's start if the duration is missing.
  - A reference implementation of word and sentence grouping is parakeet-rs: https://docs.rs/crate/parakeet-rs/0.3.5/source/src/timestamps.rs
- **Cue building:** break on sentence-ending punctuation, on pauses over about 0.5–0.7 s (unverified), or on the limits from section 4. The parakeet-rs sentence mode groups by punctuation.
- **Accuracy:** timestamps are quantised to 80 ms. I found no published boundary-error benchmark, so measure it yourself against forced alignment on your own recordings.

## 7. Sync with an edited timeline

I did not find primary documentation for Descript or Premiere, so this is the standard approach from knowledge.

- Store words in source-media time and never rewrite them.
- Map each word through the edit decision list (EDL). Each clip contributes a source in/out range, a timeline start, and a speed.
- A word is visible if its midpoint falls inside a kept range.
  - Its timeline time is `clipStart + (t − srcIn) / speed`.
  - A word that straddles a cut is trimmed or dropped.
- Words inside a cut are hidden, not deleted, so undo and re-expose both work.
- Speed changes divide durations by the speed factor.
- Recompute cues from the mapped words at export, so line breaks and timing come out right.

## Recommended defaults

- **Storage:** the JSON above, in source time, with integer milliseconds.
- **Export:** SRT as the default and universal format, plus VTT.
  - Add a karaoke VTT option with `<hh:mm:ss.ttt>` inline timestamps.
  - Embed `mov_text` soft subs in MP4 as an option, with a 3-letter language tag.
  - Upload SRT separately to YouTube.
- **Burn-in:** our own overlay in the compositor, with an ASS/libass fallback.
- **Cue rules (Netflix-based):**
  - 42 characters per line, 2 lines maximum, 20 characters per second.
  - Minimum cue duration about 0.83 s, minimum gap about 2 frames.
  - Break on punctuation and pauses over about 0.6 s.
  - Use a bottom-heavy line split and don't separate words as listed in section 4.
  - Maximum cue duration: no source found, so pick a value (about 7 s is common in the industry, unverified).
- **Open items:**
  - Confirm sherpa-onnx's Node binding returns `durations`.
  - Measure Parakeet word-boundary accuracy.
  - Fetch the BBC, W3C and FCC primary pages.
