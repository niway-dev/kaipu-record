---
title: Zoom-aware filmstrip recovery audit brief
description: Verified implementation, review findings, measurement limits, and remaining owner decisions for NIW2-844.
---

# Audit brief — zoom-aware filmstrip recovery

**Branch** `feature/niw2-844-3-filmstrip-editor` · **Implementation head** `b01cf0cfc60f99b23728b12f1c32d1c70056b892` · **Generated** 2026-11-17

**Historical baseline check:** desktop type checks → exit 0; targeted filmstrip suites → exit 0, 183 tests. The
first full desktop run passed 8,475 tests / 8 skipped. A later full run hit one unrelated
5-second workspace-move timeout; that file passed alone (42 tests). The bounded-worker full rerun (`bun run test --maxWorkers=4`) passed 8,475 tests / 8 skipped, exit 0. Documentation build → exit 0. Real-app scenarios below exercised the
compiled renderer and worker, not jsdom. All 15 changed production source files matched the
mini by SHA-256 (`source-manifest.json` in the M5 evidence folder).

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

All implementation and verification scripts are committed through the implementation head above.
This brief and the reference are a separate documentation commit; they do not change tested code.
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
