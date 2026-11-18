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

The historical measurements later in this section describe `b01cf0cf`, before the CodeRabbit fixes.
The five claims reviewed at `99da38cf` were reproduced locally before fixing them:
a 30 fps tile's middle half excluded every valid frame; a worker-only Webcam lane mounted
no tiles; an undecoded replacement escaped the blank sampler; both empty-tile latency
branches reported `-Infinity`; report-write failures skipped scenario cleanup in all four
verifiers. Regression coverage now exercises these failures without launching Electron.

**Current-head actual-app validation is mixed (2026-11-17).** The Mac mini rebuilt the runtime
from `673ca7fc20880b8d33293879f10aee6b5078d982`; the final SHA-256 manifest matches
55 runtime/verifier files. The eight corrected runtime files and four verifiers were synced
into the existing dirty `kaipu-record-844-3-after` worktree (base `38549dc8`), after saving
its diff and verifiers. No reset, new worktree, rollout, push, or GitHub post was performed.

New artifacts live under `~/kaipu-evidence/niw2-844/review-673ca7fc/` on the mini and in
`.evidence/niw2-844/review-673ca7fc/final/` in the M5 task worktree. A durable copy lives in
the main checkout's `.evidence/niw2-844/review-673ca7fc/`. `source-manifest-final.json`,
`manifest-check-final.json`, `remote-before.patch`, and `remote-status-before.txt` record
provenance. The app runs used the same existing fixture files described below. New verifier
controls only seed/suppress/inject test conditions; production code was not changed.

| Current runtime workload                                                                                                                      | Observed result                                                                                                                                                                                                                 | Exit / artifact relative to the new folder              |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Owner's 54-minute take, Clips only; on/off                                                                                                    | On: first zoom 335 ms; four jumps 310–347 ms; 18/18 own-time tiles. No minting during playback/scroll. Corrected logical sampler: 0 blank samples / 917 animation frames / 122 source changes. Off: no filmstrip attributes.    | Both 0; `editor/on.json`, `editor/off.json`             |
| 30-minute 1440p screen + generated 720p/30 Webcam, +5 s; normal legacy strips                                                                 | All 12 rows have 36–38 visible tiles and meet 500 ms: first zoom 437.7 ms, slowest warm jump 490.0 ms, after idle 440.4 ms.                                                                                                     | 0; `latency/acceptance.json`                            |
| Generated 720p/30 source used in both lanes, trimmed to source 5–15 s; 20× zoom, legacy enabled, no injection                                 | **Fails own-time coverage:** 32/36 visible tiles own-time after the 30 s wait. Four frames remain outside their spans; e.g. span `9.737,9.766`, frame `9.767`. Webcam has 20/20 decoded mounted images, including margin tiles. | 1; `trim/on.json`, `trim-shots/03-zoom-2000-marked.png` |
| Same acceptance files, legacy encoding suppressed (`HTMLCanvasElement.toBlob` returns null), worker-only Webcam; isolated replacement at rest | Webcam eventually mounts 18/18 decoded images. **Fails 500 ms:** first zoom 527 ms; four warm jumps 778/517/777/491 ms. No minting during scroll/playback. Negative control detects 15 blank samples over 181 animation frames. | 1; `worker-only-final/on.json`                          |
| Short real MP4 export with viewport changes; real workspace switch                                                                            | 0 requests during 487.6 ms exporting; 2 viewport changes; all 18 cached URLs revoked after switch.                                                                                                                              | 0; `lifecycle/lifecycle.json`                           |
| Same 54-minute scroll/jump/zoom performance-on workload, three trials                                                                         | p95 8.1/7.3/7.1 ms; median 7.3 ms; no main-thread task >50 ms. This is slightly above the historical main median of 7.2 ms; main was not rerun.                                                                                 | 0; `performance/performance-on.json`                    |

The trimmed tile spans are about 29 ms wide, below the 33.3 ms interval of the 30 fps source.
That is consistent with some spans containing no valid frame timestamp; the observed result is
failed own-time coverage, not an assertion that full-span planning alone guarantees every zoom.
No decoder change, fixture tuning, budget relaxation, or optimization was attempted.

The worker-only first-zoom timer returned when the 18 screen images were own-time, before
Webcam images mounted (`webcamTilesAtZoom.count = 0`). Warm rows contain both lanes (36 images).
A positive tile count therefore does not prove that every expected lane has mounted. The normal
acceptance run had 36–38 tiles in every row; the worker-only cold timing is not a complete
both-lanes latency measurement. The final count and screenshots prove eventual worker-only
Webcam rendering, while its strict overall scenario remains red. The preceding worker-only run
also failed (532 ms first zoom; warm 688/654/623/651 ms); it is retained in `worker-only/`.

The 15 negative-control blanks are intentional and do not represent natural blanking. The normal
corrected sampler's zero-blank observation remains limited to previously decoded logical spans;
it cannot establish initial-load blank freedom. An earlier combined trim/replacement run
(`edge/`) detected 10 blanks, but replacing a React-owned node during scrolling disrupted the
editor and caused a later locator timeout (exit 1). Its post-injection behavior is invalid as
product evidence. A first setup attempt waited at fit zoom with legacy strips suppressed and
was interrupted (exit 130); fit intentionally requests no worker frames. Both attempts are
preserved, not counted as passes. The final negative control replaces/restores the node at rest.

The mini was idle with respect to test/export jobs before each scenario (74–75% free system
memory); the owner's resident app and NIW2-807 worktrees/processes were preserved. Available
NIW2-807 logs ended `DONE`/`ALLDONE`; the literal historical `chain done` marker was not located
in the checked `/tmp`/evidence logs. Post-run process inventory shows no test-owned Electron or
Playwright process. No M5 app was launched. The actual disk-full Electron cleanup path was not
run; extracted fault-injection tests remain its evidence. The nine verifier regressions pass
(exit 0); the prior 8,486-test suite was not repeated. A type-check after verifier edits passed
(exit 0, 24 tasks, 23 cached).

**Limits retained:** the historical larger stress failure remains 594.2 ms at its slowest warm
jump (`layer-3/stress-final.json`), and was not rerun here. Historical memory observations below
are not current-head memory guarantees. Wachiman exhausted its weekly quota and supplies no
independent clean review. No actual camera recording or Windows validation was added.

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

## Reproduce review-only fixtures

Use the same built mini worktree and generated Webcam above. From `apps/kaipu-record`,
`KAIPU_VERIFY_OUT` now also applies to lifecycle and performance, so a rerun preserves prior results.
The editor controls are verifier-only and leave its standard workload unchanged when unset.

```sh
# Ten-second edit of the existing generated 30 fps file, at the standard five-click 20× zoom.
# This run failed: 32/36 visible tiles own-time after 30 seconds; strict assertion unchanged.
env -u ELECTRON_RUN_AS_NODE KAIPU_VERIFY_TRIM=1 KAIPU_VERIFY_ZOOM_ONLY=1 \
  KAIPU_VERIFY_WEBCAM=1 \
  KAIPU_VERIFY_TAKE="$HOME/kaipu-evidence/niw2-844/fixtures/webcam-30min-720p.mp4" \
  KAIPU_VERIFY_WEBCAM_FILE="$HOME/kaipu-evidence/niw2-844/fixtures/webcam-30min-720p.mp4" \
  KAIPU_VERIFY_OUT="$HOME/kaipu-evidence/niw2-844/review-673ca7fc/trim-repeat" \
  node node_modules/@playwright/test/cli.js test -c verify/playwright.config.ts \
  filmstrip-editor.verify.ts

# Worker-only lanes: suppress main-renderer HTMLCanvasElement.toBlob (legacy strips),
# while leaving the production OffscreenCanvas worker intact. Inject/restore one undecoded
# logical-span replacement at rest; nonzero blank samples are expected in this control.
# This run rendered Webcam tiles and detected the injection, but failed strict 500 ms latency.
env -u ELECTRON_RUN_AS_NODE KAIPU_VERIFY_WORKER_ONLY=1 KAIPU_VERIFY_INJECT_BLANK=1 \
  KAIPU_VERIFY_WEBCAM=1 \
  KAIPU_VERIFY_TAKE="$HOME/kaipu-evidence/niw2-844/fixtures/screen-30min-1440p.mp4" \
  KAIPU_VERIFY_WEBCAM_FILE="$HOME/kaipu-evidence/niw2-844/fixtures/webcam-30min-720p.mp4" \
  KAIPU_VERIFY_OUT="$HOME/kaipu-evidence/niw2-844/review-673ca7fc/worker-only-repeat" \
  node node_modules/@playwright/test/cli.js test -c verify/playwright.config.ts \
  filmstrip-editor.verify.ts
```

`TRIM` seeds a real saved edit with source range 5–15 seconds. `ZOOM_ONLY` captures and asserts
the first zoom, then finalizes without running the unrelated later phases. `WORKER_ONLY` skips
the fit-zoom image wait because fit requests no worker frames. `INJECT_BLANK` keeps the viewport
still for its negative control; omit it for the normal scrolling AC12 scenario. The sampler
only detects a blank after that logical lane/clip/span has previously decoded; initial loading
remains outside its claim. The earlier moving-node injection failure is not a product regression.
