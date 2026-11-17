---
title: Zoom-aware filmstrip recovery audit brief
description: Verified implementation, review findings, measurement limits, and remaining owner decisions for NIW2-844.
---

# Audit brief — zoom-aware filmstrip recovery

**Branch** `feature/niw2-844-3-filmstrip-editor` · **Historical recovery head** `b01cf0cfc60f99b23728b12f1c32d1c70056b892` · **Validated runtime head** `673ca7fc20880b8d33293879f10aee6b5078d982` · **Generated** 2026-11-17

**Historical baseline check:** desktop type checks → exit 0; targeted filmstrip suites → exit 0, 183 tests. The
first full desktop run passed 8,475 tests / 8 skipped. A later full run hit one unrelated
5-second workspace-move timeout; that file passed alone (42 tests). The bounded-worker full rerun (`bun run test --maxWorkers=4`) passed 8,475 tests / 8 skipped, exit 0. Documentation build → exit 0. Real-app scenarios below exercised the
compiled renderer and worker, not jsdom. All 15 changed production source files matched the
mini by SHA-256 (`source-manifest.json` in the M5 evidence folder).

## Stack refresh after main changed (2026-11-17)

`gh stack rebase design/niw2-844-zoom-aware-filmstrip --upstack` rebased all four
layers onto main `b9dd6284d5a3ec34e5b97aff94b3382d09f7a6ba`. The stale two-layer local
registration was backed up and reconstructed from GitHub with `gh stack checkout 676`.
The owner's dirty main checkout was left unchanged.

Conflicts were limited to the Clips block binding in `timeline-strip.tsx` and imports in
`webcam-lane.tsx`. Resolution keeps main's `TimelineShowRangeContext`, camera-part controls,
and all filmstrip props/rendering. `git range-diff` shows only changed surrounding context in
the original editor-wiring commit; all twelve later commits replay unchanged. Stable patch IDs
of the design, pure-logic, and worker layers match their pre-rebase versions exactly.
No decoder protocol, pacing, time offset, cache budget, or fallback rule changed in resolution.

Desktop type checks and the documentation build passed on the rebased tree. Full-suite result
is recorded on the PR. The existing actual-app measurements above/below predate this base
refresh: no new app latency, camera-parts interaction, or frame-time measurement was performed
on the rebased tree. Previous red probes and the unavailable independent review remain open;
this rebase does not establish acceptance or rollout readiness.

## Intent

Original owner request:

> implementaremos filmstrip, tambien investiga como maneja esto mediabunny o si no tiene nada que ver
>
> tambien quiero pensar en optimizaciones no quiero que esto 1. llene la memoria de un usuario 2. no haga picos de cpu usage 3. no vuelva lento nada de la UI.

Owner authorization:

> si! agregalo te doy el go $cs-autopilot

The current implementation request says:

> Continue authorized zoom-aware filmstrip implementation NIW2-844 in kaipu-record.

The authoritative AC1–14 remain in the [spec](/specs/2026-11-16-zoom-aware-filmstrip-design/).
The goal is to show what happens at each visible tile's own time, without resource growth or
slower editing. Layer 3 connects the editor behind a default-off flag; layer 4 measures it and
provides the reference document. Delivered beyond the ask: nothing. No merge or rollout is authorized.

## State

The original recovery implementation was committed at the historical head above. The five review
corrections are committed through the validated runtime head. This validation adds verifier fixture
controls and evidence documentation only; it does not change production code.
The existing layer-3 worktree was reused. Its recovery baseline was `c275ba257`; main was not edited.

The mini's after-worktree remains based on `38549dc8` with synchronized source changes. Its prior
diff and untracked latency script were preserved in `~/kaipu-evidence/niw2-844/recovery-remote.patch`
and `recovery-latency.ts` before synchronization. Do not reset that worktree or treat its dirty
state as unrelated new work. Evidence is preserved outside the worktree under `~/kaipu-evidence/niw2-844/`.
The M5 copy is in the task worktree's ignored `.evidence/niw2-844/final/` directory. A durable copy
also lives in the main checkout at `.evidence/niw2-844/recovery-b01cf0cf/`.

Stack below this layer: design PR 667 → pure logic PR 675 → worker PR 678. These PRs were read,
not modified or merged by this recovery. Layer-3 editor wiring and layer-4 evidence/reference
ship together from the existing layer-3 branch.

## What changed

| File / area                                    | Consequence and reason                                                                                                                                                                                      |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `filmstrip-controller.ts`, `use-filmstrip.ts`  | Start the worker and prepare its first file's index at editor opening; this opens metadata without requesting frames. Publish the last requested frame before decoder teardown can delay `done`.            |
| `filmstrip-messages.ts`, `filmstrip-engine.ts` | Add metadata-only `prepare`, using the existing serialized one-file lifecycle and idle close, without consuming frame pacing allowance.                                                                     |
| `components/filmstrip-tiles.tsx`               | Memoize the image child, whose props are primitives, so an unrelated frame arrival or retained tile during scroll does not rerender it. The previous ineffective parent memo had already been removed.      |
| `verify/filmstrip-latency.verify.ts`           | Prevent overlapping measurement windows: require a fresh quiet interval and completion of posted requests; assert 500 ms for every case; record errors and Webcam fixture provenance.                       |
| `verify/filmstrip-lifecycle.verify.ts`         | Observe real export busy intervals and real workspace transactions, rather than infer export completion from a delayed ready card. Verify viewport changes during export and every cached URL's revocation. |
| `verify/filmstrip-performance.verify.ts`       | Run the same scroll/jump/zoom workload three times against main and the feature, with rAF interval and long-task measurements.                                                                              |
| Reference document                             | Record measured scope, reproduction commands, preserved failures, and resource limits.                                                                                                                      |

Incidental: comment corrections and formatting only. JPEG/decoder experiments were reverted;
the shipped worker still uses the original CanvasSink path, eight-slot passes, and original pacing.

## Decisions

| Decision                                                                                          | Alternative rejected                                                     | Why                                                                                                      | Owner        | Status                               |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------ |
| Flag off by default; no merge/rollout                                                             | Enable now                                                               | Evidence must be reviewed before release                                                                 | user         | settled                              |
| Keep 500 ms assertions                                                                            | Report a late tile as passing                                            | Core feature requirement                                                                                 | user         | settled                              |
| Test AC1/2 on a genuine 30-minute 1440p screen file plus a generated 720p Webcam with +5 s offset | Treat two identical 54-minute 1440p files as the only acceptance fixture | Spec names 30 minutes; recorder prefers 720p camera input. Preserve the larger stress failure separately | agent        | open for review                      |
| Median of three p95 trials                                                                        | Cherry-pick one trial                                                    | Measurement script selected this statistic before running                                                | agent        | open: first feature trial was slower |
| 60 output thumbnails/s; internal frames capped by 300 packets per exact target                    | Count every internal codec frame against 60                              | Carried from layer 2; exact decoding can consume many packets                                            | parent agent | open to owner veto                   |
| Hardware default; software worker ends on idle                                                    | Software default / retain software worker                                | Layer-2 measured cost and retained GPU memory                                                            | parent agent | carried over, open to veto           |
| No new subagents or fresh independent local reviewer                                              | Dispatch another reviewer                                                | Current owner explicitly required solo implementation                                                    | user         | settled                              |

## Evidence and gaps

### Review correction status (2026-11-17)

Verified locally by gpt-6.1-sol; no subagents were dispatched. Local commits (not pushed):

| CodeRabbit claim                                 | Kind    | Reproduction before fix                                           | Fix commit  |
| ------------------------------------------------ | ------- | ----------------------------------------------------------------- | ----------- |
| `4597731495`                                     | correct | 30 fps tile 2 returned `skip` through `planSlot`                  | `b88b8b642` |
| `4597731516`                                     | correct | Undecoded logical-tile replacement counted zero blank samples     | `4a9b059a6` |
| `4597731529`                                     | correct | Injected report-write rejection skipped all four `finish()` calls | `4a9b059a6` |
| `4597731541`                                     | correct | Both request/no-request empty-tile rows returned `-Infinity`      | `4a9b059a6` |
| Review `5936046516`, Webcam outside-diff finding | correct | Empty legacy strips prevented stored worker frames rendering      | `64d1ff161` |

Before-fix production regressions: exit 1, 2 failed / 31 passed. Before-fix verifier
regressions: exit 1, 7 failed / 1 passed. After fixes: desktop `bun run check-types`
exit 0; `bun run test --maxWorkers=4` exit 0, 8,486 passed / 8 skipped; focused
controller/verifier run exit 0, 27 passed. Changed-file lint and pre-commit checks exit 0.
Documentation `bun run build` exit 0. `bun run proof:run --list filmstrip-editor
filmstrip-latency filmstrip-lifecycle filmstrip-performance` exit 0, four scenarios loaded;
listing does not execute them. Verifier regressions execute extracted scenario code with
injected failures/image state; they do not establish real image decoding or Electron teardown.
Session logs are preserved in the ignored `.evidence/niw2-844/review-99da38cf/` folder.

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

**Verified this recovery:**

- Parent activity, original go, exact spec AC1–14, branch/worktree state, and lower-stack targets.
- `layer-3/acceptance-30min.json`: 36–38 visible tiles, first zoom 440.1 ms, slowest warm
  jump 498.4 ms, after idle 438.4 ms. All 12 cases pass 500 ms.
- Repeat `layer-3/acceptance-final.json`: first zoom 458 ms, slowest warm jump 490.5 ms,
  after idle 437.2 ms. All 12 cases pass. Both files use a generated, not captured, Webcam.
- `layer-3/on.json`: actual owner 54-minute take, Clips only, 18/18 own-time tiles; first zoom
  332 ms and four jumps 324–333 ms. Zero minted frames during playback or continuous scroll;
  zero blank samples across 918 rAF samples / 122 source changes.
- `layer-4/lifecycle.json`: zero filmstrip requests during a real 465.6 ms export and two
  viewport changes; all seven cached URLs revoked after switching active workspace.
- `layer-4/performance-before.json` and `performance-on.json`: three p95 values main
  7.4/7.1/7.2 ms, feature 8.2/7.1/7.1 ms; median p95 7.2 → 7.1 ms; no main-thread long task
  above 50 ms. **First-trial regression remains visible; do not call every trial non-regressing.**
- `recovery-no-cdp/none-hardware.txt`: 150 requests on the 10 GB take without CDP. Tab memory
  56 → 85/80/86 MB at requests 50/100/150, then 70 MB after idle. GPU 45 MB at start,
  122 MB at request 3, 81 MB at 150, then 53 MB after idle. This is a worker probe in bare
  Electron, not an upper bound on the whole editor's memory.
- NIW2-807 log ends `chain done`. Runs above were isolated from other Electron tests/exports.
  The memory run started with 75% free system memory and 2.8 GB of allocated swap.
- Saved historical 600-request no-CDP trace was read: Tab 57 MB initially, 84 MB at 50,
  99 MB at 300, 98 MB at 600. This corrects the carried-over claim that it reached 98 MB by 50.

**Preserved failures and limits:**

- The larger two-1440p/60, 54-minute stress fixture exceeded 500 ms. Final `layer-3/stress-final.json`: first zoom 549.5 ms, slowest warm jump 594.2 ms,
  after idle 550.1 ms. The strict 500 ms assertion fails as intended. No claim that AC2 meets 500 ms for every resolution/viewport/file is justified.
- A long-source, eight-second trimmed export did not reach the ready card within 120 seconds;
  its export lifecycle probe timed out. The passing export check uses the established three-second
  fixture. Export throughput on that long source is not established by this work.
- One verification run overlapped another recovery run; `recovery-webcam24` is discarded as
  non-comparable. JPEG/downsampling experiments were exploratory and reverted.
- No real camera recording or Windows run. The Webcam offset fixture exercises the actual
  application media reader, lane binding, worker, and image swap with generated media.
- No new independent review of `c275ba257..b01cf0cf`, per the solo-work instruction. Existing
  reviews below were recovered and addressed; remote review of the eventual PR remains necessary.

**Carried over, not independently reproduced:** software retains about 290 MB GPU memory until
worker termination; hardware's lower CPU cost from layer 2; the original Playwright retention
root-cause investigation. The current no-CDP run confirms bounded hardware behavior for 150 requests.

## Recovered review findings

Wachiman 1.15.0, isolated Claude Sonnet 5.5 high, verifier off. Reports are retained at
`/tmp/w844-3/r1.json` and `r2.json` on M5. Round 1 covered `5be1b469..ea193b91`;
round 2 covered `ea193b91..c275ba257`. These are reviewer claims checked against the code:

| Finding                                                      | Verification / outcome                                                                                |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| URL revoke grace could precede publication                   | Fixed in `6e6327339`: separate per-publication grace batches; store regression test.                  |
| Worker error stalled queued lanes                            | Fixed in `6e6327339`: warning and pump remaining queue; controller test.                              |
| Software idle-close race killed an active request            | Fixed in `6e6327339`: ignore idle termination while in flight; controller test.                       |
| Parent memo never skipped renders                            | Removed in `6e6327339`; recovery memoizes only the child with primitive props.                        |
| Per-file test could use the wrong file                       | Fixed in `6e6327339`: distinguish file URLs in assertions.                                            |
| Catalog wait did not prove all tiles own-time                | Fixed in `6e6327339`: explicit false-tile wait in the catalog scenario.                               |
| Webcam offset test had opposite sign                         | Fixed in `6e6327339`: positive five-second offset and corrected expected span.                        |
| Error JSON could claim success; scenario did not assert ACs  | Fixed in `6e6327339`: catch/rethrow, error field, strict assertions.                                  |
| Header overstated blank-check sampling                       | Fixed in `6e6327339`: document animation-frame sampling.                                              |
| Latency windows could overlap before a request was posted    | Fixed in `b01cf0cf`: wait a fresh quiet interval and drain pending requests; actual-app reruns above. |
| Output-file header / error field / AC7 comment inconsistency | Fixed in `b01cf0cf`: label-based filename, catch/rethrow, and diagnostic-only arrival comment.        |

## Surfaced, not caused

- NIW2-807 benchmark files/processes are out of scope; none were modified or stopped.
- The desktop suite's unrelated workspace-move test timed out under full parallel load; its
  isolated rerun passed. Do not alter workspace logic to make this feature's checks green.
- Main's first-run workspace hint truncates in the captured editor header. Existing UI, outside scope.

## Where to attack

These are starting points, not the boundary:

1. The near-500 ms Webcam result and larger stress failure: test real camera input, wide windows,
   rapid settled jumps, and whether the output-rate cap delays visible work after margins.
2. The first p95 trial regression and the choice of repeated-run median. Reject unsupported
   universal performance claims even though there are no >50 ms long tasks in these runs.
3. Preparation/pause/reset races, late messages after workspace change, and decoder resource closure.
4. Blob lifetime and eviction during decoded-before-swap; 48 MiB counts stored JPEG bytes, not all process memory.
5. What the generated camera fixture and bare-worker memory probe do not establish.

## Reference material

- [Spec](/specs/2026-11-16-zoom-aware-filmstrip-design/)
- [True-timestamp, keyframe-first decision](/architecture/decisions/0064-timeline-thumbnails-are-stored-by-true-timestamp-and-decoded-keyframe-first/)
- [Reference and reproduction](/features/zoom-aware-filmstrip/)
- Parent activity: <t3-thread://v2/7923ee08-dbd5-4418-9181-369b24f34c19/088b1fc4-5e8b-43ed-85c8-53b5a8d2d9d9>

## Audit prompt

Read `/Users/cristiansotomayor-m5-pro/.t3/worktrees/kaipu-record-monorepo/t3-de2b21c8/apps/documentation/src/content/docs/audits/niw2-844/audit-brief.md`
and inspect this repository's change against the worker layer. Find concrete failures against the
spec, with file/line and consequence ranked by severity. The attack list is a starting point,
not the boundary. Do not reopen settled user decisions or expand into surfaced out-of-scope work.
This prompt is preserved for the parent; no reviewer was dispatched by this implementation child.
