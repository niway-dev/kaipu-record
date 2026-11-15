---
title: "Local transcription research 7: attack on the engine pipeline"
description: "Written by GPT-6.1 Sol high via Codex, attacking the engine pipeline claim."
sidebar:
  order: 7
---

> Evidence, kept verbatim (2026-11-15, design of [NIW2-818](https://linear.app/niway/issue/NIW2-818/local-transcription-with-parakeet-transcript-panel-and-subtitle-export)). The [spec](/specs/2026-11-15-local-transcription-design/) wins where they disagree.

Brief: the claim and facts in the spec's "Failures this must protect against" section; the attacker saw only those.

I’m using the cs-find-weak-points review criteria to test the claim against the repositories and upstream documentation. I’ll keep this read-only and separate confirmed failures from risks that still need measurement.
The existing benchmark explicitly excludes meeting audio and Spanglish, and it records two empty results on real speech. That leaves silent omissions unaddressed. I also confirmed that first-use downloading conflicts with the stated offline requirement, and I’m checking the server’s network boundary and timestamp handling.

## Review: finished-recording local transcription

**The claim is not safe as stated.** It conflicts with the offline requirement, leaves speech loss undetectable, and may inherit an exposed, unsafe WebSocket server.

**Evidence labels:** **Known** means supplied verified facts, inspected repository code, or cited upstream source. **Inference** means a consequence or risk requiring validation. Likelihood assessments are qualitative; no end-to-end transcription, load test, or packaged-app test was run. No files were changed.

## 1. Weak points, most serious first

### 1.1 First-use downloading fails the offline requirement

**What breaks — Known:** An accountless user cannot transcribe offline before downloading the model. The tag-sync ADR’s local-first requirement (`apps/documentation/src/content/docs/architecture/decisions/0021-tag-sync-on-events-with-server-version.mdx:19`) says every feature must remain available offline. Accepting a download’s size does not establish network availability.

**Concrete scenario:** Install Kaipu on a disconnected Mac, record a meeting, then request its first transcription. The server binary exists; its weights do not. Transcription cannot start. Reinstallation or model-cache loss can recreate this state.

**Likelihood:** Certain in that state. How often users encounter it is unknown.

**Evidence needed:** A fresh-install, network-disabled acceptance test. Clarify whether the product requirement permits an explicit “offline after model provisioning” exception; the supplied requirement does not.

**Fix or containment:** Offer an installer containing the weights or a complete model pack transferable from another machine. Otherwise explicitly revise the offline requirement before shipping this behavior.

### 1.2 The reused server may expose an unsafe service to the network

**What breaks — Known, conditional on reusing upstream v1.13.8:** The server listens on an IPv4 wildcard address, rather than explicitly on loopback. Its receive path copies incoming payload bytes into a declared-size allocation without checking that each copy fits. The application connecting to `127.0.0.1` does not restrict where the server listens. These behaviors are visible in the [pinned upstream implementation](https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/v1.13.8/sherpa-onnx/csrc/offline-websocket-server-impl.cc).

**Concrete scenario:** During transcription on a network that permits inbound connections, another machine connects to the server and supplies a malformed length/payload combination. The supplied observations already establish that malformed input can kill it.

**Likelihood:** The listening behavior is deterministic for that source; network reachability and hostile traffic are environment-dependent. Memory corruption is supported by source inspection; exploitability beyond a crash was not tested.

**Evidence needed:** Inspect the exact bundled binary’s source identity, listening address, authentication, and malformed-frame behavior.

**Fix or containment:** Patch the server to bind explicitly to loopback, authenticate clients, and validate all lengths and samples. Prefer a private pipe-based child protocol if practical.

### 1.3 The mixed track can destroy information transcription needs

**What breaks — Known:** Recording gain, ducking, and mute decisions are irreversible in the saved track. **Inference:** One recognizer receiving the mixture can omit quieter overlapping speech or transcribe unrelated playback as part of the intended conversation.

**Concrete scenario:** The user explains something over a YouTube speaker. Ducking attenuates the video while both speakers overlap. The saved AAC contains neither clean source. Alternatively, background playback remains audible while the user pauses, and its dialogue enters the transcript.

**Likelihood:** The input class is explicitly expected. Its frequency and failure rate have not been measured. Muted speech being absent is certain.

**Evidence needed:** Human-referenced Kaipu recordings containing overlap, ducking, unequal levels, and playback. Score each source’s omissions separately; a single aggregate word error rate can conceal the missing speaker.

**Fix or containment:** Preserve separate mic and system tracks for future recordings and transcribe them separately. For existing recordings, explicitly accept that masked or muted content cannot be recovered reliably. A different ASR model cannot undo gain zero.

### 1.4 “At silences” and “at most 20 seconds” cannot both be guaranteed

**What breaks — Known:** Continuous speech or music may provide no qualifying silence for more than 20 seconds. **Inference:** Waiting violates the duration bound; enforcing it cuts through speech. Energy thresholding also cannot reliably distinguish speech from equally energetic music or noise.

**Concrete scenario:** A presenter speaks continuously over background music for two minutes. The segmenter either creates oversized segments or repeatedly cuts words near its hard limit. A quieter speaker’s consonants may fall below its threshold.

**Likelihood:** High for continuous playback and narration; the actual boundary-loss rate is unknown. Existing evidence used segments of at most 12 seconds, not this proposed 20-second policy.

**Evidence needed:** Run the actual segmenter on uninterrupted speech, music, quiet voices, and speech spanning the limit. Measure discarded speech, boundary-word errors, duplicate words, and final-tail loss.

**Fix or containment:** Separate speech detection from duration enforcement. Use padding, a hard maximum, overlap at forced cuts, and reconciliation of overlapping results. Evaluate a neural speech detector for rejecting non-speech; it does not solve overlapping speakers.

### 1.5 Successful requests can silently return incomplete transcripts

**What breaks — Known:** The owner’s benchmark (`invisible-assistant/docs/learning/2026-09-26-parakeet-v3-vs-whisper.md`) records two empty v3 results on real English speech. It explicitly excludes Spanglish and meeting audio. Its Spanish result measures read prose, not Kaipu’s mixed recordings.

**Concrete scenario:** One segment containing an instruction or negation returns empty text. The request succeeded, so the job advances and ultimately reports completion. The transcript contains an invisible hole.

**Likelihood:** Observed on benchmark speech; prevalence on Kaipu audio is unknown. A long recording exposes many more segments to this failure than a short dictation.

**Evidence needed:** Replay the known empty-result clips through the exact pinned stack, then evaluate representative Kaipu recordings. Count complete utterance omissions and critical-term errors separately from average WER.

**Fix or containment:** Treat speech-positive/empty results as unresolved, retry with different boundaries or a fallback engine, and retain the unresolved source interval. Do not treat empty output as proof of silence.

The other app’s `-0.3` confidence gate is not an established solution: it was calibrated on twelve clips, and a wrong threshold can delete real speech. Its confidence-filter decision (`invisible-assistant/docs/adr/0023-per-token-confidence-filter.md`) acknowledges that risk.

### 1.6 Streaming does not establish bounded memory or job durability

**What breaks — Inference:** Renderer decoding can outrun inference and accumulate queued PCM. The proposal also leaves the job dependent on an unspecified renderer lifetime.

**Concrete scenario:** A 60-minute recording decodes quickly while inference proceeds more slowly. IPC accepts chunks without limiting outstanding work. The user then navigates away from the editor or closes its window, disposing the producer before the job finishes.

**Likelihood:** Queue growth is inevitable whenever production exceeds consumption without backpressure. Whether navigation aborts the job depends on ownership that the claim does not define.

**Known scale:** One hour of 16 kHz mono float32 is **230.4 MB** before copies, queued messages, decoder buffers, or model memory. Sixteen GB of installed RAM does not prove adequate free memory or acceptable responsiveness.

**Evidence needed:** Measure queue depth, total process-tree memory, main-process responsiveness, cancellation latency, and behavior during navigation, sleep, and window closure on the slowest supported arm64 machine.

**Fix or containment:** Use acknowledged, bounded transfers and inference concurrency limits. Main should own job identity and committed progress; decoding needs an explicit lifetime and restart policy. Keep long-running JavaScript processing out of main’s event loop.

### 1.7 Offsetting token times does not establish correct word alignment

**What breaks — Inference:** Adding a segment offset only works if that offset retains the original media timeline through decoding, resampling, VAD trimming, padding, and overlaps. Token grouping also does not establish word end times.

**Concrete scenario:** VAD removes silence and segment starts are calculated from accumulated retained audio. Words after the first removed pause seek too early. Alternatively, resampling rounds each decoded block independently and accumulates timing error.

A separate concrete problem exists in the other app’s token merger (`invisible-assistant/apps/desktop/src/main/transcription/sherpa-transcription.ts:88`): it ends each word at the next word’s start and the final word at the segment end. A word followed by a long pause therefore spans that pause.

**Likelihood:** Deterministic if these implementations are used; not demonstrated as a Kaipu defect.

**Evidence needed:** Compare word boundaries with annotated source audio, including long pauses, 44.1/48 kHz inputs, AAC priming, nonzero timestamps, forced cuts, and the final recording tail.

**Fix or containment:** Preserve source presentation timestamps and continuous resampler state. Define an explicit mapping from submitted samples back to source time. Validate timing accuracy; use segment-level timing until word alignment meets the required tolerance.

### 1.8 A long-lived server needs more than existing helper spawning

**What breaks — Known:** Kaipu’s supplied helper abstraction is one-shot. The existing helper runner (`apps/kaipu-record/src/main/screenshots/text-recognition/helper-process.ts`) collects output until process exit; it is not a persistent ASR supervisor. A successful 100 ms silence decode establishes readiness, not subsequent job reliability.

**Concrete scenario:** At minute 45, the server crashes or stops answering. Without per-request deadlines and persisted segment state, transcription hangs or restarts from zero. Retrying after a result was saved can duplicate text.

**Likelihood:** Malformed-input crashes are already observed. Other failure frequencies are unmeasured; interruption handling is required regardless.

**Evidence needed:** Kill and stall the child mid-job. Verify bounded restart, cancellation, orphan cleanup, deterministic resume, and exactly one committed result per segment. Repeat from a signed, notarized installation on a clean machine.

**Fix or containment:** Build a dedicated supervisor with deadlines, bounded retries, explicit child ownership, and durable segment IDs. Stage and sign the server’s required shared libraries as well as its executable; development-machine success does not verify packaged launch.

### 1.9 The single-AAC assumption does not cover the accepted library

**What breaks — Known:** Imports are accepted by container extension. The import probe (`apps/kaipu-record/src/main/library/import-video.ts:40`) checks video metadata without establishing that an audio track exists or can decode. Imported files can have other codecs or multiple audio tracks.

**Concrete scenario:** A valid imported WebM contains Opus rather than AAC; a MOV has unsupported audio; or an MP4 defaults to commentary while the intended language is another track.

**Likelihood:** Certain for some accepted inputs; prevalence is unknown. This becomes a product defect if transcription is exposed uniformly to imported library items.

**Evidence needed:** An explicit input-support matrix, tested against the shipped Electron build and actual track selection.

**Fix or containment:** Inspect tracks and decoder support before starting. Support decodable codecs through the same pipeline, offer track selection where needed, and return specific unsupported/no-audio states. If v1 covers only native Kaipu recordings, state and enforce that boundary.

## 2. Hidden assumptions the claim needs to be true

- **Provisioning:** “Offline” permits prior network provisioning, or users have an offline model-installation path.
- **Platform scope:** Product requirements explicitly accept unavailable transcription on the two other released architectures. Hiding it behind a truthful state does not fulfill an all-platform feature requirement.
- **Transcript scope:** Users want all audible content in the mixture, including playback, and accept missing masked speech, no source attribution, and no speaker separation.
- **Model applicability:** Short, mostly single-speaker benchmark performance transfers to long meetings, accents, names, code-switching, and compressed mixed audio. That transfer is unverified.
- **Resource use:** Peak v3 memory and sustained throughput remain acceptable under actual 20-second segmentation and concurrency. Model file size and v2 RSS do not establish either.
- **Audio processing:** Downmixing preserves intelligibility; resampling includes appropriate filtering, continuous state, and final flushing. Arbitrary stereo imports may violate the downmix assumption.
- **Recovery:** Every source interval is accounted for as transcribed, intentionally excluded, failed, or unresolved. An empty result cannot silently count as completed speech.
- **Artifact compatibility:** The pinned revision contains the specific sherpa-compatible ONNX export, matching tokenizer, and all required files—not merely a checkpoint with the right model name.
- **Download integrity:** Hash-verified files are installed atomically as one model version, with recovery from interruption and insufficient disk space. Per-file hashes alone do not provide transactional installation.
- **Meaning of timestamps:** The application requires approximate recognition timing, or validates the accuracy necessary for word-based seeking and editing.

## 3. Alternatives that beat the claim, and under which conditions

1. **A bundled model or offline-importable model pack** beats mandatory first-use downloading when fresh-install offline operation is a requirement. It increases distribution size but removes the provisioning dependency.

2. **The same Parakeet model with padded, bounded segmentation and explicit recovery** beats silence-only energy segmentation when recordings contain continuous speech, music, quiet voices, or abrupt cuts. Neural VAD is a candidate improvement, subject to measurement.

3. **Separate mic/system capture and transcription** beats the mixed-track approach when overlapping sources, source attribution, or quieter-speaker recall matter. It helps future recordings; it cannot reconstruct clean sources from existing mixtures.

4. **A hardened private child-process protocol** beats an unmodified WebSocket server when Kaipu needs no externally accessible transcription service. A small native wrapper using sherpa’s native API avoids the Electron N-API buffer problem without introducing a listening TCP service.

5. **A fallback recognizer for unresolved segments** beats one-engine completion when silent omissions are unacceptable. Whisper is a candidate to test on empty or disputed segments; the supplied corpus does not establish that it wins on Kaipu meetings.

6. **Segment-level timing initially, with validated alignment later**, beats fabricated word intervals when timing drives editing or precise seeking.

## 4. What would change my mind: the observation that would make the claim safe

A release-candidate build would need to demonstrate all of the following:

- **Offline fulfillment:** A clean, accountless installation can provision and transcribe without network access, or the requirement has explicitly changed.
- **Contained execution:** The exact bundled server has a verified private network boundary, rejects malformed input safely, and launches with all dependencies from the signed, notarized app.
- **Representative accuracy:** Human-referenced 5–60-minute Kaipu recordings cover Spanish, English, mid-sentence switching, meetings, playback, music, ducking, quiet speech, and overlap. Results meet predeclared limits for missing utterances, false text, critical-term errors, and boundary loss.
- **Accounted-for coverage:** Known empty-result cases are recovered or visibly unresolved. No speech interval disappears behind a successful completion state.
- **Bounded operation:** Queue depth and memory remain bounded, the UI stays responsive, and runtime is acceptable on the minimum supported machine under ordinary competing workload.
- **Correct recovery:** Child crashes, stalled requests, cancellation, window closure, sleep, and app restart preserve committed work and resume without duplication.
- **Verified timing:** Source-time mapping survives resampling and segmentation, with measured word-boundary error within the tolerance required by the feature.
- **Explicit scope:** Unsupported architectures, imports, audio codecs, and track configurations are identified before work begins.

Until those observations exist, “good enough” describes an untested acceptance decision, especially for mixed-track meetings.
