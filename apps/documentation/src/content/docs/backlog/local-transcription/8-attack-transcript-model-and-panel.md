---
title: "Local transcription research 8: attack on the transcript model and panel"
description: "Written by GPT-6.1 Sol high via Codex, attacking the transcript model and panel claim."
sidebar:
  order: 8
---

> Evidence, kept verbatim (2026-11-15, design of [NIW2-818](https://linear.app/niway/issue/NIW2-818/local-transcription-with-parakeet-transcript-panel-and-subtitle-export)). The [spec](/specs/2026-11-15-local-transcription-design/) wins where they disagree.

Brief: the claim and facts in the spec's "Failures this must protect against" section; the attacker saw only those.

I’m using the cs-find-weak-points review criteria to check the claim against the source. I’ll keep this read-only and distinguish confirmed behavior from design risks.

The source confirms two concrete gaps: a single source-to-timeline lookup loses repeated occurrences, and captions won’t update over a still screen unless export schedules extra frames. I’m also checking companion-file handling and what happens when a cut or mute crosses the middle of a word.

## Transcript architecture: weak-point review

**The claim is not safe as written.** It leaves consequential behavior undefined at cut and mute boundaries, treats a one-to-many mapping too loosely, and overlooks export scheduling and cache invalidation.

This was a read-only source review of the current feature branch. No files were changed and no runtime tests were run. **Verified** means checked in this checkout; **supplied** means accepted from the brief; **inferred** means a predicted failure of an implementation following the claim. Scenarios below are illustrative, not observed incidents.

## 1. Weak points, most serious first

### 1. Muting audio does not define which transcript text must disappear

**What breaks:** Text can disclose speech the user deliberately silenced. “Words inside muted ranges hidden” does not specify how to handle partial overlap.

**Concrete scenario:** A word has estimated source interval `1000, 1500)` ms. The user mutes `[1100, 1450)`. Filtering by word start or requiring complete containment leaves the entire word in TXT, subtitles and burned-in captions, although most of its audio is silenced. Subtracting the mute from its interval still leaves the complete textual word attached to two small fragments.

**Likelihood:** High once users place mutes manually near word boundaries. Severity is highest when muting removes sensitive speech.

**Known versus inferred:** Arbitrary source-time mute intervals and whole-scene `audioMuted` are **verified** in [audio-edits.ts (`apps/kaipu-record/src/renderer/src/features/video-editor/audio-edits.ts:53`). The disclosure is **inferred**, because the proposed overlap policy is unspecified. Timestamp uncertainty is **supplied**.

**Evidence needed:** Test words that partially overlap each mute edge, words spanning multiple mutes, and whole-scene mute. Inspect every textual output, including any stored segment text. Establish whether mute promises textual suppression or only silence.

**Containment:** Define one shared suppression policy. For privacy-sensitive muting, suppress the entire word on any overlap, with an explicitly justified timing margin. Never rebuild exported text from unfiltered segment strings.

### 2. A source word can have several timeline occurrences

**What breaks:** Words disappear from repeated footage, seek targets jump to the wrong occurrence, or highlighting marks several identical rows.

**Concrete scenario:** Timeline clips show source `0, 5)`, then `[10, 15)`, then `[0, 5)` again. A word at source `[2, 2.4)` belongs at timeline `[2, 2.4)` and `[12, 12.4)`. A scalar inverse returns only the first. A row keyed solely by recording and word cannot distinguish the two.

Joining the same recording twice adds another case: the transcript is shared, but the two source instances have different offsets.

**Likelihood:** Certain whenever footage repeats and the implementation uses the scalar inverse.

**Known versus inferred:** The first-occurrence behavior is **verified** in [source-time.ts (`apps/kaipu-record/src/renderer/src/features/video-editor/source-time.ts:62`). Its range helper already returns multiple blocks. Independent joins of the same asset are **verified** in source-axis.ts (`apps/kaipu-record/src/renderer/src/features/video-editor/source-axis.ts:126`). The proposed UI’s failure is **inferred**.

**Evidence needed:** A projection test must return both occurrences, in timeline order, with independently correct seek targets and highlighting. Repeat it with the same asset joined twice.

**Containment:** Represent projected occurrences explicitly: recording identity, source-instance identity, word identity, clip `itemId`, and mapped interval. Use the existing range helper for mapping. Reserve scalar inverse lookup for operations that intentionally choose one occurrence.

### 3. Correct caption timestamps do not make captions appear in exported video

**What breaks:** Burned-in captions appear late, remain frozen, or never appear over a still screen.

**Concrete scenario:** A screen recording has one video frame held from 0 to 8 seconds, speech during that interval, no webcam and no floating images. Captions change at 1, 3 and 5 seconds. Drawing captions only when the current export loop composites a decoded frame produces no updates at those times.

**Likelihood:** High for screen recordings with change-driven capture.

**Known versus inferred:** The frame-fill gate is **verified** in export-clip-frames.ts (`apps/kaipu-record/src/renderer/src/features/video-editor/export/export-clip-frames.ts:74`): fills depend on webcam or floating-image behavior. Caption failure is an **inferred consequence of reusing that loop unchanged**.

**Evidence needed:** Export a still-screen fixture with changing captions and no other animated layers. Decode frames around every appearance, change and disappearance, including the final caption ending before the clip ends.

**Containment:** Make caption transitions drive output-frame scheduling, including frames that clear text. Schedule against the output clock and frame-rate cap, using the held source frame where necessary.

### 4. Companion changes can bypass export reuse invalidation

**What breaks:** Kaipu can offer an old export as matching even though its captions are missing or stale.

**Concrete scenario:** Export a scene before transcription. Generate its companion without changing the scene, then export with captions. Alternatively, export captions, correct a word in the companion, and export again. A fingerprint derived solely from the scene does not capture either transcript change.

**Likelihood:** High once transcript generation, regeneration or correction can change rendered output independently of the scene.

**Known versus inferred:** The current fingerprint hashes saved scene data and selected compositor revisions; export reuse matches that fingerprint and preset. This is **verified** in export-reuse.ts (`apps/kaipu-record/src/renderer/src/features/video-editor/export/export-reuse.ts:67`). Stale reuse is **inferred unless this contract is extended**.

**Evidence needed:** Compare fingerprints before and after transcription, correction, caption enablement, style changes and changes to a joined recording’s transcript. Verify the reuse selection too.

**Containment:** Include effective transcript revision/content, correction revision, caption settings and caption-compositor revision in the export identity. Freeze those inputs once per export so burned video and subtitle files use the same revision.

### 5. Placing a JSON file in `.kaipu/` does not make it survive the recording lifecycle

**What breaks:** Renames or moves detach the transcript; reconciliation misidentifies it; a late transcription completion writes into the old location.

**Concrete scenario:** Start recognition of `Demo`. Move it to another workspace, where a name collision gives it a new stem. Recognition completes and writes `.kaipu/Demo.transcript.json` in the original workspace. Separately, adding only a path helper leaves explicit companion-copy lists unaware of the file.

**Likelihood:** Lifecycle operations are ordinary use. The completion race is conditional on asynchronous transcription overlapping them.

**Known versus inferred:** Explicit companion lists are **verified** in library-vault.ts (`apps/kaipu-record/src/main/library/library-vault.ts:775`) and move-item.ts (`apps/kaipu-record/src/main/workspaces/move-item.ts:131`). Reconciliation interprets known suffixes, including generic `.json`, in vault-reconcile.ts (`apps/kaipu-record/src/main/library/vault-reconcile.ts:131`). Failures are **inferred integration risks**, not demonstrated bugs in a transcript implementation.

**Evidence needed:** Rename, case-only rename, collision move, cross-volume move, delete and reconciliation tests carrying a transcript; crash recovery tests; recognition completion after each operation. Check the new suffix against item-name ownership rules.

**Containment:** Register the transcript across every lifecycle path and suffix rule. Commit recognition atomically under the item lifecycle lock, after revalidating workspace, stable asset identity, media hash and job generation. Reuse the screenshot cache’s generation approach as a mechanism, not its disposable-cache policy.

### 6. Estimated word intervals cannot determine reliable cut behavior or readable cues by themselves

**What breaks:** Highlights linger through silence; cuts retain complete words whose audio is mostly gone; original segments produce misleading text across edits.

**Concrete scenario:** “Hello” begins at 1 second; the next word begins at 7 seconds after a pause. If the inferred end is the next word’s start, “Hello” occupies six seconds. Cutting `0, 3)` retains a word interval even though the actual utterance ended earlier. Separately, cutting the middle from “do not share this” can leave a stored segment whose text still contains removed words.

A word spanning an internal cut may also produce two mapped fragments. Emitting the complete word for each fragment duplicates text.

**Likelihood:** Boundary overlaps and pauses are common. Their frequency and severity with the selected model are unmeasured.

**Known versus inferred:** Quantized emission positions and inferred ends are **supplied**. Interval clipping is **verified** in the range helper. The resulting caption behavior is **inferred**.

**Evidence needed:** Compare timestamps against manually aligned audio containing pauses, rapid speech and final utterances. Exercise cuts inside words and segments. Inspect actual exported text and cue duration, not only mapped numbers.

**Containment:** Preserve timing provenance and define a partial-word policy. Rebuild cues from surviving projected words, splitting at discontinuities and recording changes. Specify pause handling, minimum duration, line wrapping and reading limits. Add alignment or speech-boundary refinement if measurements show the estimates are inadequate.

### 7. One recording-level document does not settle correction ownership

**What breaks:** Corrections unexpectedly affect other edits, or regeneration destroys user work.

**Concrete scenario:** The same recording appears in two projects. The user changes a recognized name in project A. A shared companion makes project B change too. Later, a model upgrade regenerates the companion and overwrites the correction. A project-specific caption rewrite creates the opposite problem: it should not change the recording’s canonical recognition.

**Likelihood:** Conditional on the **assumed** correction feature; high once correction and regeneration coexist.

**Known versus inferred:** Correction demand is **assumed**. This is an unresolved ownership contract, not a verified current bug.

**Evidence needed:** Define expected behavior for two projects sharing a recording, regeneration after correction, undo and reopening an older project. Demonstrate those behaviors with persisted data.

**Containment:** Separate generated recognition from durable corrections. Give words stable identities within a recognition revision; preserve correction provenance and define regeneration conflicts. Store project-specific wording or timing overrides in the project. A single physical JSON file can contain these layers, but one undifferentiated word array cannot express their ownership safely.

### 8. The existing overlay pipeline is a hazardous caption implementation shortcut

**What breaks:** Captions consume excessive memory, move with source zoom, get cropped by output framing, or sit beneath the webcam.

**Concrete scenario:** Rasterize 1,000 caption cues as full-frame 3840×2160 bitmaps. Nominal uncompressed RGBA storage is about **31 GiB**, before additional copies. Reuse the existing overlay stage and a bottom caption is then cropped or enlarged by camera/framing operations.

**Likelihood:** High if captions directly reuse current overlay rasterization; conditional otherwise. This is a specific implementation hazard, not proof that a custom compositor is unsuitable.

**Known versus inferred:** Full-frame rasterization and concurrent rasterization are **verified** in [overlay-raster.ts (`apps/kaipu-record/src/renderer/src/features/video-editor/export/overlay-raster.ts:26`). Overlays precede crop/framing and webcam composition in compose-output-frame.ts (`apps/kaipu-record/src/renderer/src/features/video-editor/export/compose-output-frame.ts:344`). Memory size is a calculation, not a measurement.

**Evidence needed:** Measure peak memory during a long captioned export. Inspect captions under zoom, portrait fill, backgrounds and a bottom-positioned webcam.

**Containment:** Use bounded cue-sized raster caches or worker text drawing with explicit font handling. Define captions in final-output coordinates with deliberate safe areas and layer order.

## 2. Hidden assumptions the claim needs to be true

- **Media remains the same time-addressable source.** Destructive trimming is unknown. A hash mismatch must invalidate or explicitly migrate the transcript; detecting the mismatch does not repair timestamps.
- **Recording identity survives path changes.** The filename stem is a location, not sufficient job or correction identity.
- **Local milliseconds and source-axis seconds remain distinct.** Joined offsets must be applied exactly once; mute tests must use the same axis as the audio edits.
- **Stored segments are recognition metadata.** Reusing their original text after filtering words can restore removed content.
- **“Confidence” has a defined origin and meaning.** The brief does not establish that the engine provides calibrated word confidence. Estimated timing precision must not be presented as measured millisecond accuracy.
- **No audio, silence, failure and unfinished recognition have distinct states.** An empty word list cannot explain all four.
- **The right column can support a persistent transcript workflow.** Its mutually exclusive panels mean selecting another tool can displace the transcript. Adding a fourth boolean extends the existing coordination burden.
- **Playhead updates do bounded work.** An rAF subscription must not remap and rerender the entire transcript every frame.
- **Subtitle delivery means the formats actually promised.** SRT/VTT sidecars, burned pixels and an embedded MP4 subtitle track are separate outputs. The supplied `wvtt` limitation does not establish target-player compatibility.

## 3. Alternatives that beat the claim, and under which conditions

| Alternative                                                                                | When it beats the claim                                                                                                                                                               |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recording recognition plus a shared, occurrence-aware projection consumed by UI and export | Repetition, joins, cuts and mutes must behave identically everywhere. It makes the missing projection contract explicit.                                                              |
| Generated recognition plus durable correction layers and optional project overrides        | Corrections, model upgrades or several projects share a source. It prevents regeneration from treating user work as disposable recognition output.                                    |
| Persisted caption cues layered over source words                                           | Users need authored line breaks, timing adjustments, translations or captions whose text differs from recognized speech. Those choices cannot always be regenerated from words alone. |
| Sidecar SRT/VTT first; burn-in after scheduler validation                                  | Initial delivery can avoid burn-in. This removes frame scheduling, compositor ordering and bitmap pressure from the first release.                                                    |
| A dedicated final-output caption pass with bounded resources                               | Burn-in is required for long or high-resolution screen recordings. It avoids the current full-frame overlay shortcut.                                                                 |

These alternatives address different failure conditions; none eliminates the need for explicit boundary and revision semantics.

## 4. What would change my mind: the observation that would make the claim safe

A working implementation would need to demonstrate:

1. **One authoritative occurrence projection** handles repeated source intervals, repeated joins, partial cuts, partial mutes, global mute and slide boundaries, with correct seek targets.
2. **Exported frames change when captions change**, even over a still screen without webcam or floating images, within the declared output-frame tolerance.
3. **Caption-affecting changes invalidate reuse**, and every output from one export uses the same frozen transcript and scene revisions.
4. **Transcript files survive lifecycle operations and crashes**, while late jobs cannot resurrect deleted files or write into a previous workspace.
5. **Measured alignment quality supports the promised behavior**, including pauses and final words; partial-word and cue-building policies produce acceptable results.
6. **Correction ownership is explicit and survives regeneration**, including two projects sharing a recording.
7. **Long, high-resolution exports stay within a measured memory budget**, and captions remain legible across framing, zoom and webcam configurations.

Those observations would resolve the serious objections. The storage path and timestamp representation alone do not.
