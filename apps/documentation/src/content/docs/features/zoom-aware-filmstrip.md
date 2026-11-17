---
title: Zoom-aware filmstrip
description: How Clips and Webcam thumbnails follow timeline zoom, and how their budgets are verified.
---

# Zoom-aware filmstrip

The `zoom-filmstrip` release flag is off by default. With it off, the editor uses the existing
24-frame strip. With it on, a paused editor requests frames for visible Clips and Webcam tiles
120 ms after scrolling or zooming stops. Thumbnails show raw source footage, without editor effects.

The implementation follows the [zoom-aware filmstrip spec](/specs/2026-11-16-zoom-aware-filmstrip-design/)
and [true-timestamp, keyframe-first thumbnail decision](/architecture/decisions/0064-timeline-thumbnails-are-stored-by-true-timestamp-and-decoded-keyframe-first/).
The flag has not been rolled out and this work does not authorize merging the stack.

## Data and scheduling

`filmstrip-lanes.ts` maps each visible lane and joined recording to its media file. Webcam time
is source time minus its start offset. `filmstrip-controller.ts` listens to the timeline view
store, waits for 120 ms of rest, and requests all files' visible tiles before any background margin.
Fit zoom adds no worker frames: the opening 24-frame strip covers it.

The worker opens the first file's index when the editor opens. This preparation decodes nothing,
uses no frame-pacing allowance, and shares the same serialized, single-file lifecycle as requests.
Opening another file closes the previous one. An idle file closes after ten seconds; the software
worker terminates then to release the GPU memory observed in the layer-2 investigation.

One worker decodes one job at a time with mediabunny's `CanvasSink`. It prefers a keyframe inside
each tile; exact decoding is skipped above 300 packets. JPEGs are 160 px wide. The worker yields
between frames and caps published thumbnails at 60 in any sliding one-second window. Internal
codec frames needed for an exact thumbnail are governed by the 300-packet cap, not that output cap.

The shared store holds at most 48 MiB of JPEG bytes across files. It publishes per file in 150 ms
batches, with immediate publication of the final requested frame and on request completion. Each
eviction receives its own two-second URL grace after publication. Workspace changes empty the
store and revoke its URLs immediately. Tile images wait for `Image.decode()` before changing.

Playback and MP4/GIF exports pause the controller and close its open file. Hidden lanes supply no
targets. Unmounting an editor terminates its worker. Stored JPEGs survive editor unmount until
workspace change or eviction, so reopening can reuse them.

## Verification and limits

### Review correction status (2026-11-17)

The saved measurements below describe `b01cf0cf`, not the subsequent CodeRabbit fixes.
The five claims reviewed at `99da38cf` were reproduced locally before fixing them:
a 30 fps tile's middle half excluded every valid frame; a worker-only Webcam lane mounted
no tiles; an undecoded replacement escaped the blank sampler; both empty-tile latency
branches reported `-Infinity`; report-write failures skipped scenario cleanup in all four
verifiers. Regression coverage now exercises these failures without launching Electron.

**Current-head actual-app evidence: not verified.** The historical zero-blank result is
invalid as proof of AC12 across DOM replacement because the old sampler tracked element
identity. Existing non-empty latency observations remain historical measurements, but their
old assertions did not reject empty tile sets. No historical result proves the changed
full-span planner or worker-only Webcam mounting.

Before claiming current-head acceptance, rebuild the app and worker on the Mac mini and rerun:

- Editor on/off scenarios, including a trimmed 10-second 30 fps clip at 20× zoom and a Webcam
  whose legacy thumbnails/recording strips are empty, to capture own-time tiles and flag-off parity.
- AC12 scrolling with the corrected logical lane/clip/span sampler, including an undecoded DOM
  replacement; keep the initial-load limitation explicit (only previously decoded spans count).
- Latency acceptance and larger stress fixtures with positive visible-tile counts in every row;
  retain strict 500 ms failures. Repeat lifecycle and performance-on scenarios for the rebuilt
  planner; prior performance/memory observations are not a current-head resource guarantee.

The new cleanup fault-injection tests verify finalization after report-write failure and
workspace removal even if finalization fails; an actual disk-full Electron run was not performed.
No actual-app rerun was performed in this bounded five-finding implementation task. The remote
Wachiman attempt exhausted its weekly quota; it is not an independent clean review. No merge,
flag rollout, push, or review reply was performed.

Measurements below were observed on 2026-11-17 on the Mac mini, with the production decoder
path unchanged from layer 2. Code: `b01cf0cfc60f99b23728b12f1c32d1c70056b892`.
The NIW2-807 log ended `chain done`; no other Electron test/export was active during these runs.
Before the memory run, system memory was 75% free and 2.8 GB of swap remained allocated.

| Workload                                                                                   | Observation                                                                                                                                       | Artifact under `~/kaipu-evidence/niw2-844/` on the mini  |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 30-minute 1440p screen plus generated 720p/30 Webcam, +5 s offset; default 1440×900 window | First zoom 440.1 ms; ten warm jumps all within 500 ms (slowest 498.4 ms); after idle 438.4 ms; 36–38 visible tiles                                | `layer-3/acceptance-30min.json`                          |
| Owner's 54-minute, 1440p/60 take; Clips only                                               | First zoom 332 ms; four jumps 324–333 ms; 18/18 visible tiles own-time                                                                            | `layer-3/on.json`                                        |
| Same take, continuous scroll/playback                                                      | 0 minted frames during 1.5 s scrolling or 4.1 s playback; 0 blank tile samples over 918 animation frames / 122 source changes                     | `layer-3/on.json`                                        |
| Actual short MP4 export, viewport changing                                                 | 0 filmstrip requests during 465.6 ms exporting; 2 viewport changes during that interval                                                           | `layer-4/lifecycle.json`                                 |
| Real workspace switch                                                                      | All 7 cached filmstrip URLs revoked after the transaction; active workspace changed                                                               | `layer-4/lifecycle.json`                                 |
| 54-minute scroll/jump/zoom workload, three trials                                          | Main p95: 7.4/7.1/7.2 ms; feature: 8.2/7.1/7.1 ms. Median p95 7.2 → 7.1 ms. Neither side had a main-thread task over 50 ms                        | `layer-4/performance-before.json`, `performance-on.json` |
| 150 requests, bare Electron worker without CDP, same 10 GB take                            | Tab 56 MB at start; 85/80/86 MB at requests 50/100/150; 70 MB after idle. GPU 45 MB at start, 122 MB at request 3, 81 MB at 150, 53 MB after idle | `recovery-no-cdp/none-hardware.txt`                      |

The p95 comparison uses the median of three trials, chosen in the measurement script before the
runs. The first feature trial was worse than main's first trial (8.2 vs 7.4 ms); the aggregate
number does not erase that result. This is an open performance judgement before rollout.
The memory probe measures the worker in bare Electron without Playwright's response retention;
it does not establish a total-memory bound for every full editor session.
They distinguish first zoom after editor-open preparation, warm jumps, and reopening after idle.
The 500 ms criterion remains an assertion in `filmstrip-latency.verify.ts`; a late tile fails the run.

- `filmstrip-editor.verify.ts`: original/off/on parity, own-time tiles, continuous scroll,
  playback, decoded-before-swap, and actual-app screenshots.
- `filmstrip-latency.verify.ts`: first zoom, ten warm jumps, and after-idle timing; optional
  `KAIPU_VERIFY_WEBCAM=1` and `KAIPU_VERIFY_WEBCAM_FILE` add an offset camera fixture.
- `filmstrip-lifecycle.verify.ts`: an actual short MP4 export while the viewport changes,
  followed by a real workspace switch and revocation of every cached filmstrip URL.
- `filmstrip-performance.verify.ts`: three identical scroll/jump/zoom workloads on main and
  the feature, recording animation-frame intervals and all main-thread long tasks.

Run these only on the Mac mini, following `.claude/skills/verify/SKILL.md`. Do not overlap them
with NIW2-807 or any other export. Check the process inventory and memory pressure before each run.
The scenarios use throwaway profiles and vaults; the short export fixture is not an owner's take.
The optional 720p Webcam fixture is generated media, not a captured camera session.

A stress run using the same 54-minute, 1440p/60 source as both screen and offset Webcam exceeded
500 ms at some views. On the final implementation it took 549.5 ms on first zoom,
594.2 ms at the slowest warm jump, and 550.1 ms after idle (`layer-3/stress-final.json`). Do not describe that workload as passing AC2, or infer a universal latency
promise from the 30-minute acceptance fixture. Rejected decoder/JPEG experiments are not shipped.
No rollout should be inferred from successful unit tests or a completed measurement script.

## Reproduce the acceptance fixture

On the mini, from `apps/kaipu-record`, use the existing owner's source at
`~/kaipu-evidence/niw2-844/take/take-1440p-10gb.mp4`. The acceptance screen fixture is its
first 1,800 seconds, copied without re-encoding. The Webcam is generated media repeated to
30 minutes, with two-second keyframes. Check free disk first; the copied screen uses several GB.

```sh
mkdir -p ~/kaipu-evidence/niw2-844/fixtures
ffmpeg -n -f lavfi -i testsrc2=size=1280x720:rate=30 -t 10 \
  -c:v libx264 -preset ultrafast -crf 30 -g 60 -keyint_min 60 -sc_threshold 0 -an \
  ~/kaipu-evidence/niw2-844/fixtures/webcam-loop.mp4
ffmpeg -n -stream_loop -1 -i ~/kaipu-evidence/niw2-844/fixtures/webcam-loop.mp4 \
  -t 1800 -c copy ~/kaipu-evidence/niw2-844/fixtures/webcam-30min-720p.mp4
ffmpeg -n -i ~/kaipu-evidence/niw2-844/take/take-1440p-10gb.mp4 -t 1800 -c copy \
  ~/kaipu-evidence/niw2-844/fixtures/screen-30min-1440p.mp4

env -u ELECTRON_RUN_AS_NODE KAIPU_VERIFY_WEBCAM=1 \
  KAIPU_VERIFY_TAKE="$HOME/kaipu-evidence/niw2-844/fixtures/screen-30min-1440p.mp4" \
  KAIPU_VERIFY_WEBCAM_FILE="$HOME/kaipu-evidence/niw2-844/fixtures/webcam-30min-720p.mp4" \
  KAIPU_VERIFY_LABEL=acceptance-repeat \
  node node_modules/@playwright/test/cli.js test -c verify/playwright.config.ts \
  filmstrip-latency.verify.ts
```

The scenario assigns the Webcam a positive five-second offset. The first zoom includes the
120 ms rest delay; worker/file preparation occurs earlier, at editor opening. In the final
acceptance run, the worker was created and preparation sent at page time 980 ms, and the file
opened at 1,087.8 ms (107.8 ms including worker startup and opening). This is separate from the
458 ms first-zoom result; it is not an unprepared-worker cold-start claim.
