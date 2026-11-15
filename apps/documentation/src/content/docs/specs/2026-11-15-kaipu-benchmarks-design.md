---
title: Kaipu benchmarks — design
description: A benchmark suite for the desktop app that measures memory per process, CPU, duration, output and weight in every scenario the owner named, runs repeatedly on the Mac mini, on demand on a clean GitHub-hosted runner, and keeps every run in niway-dev/kaipu-benchmarks.
sidebar:
  order: 0
---

> 🔵 Proposed: [NIW2-808](https://linear.app/niway/issue/NIW2-808/kaipu-benchmarks-measure-ram-cpu-and-bundle-weight-per-scenario-and).
> Draft design. The owner answered the first round on 2026-11-15 (recorded below as
> "Owner decisions") and asked for everything to be kept as working notes in a draft pull
> request. Nothing is built until the owner approves this page.

## Summary (one minute)

Kaipu has no repeatable performance measurement. On 2026-11-14 a 1080p export of a long take held
the whole encoded video in renderer memory (peak 6.5 GB, output file stuck at 28 bytes for four
minutes, then 5.59 GB written in about 10 s; source: the owner's sampling CSV, see
[Sources](#sources-and-unverified-claims)), and it was noticed only because the owner looked at
Activity Monitor. This design adds a benchmark suite. It drives the real production build through
each scenario the owner named (idle, recording, screenshots, editing, long-video editing, playback,
export 1080p and 4K), samples **every process** of the app (main, each renderer, GPU, utility,
native helpers) with macOS `phys_footprint`, CPU and I/O, and records duration, output and weight
(bundle chunks, packaged `.app`, `.dmg`). The **Mac mini** runs it repeatedly (nightly, on demand,
and on each desktop release pull request); a **GitHub-hosted macOS runner** runs it **on demand** as
a clean, isolated environment and measures weight on every pull request. Every run lands in a
separate public repository, **`niway-dev/kaipu-benchmarks`**, one folder per run. The first phase
collects data broadly; budgets come after a baseline exists. A field sampler, `bench:attach`, lets
the owner measure their own `bun run dev` session on a real long take with the same format.

| #   | Decision                                                                                                                                                                                                           | Why                                                                                                                                                                                         | ADR        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | The Mac mini is the authoritative benchmark machine, driven over ssh as a launchd job, never as a self-hosted Actions runner                                                                                       | Real hardware, screen-recording permission, the same machine every time; the owner wants it run many times. GitHub warns against self-hosted runners on public repositories                 | 0059 (new) |
| 2   | A `workflow_dispatch` workflow runs the suite on demand on a GitHub-hosted macOS runner, as a clean isolated environment; its numbers are a separate series                                                        | The owner wants a clean terrain on demand; a hosted VM has a different encoder path and 3 shared cores, so its numbers are never compared with the mini's                                   | 0059 (new) |
| 3   | Weight (bundle chunks, packaged `.app` manifest, `.dmg`) is measured on every pull request on a hosted runner, as a non-required sticky comment that updates only when weight changes                              | Weight is deterministic, cheap and needs no real hardware; it answers "how much did this library or animation add" before merge without touching the required check (ADR 0027)              | 0059 (new) |
| 4   | The scenario suite runs nightly on `main`, on demand for any ref, and on each desktop release pull request, which gets a commit status for its exact SHA                                                           | A nightly failure alone does not stop a release that merges between two nightlies; a status tied to the candidate's SHA does                                                                | 0061 (new) |
| 5   | Results live in `niway-dev/kaipu-benchmarks` (public): one folder per run with `run.json`, raw per-process samples and the peak breakdown, plus generated `results.md` and per-series history                      | Same pattern as `wachiman-benchmarks` and the UI catalog repository; Actions artifacts expire, `gh-pages` mixes data into the product repository, Bencher is an external dependency for now | 0060 (new) |
| 6   | Memory is `phys_footprint` of every process, sampled each second, plus the lifetime peak read before teardown and the VM-tag breakdown at the peak; RSS and `getAppMetrics()` memory are recorded but never judged | RSS hid 2.8 GB in the incident (256 MB RSS against 3.1 GB footprint); a renderer-only number misses memory that moves to main or GPU                                                        | 0061 (new) |
| 7   | Data first: the first phase records every metric listed below with no budgets except four invariants; budgets per metric are set from the baseline                                                                 | The owner wants as many metrics as possible and asked for data before thresholds; a budget with no measurement behind it is a guess                                                         | 0061 (new) |
| 8   | The export invariant is "the output file grows while exporting", checked at progress checkpoints, and the suite must fail on the last commit before the NIW2-806 fix and pass on the fix                           | Hardware-independent and noise-free; a ratio of two peaks was shown to pass while the whole output is buffered (weak point 1.1)                                                             | 0061 (new) |
| 9   | `bench:attach` samples an app the owner already launched (no Electron launch), writing the same format as a "field" series                                                                                         | The owner judges performance in `bun run dev` on real long takes; that is the only way to measure it, and it respects the rule that agents never launch Electron on the owner's laptop      | —          |
| 10  | The benchmark code lives in the monorepo at `apps/kaipu-record/bench/`; only results go to the results repository                                                                                                  | Scenarios change with the app code and must be reviewed in the same pull request; the results repository holds data only, like `wachiman-benchmarks`                                        | 0060 (new) |

## Open questions

Each has the default this design uses until the owner answers.

1. **Does the release status block the desktop release or only inform?** Blocking adds a row to
   [ADR 0052](/architecture/decisions/0052-release-candidates-verify-only-the-component-they-ship/)'s
   table and needs an ADR that amends it. _Default:_ informative for the first month while budgets
   are calibrated; then a new ADR that makes it blocking.
2. **Public or private results repository?** Fixtures are synthetic and runs record no personal
   data; the UI catalog repository was made private by the owner. _Default:_ public, since it also
   feeds the future public benchmarks page in the
   [messaging playbook](/marketing/messaging-playbook/).
3. **The long take.** Synthetic (60 min, with noise so it encodes like a real screen recording) or
   an owner recording, which cannot go to a public repository. _Default:_ synthetic, generated and
   cached on the mini by hash; a real take is optional and stays local to the mini.
4. **Is the mini on at night?** _Default:_ nightly at 03:00 local; if the host lock is held, the run
   is skipped and the skip is recorded.
5. **Windows.** _Default:_ out of scope; macOS only.
6. **[NIW2-549](https://linear.app/niway/issue/NIW2-549/ram-map-script-and-idle-dev-server-alert)**
   (RAM map script and idle dev-server alert). _Default:_ stays separate and is linked; the
   dev-server alert is a different tool. `bench:attach` may absorb its RAM map later.
7. **First budget numbers.** The "idles under ~150 MB and records under ~15% CPU" line in
   [Electron vs Tauri](/desktop/electron-vs-tauri/) was never measured. _Default:_ budgets are set
   after ten valid nightly runs on the mini.
8. **Unverified, answered by the spike (ticket 0):** whether the production build launches, plays
   and exports on `macos-15` hosted runners and with which encoder; whether the bundles build on
   Linux without the Swift step of `build:native-capture`; whether `footprint` runs there without
   extra privileges.
9. **A benchmarks repository per product.** The owner wants one for every product ("for our
   products we need a benchmarks repo to know how our performance changes"). _Default:_ Kaipu first;
   the pattern goes to the general-knowledge hub once it has run for a month.
10. **Bencher.** The owner found [Bencher](https://bencher.dev/docs/how-to/track-benchmarks)
    interesting. _Default:_ not now; it is the reopen path of ADR 0060 when statistics become the
    bottleneck. Its importer could read `history/*.jsonl` later.

## Out of scope

- Gating ordinary pull requests on a benchmark. ADR 0027 stands: the weight comment and every
  benchmark job are non-required.
- Windows and Linux performance.
- The public benchmarks page on the website (it is a later consumer of this data).
- Fixing any regression the suite finds (NIW2-806 is fixed in its own ticket).
- In-app telemetry of performance from users' machines (PostHog). This suite runs on our machines.
- Changing app code for measurement in the first phase. Everything is observed from outside the
  app (process tools, Playwright, the output file). A test-only IPC that reports bytes in flight is
  a later option (see Options, decision 5).

## Failures this must protect against

Each is a risk, not an observed event, unless a source is linked. Most come from the attack on the
first recommendation ([weak points](/specs/2026-11-15-kaipu-benchmarks-design/3-weak-points-gpt-sol/)).

1. **The export detector passes while the whole output is buffered.** A ratio of two short peaks
   passes when fixed memory dominates (illustrative: 600 MB fixed + 40 MB/min retained gives
   +18.75% from 1 to 4 minutes, and 2 GB at 54 minutes). Guarded by the output-growth invariant
   and the pre-NIW2-806 challenge run.
2. **A regression ships between two nightlies,** or the mini is off and an old pass stands.
   Guarded by the per-SHA status on the release pull request; a missing or stale result reads as
   missing, never as a pass.
3. **Memory moves to another process.** Export chunks cross IPC to main without waiting for a
   write acknowledgement (`export-runner.ts`, candidate, not diagnosis); a renderer-only number
   would stay flat. Guarded by sampling every process with its role.
4. **The peak is lost.** A renderer crashes and is replaced between samples; the app closes
   before the last read; a startup peak hides the scenario peak. Guarded by reading the lifetime
   peak before teardown, tracking PID lifetimes, phase-bounded traces, and treating an unexpected
   process exit as a failed run.
5. **Two hosts run different workloads.** `video-encoding.ts` picks encoder settings from support
   probes, so the hosted VM and the mini may produce different bytes from the same fixture.
   Guarded by keying every series by host, build type, encoder configuration and fixture hash.
6. **Cold runs miss the owner's real session.** Repeated editing and exporting in one process can
   accumulate memory that a fresh launch never shows; dev-mode React costs do not exist in a
   production build. Guarded by the warm-session scenario and the `bench:attach` field series.
7. **The mini is busy.** A UI catalog run or an agent's verify run overlaps a benchmark. Guarded by
   one host lock honoured by all three, and contaminated runs marked invalid.
8. **History stops being comparable.** An Electron upgrade, a regenerated fixture or a changed
   scenario wait changes the numbers with no record. Guarded by the run manifest (identities,
   versions, hashes, environment) and by starting a new series when a material dimension changes.
9. **Bundle weight is not shipped weight.** An externalized dependency or a native helper grows the
   `.app` while the bundle stays flat. Guarded by three weight layers.
10. **A failure becomes absent data.** An OOM, a hang, a skipped codec or a failed upload must
    produce a failed or incomplete run, never a missing row that reads as fine.

## Acceptance criteria

- [ ] `bun run bench:remote --scenario export-1080p --ref <sha>` on the mini produces a run folder
      with `run.json` that validates against the schema, per-process `samples.csv`, the peak
      breakdown, and a completion manifest that lists every scenario as passed, failed or skipped.
- [ ] Every process of the app appears in `samples.csv` with its role (main, renderer and its
      window, GPU, utility, native helper); an unexpected process exit marks the scenario failed.
- [ ] On the last `main` commit before the NIW2-806 fix, the export output-growth invariant fails;
      on the fix commit it passes.
- [ ] A benchmark and a UI catalog run started at the same time on the mini never overlap: the
      second waits or skips, and says so.
- [ ] A pull request that adds a dependency gets a weight comment with the delta per bundle chunk,
      packaged `.app` bytes and `.dmg` bytes; a pull request with no weight change gets no new
      comment.
- [ ] `gh workflow run benchmarks.yml -f ref=<sha>` runs on a hosted macOS runner and publishes a
      run whose series key names the hosted environment.
- [ ] A nightly run publishes to `niway-dev/kaipu-benchmarks`, and `results.md` shows it at the top.
- [ ] A desktop release pull request carries a `benchmarks/mini` commit status for its head SHA; a
      result for another SHA, or none, shows as missing.
- [ ] `bun run bench:attach` started next to the owner's running `bun run dev` session records the
      same per-process columns as a mini run, without launching Electron.
- [ ] Every scenario in the scenario table has run at least once on the mini and appears in
      `results.md`.

---

## Owner decisions (2026-11-15)

The owner answered the first design round in Spanish; translated here.

1. **Where it runs: option 1b, plus an on-demand workflow.** "I like the Mac mini, to run it many
   times. Also prepare a GitHub workflow that runs on demand, for when we want an isolated
   terrain." → Decisions 1 and 2.
2. **When it runs: the recommendation** (nightly and on demand, weight on every pull request,
   per-SHA status on the release pull request). → Decisions 3 and 4.
3. **Storage: `kaipu-benchmarks`.** "Bencher is very interesting! For now I was thinking of
   kaipu-benchmarks, I like that one. For our products we need a benchmarks repository, to know how
   our performance changes." → Decision 5; open questions 9 and 10.
4. **Regressions: the recommendation**, with an emphasis: "the idea is to create many metrics. For
   that we need to benchmark everything possible, so we need data." → Decision 7.
5. **Measurement: every possible metric.** "Use all possible metrics. The ones you showed are fine,
   and also measure the processes." → Decision 6 and the metric catalogue below.
6. **Field sampler: "Can we do that? It would be great for trying things."** Yes; see
   [Field sampler](#field-sampler-benchattach). → Decision 9.

Questions the owner did not answer are the open questions above, with their defaults.

## What the repository already says

From the [repo sweep](/specs/2026-11-15-kaipu-benchmarks-design/1-repo-sweep-haiku/), checked by the
main session where it mattered.

- **No performance measurement exists.** No workflow measures size, memory or time, and
  `apps/kaipu-record/src` has no `getAppMetrics`, `performance.mark` or `PerformanceObserver`. The
  only memory harness is a spike, `apps/kaipu-record/scripts/spikes/image-editor-m0/color-memory/`,
  which already pairs `app.getAppMetrics()` with `footprint`.
- **The backlog promised it.** [Recording compositor perf](/backlog/recording-compositor-perf/)
  says "Measure before optimizing" and linked a "Benchmark propio" item that did not exist; it now
  links this page.
- **One budget is written down and unchecked:** "idles under ~150 MB and records under ~15% CPU"
  ([Electron vs Tauri](/desktop/electron-vs-tauri/)). The hub's
  [electron-vs-tauri](https://github.com/csdev19/general-knowledge/blob/main/desktop/electron-vs-tauri.md)
  page says how to measure it: sum `phys_footprint` over the main process and every descendant,
  about 20 s after launch, and "RSS under-counts because of memory compression".
- **The messaging playbook wants these numbers** for a public benchmarks page: idle RAM, CPU at
  1080p60, installer size, time to first frame, export time of a one-minute clip.
- **The drivers exist.** `apps/kaipu-record/e2e/helpers/launch.ts` launches the built app through
  Playwright's `_electron` with an isolated user-data directory. `scripts/ui-catalog-remote.sh` runs
  the app on the mini over ssh as a launchd job. `verify/timeline-zoom.verify.ts` already generates
  a 10-minute `testsrc2` fixture with ffmpeg.
- **ADR 0027 and ADR 0052** give ordinary pull requests an immediate pass and verify only release
  candidates. A non-required weight comment does not touch the required check; a blocking benchmark
  on the release pull request would amend ADR 0052 (open question 1).
- **ADR 0044 and ADR 0045** make the mini the place where the real app runs for pictures, and keep
  the catalog's images in a separate repository. This design reuses both patterns.
- **ADR 0006** says macOS runners bill at ten times the Linux rate. The repository is public now, so
  standard hosted runners cost no minutes; the hub's
  [CI runner cost](https://github.com/csdev19/general-knowledge/blob/main/monorepos/ci-runner-cost.md)
  page still applies to artifact storage ("Set `retention-days` explicitly on anything large").

## What the state of the art does

From the [state-of-the-art research](/specs/2026-11-15-kaipu-benchmarks-design/2-state-of-the-art-sonnet/).
Public material on how Electron and video apps benchmark is thin; these are the parts that held.

- **VS Code** launches the real app, takes the median of several runs and compares against a
  released build with Welch's t-test; memory metrics are informational and never fail CI
  ([chat-perf skill mirror](https://skills.sh/microsoft/vscode/chat-perf), paths not checked in
  microsoft/vscode).
- **Mozilla Perfherder** compares about 12 earlier revisions with a t-test plus a magnitude
  threshold; a 2026 study of 17,989 alerts reports many false positives from noise
  ([arXiv](https://arxiv.org/pdf/2606.18377)). **Chromium** groups anomalies per series and bisects
  with Pinpoint ([docs](https://chromium.googlesource.com/chromium/src/+/main/docs/speed/addressing_performance_regressions.md)).
- **History storage:** [github-action-benchmark](https://github.com/benchmark-action/github-action-benchmark)
  keeps data on `gh-pages` and alerts on a percentage against the previous point only;
  [Bencher](https://bencher.dev/docs/how-to/track-benchmarks) has t-test thresholds and is free for
  public projects, but fork pull requests get no token;
  [CodSpeed](https://codspeed.io/changelog/2026-01-21-track-memory-usage-with-memory-instrument)
  measures memory only for Rust and C/C++.
- **Hosted macOS runners:** M1, 3 cores, 7 GB RAM, a VM, no Metal Performance Shaders
  ([GitHub docs](https://docs.github.com/en/actions/reference/runners/github-hosted-runners),
  [runner-images #9254](https://github.com/actions/runner-images/issues/9254)). No known
  non-interactive grant of screen-recording permission; on Sequoia an ad-hoc build fails the
  preflight ([Cap #1722](https://github.com/CapSoftware/Cap/issues/1722)). Hardware encode under
  WebCodecs on the VM is unknown.
- **Self-hosted runners** "should almost never be used for public repositories"
  ([GitHub security guide](https://docs.github.com/en/actions/reference/security/secure-use)).
- **macOS memory:** `footprint` reports `phys_footprint` and `phys_footprint_peak` (checked on the
  M5 on 2026-11-14); Firefox moved to `phys_footprint` because it matches Activity Monitor
  ([bug 1786860](https://bugzilla.mozilla.org/show_bug.cgi?id=1786860)). Electron's
  `getAppMetrics()` memory is RSS-like on macOS, so it serves to identify processes, not to measure
  them.

## Options considered

The first design round offered these options. The owner's answers are under
[Owner decisions](#owner-decisions-2026-11-15); the rejected alternatives also live in the ADRs.

### 1. Where the scenarios run

- **1a. Only the GitHub-hosted macOS runner.** Free and automatic. Against: it cannot record the
  screen or take screenshots, export may take another encoder path than a real Mac, and with 3
  shared cores time and CPU are noisy.
- **1b. Only the Mac mini, over ssh and launchd** (like the UI catalog). Real hardware, every
  scenario. Against: one machine shared with the catalog and verify runs; no data when it is off.
- **1c. Both, each where it is honest:** hosted for weight on every pull request and, after the
  spike, structure checks as a separate series; the mini as the authoritative series for every
  scenario.
- Rejected outright: a self-hosted Actions runner on the mini (GitHub's warning above).
- **Chosen:** 1b plus an on-demand hosted workflow, and hosted weight on every pull request (from
  1c and option 2b).

### 2. When it runs

- **2a.** Nightly on `main`, plus on demand for a branch.
- **2b.** Also weight on every pull request, as a comment updated only when weight changes.
- **2c.** Also a commit status on the desktop release pull request, tied to the candidate's exact
  SHA; a missing or stale result says so.
- **Chosen:** all three. 2c exists because a nightly failure email does not stop a release that
  merges between two nightlies (weak point 1.2).

### 3. Where results are kept

- **3a.** Actions artifacts only. They expire (90 days by default), and the history is the point.
- **3b.** github-action-benchmark on `gh-pages`. Free charts; compares only with the previous point
  and puts data in the product repository.
- **3c.** Bencher.dev. Statistics and pull request comments; data in an external service, and the
  mini would hold a token.
- **3d.** An own repository, `niway-dev/kaipu-benchmarks`, like `wachiman-benchmarks`.
- **Chosen:** 3d. Bencher is the reopen path.

### 4. What counts as a regression

- **4a.** Report only; the owner reads `results.md`.
- **4b.** Absolute budgets per scenario in a file in the monorepo; a pull request that adds
  something heavy raises its budget on purpose, visible in the diff.
- **4c.** Statistical comparison against a baseline, several repeats, Mann-Whitney, as VS Code and
  Mozilla do.
- **Chosen:** by metric type. Memory and weight: budgets (4b), set from the baseline. Time and CPU:
  relative to the last release on the same host, three repeats, reported only for the first weeks,
  4c later. Four invariants hold from the first day (see [Regression policy](#regression-policy)).

### 5. How it measures

One sane option, argued against anyway: a fresh app launch per scenario from the production build
through `launch.ts`, every process identified by `getAppMetrics()` and sampled with `footprint`,
`ps` and per-process resource usage, the lifetime peak read before teardown, phase marks from the
driver. No app code changes in the first phase. The alternative, a test-only IPC that reports bytes
produced, forwarded and written during export, is more precise and changes the app; it stays a
later option. **Chosen:** as described, extended to every metric in the catalogue.

### 6. A field series with `bench:attach`

The owner runs it next to their own `bun run dev` session on a real long take. It attaches to an
app that is already open, writes the same `run.json` marked "field / dev". Against: not
reproducible, and it depends on the owner remembering to run it. **Chosen:** yes, as a late slice.

## Scenarios

A scenario is a script of steps the driver performs on a fresh launch, with a phase mark at each
step. Every scenario records the full metric catalogue. Durations are first-phase defaults.

| Scenario            | Steps (phase marks)                                                                                     | Where                  | Needs                       |
| ------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------- |
| `startup`           | launch → first window → library interactive                                                             | mini, hosted           | —                           |
| `idle`              | launch → 20 s settle → 5 min idle with the library open; prewarmed hidden windows counted               | mini, hosted           | —                           |
| `idle-tray`         | as `idle`, main window closed, only the tray and prewarmed windows alive                                | mini, hosted           | —                           |
| `record-1080p`      | start → 1 min and 10 min screen recording → stop → file finalized                                       | mini                   | screen-recording permission |
| `record-1080p-full` | as above with microphone and webcam                                                                     | mini                   | permissions, camera         |
| `screenshot`        | area capture → full-screen capture → burst of 20 → image editor open on the last one                    | mini                   | screen-recording permission |
| `edit-short`        | open a 3-min take → cut, zoom, scrub for 60 s → save                                                    | mini, hosted           | fixture                     |
| `edit-long`         | open a 60-min take → timeline render → scrub across the whole take → cuts → save                        | mini                   | long fixture                |
| `warm-session`      | open the 60-min take → edit → play 2 min → export 1080p → edit again → export again, all in one process | mini                   | long fixture                |
| `playback-1080p`    | editor preview plays 2 min of a 1080p take                                                              | mini, hosted           | fixture                     |
| `playback-4k`       | as above at 4K                                                                                          | mini                   | 4K fixture                  |
| `export-1080p`      | export 1 min, 10 min and 60 min inputs at 1080p; output checked                                         | mini, hosted (≤10 min) | fixtures                    |
| `export-4k`         | export 1 min and 10 min at 4K                                                                           | mini                   | 4K fixtures                 |
| `library-many`      | library with 500 items: open, scroll, search                                                            | mini, hosted           | seeded workspace            |

Fixtures are generated with ffmpeg (`testsrc2` with an added noise layer so they encode with
screen-recording-like bitrates, plus a `sine` audio track), cached on the mini by a hash of their
generation command, and their hash goes into `run.json`. Output size, not only duration, decides
whether a fixture is heavy enough to expose buffering.

## Metric catalogue

The owner asked for every possible metric. All are recorded in the first phase; budgets come later.

**Per process, sampled every second** (role from `getAppMetrics()` `type` and, for renderers, the
window's URL and render target; native helpers by parent PID):

- `phys_footprint` (from `footprint`), RSS (for comparison only), compressed bytes where reported.
- CPU percent, cumulative user and system CPU time.
- Disk bytes read and written; idle and interrupt wakeups (energy proxy).
- Thread count, open file descriptors.

**Per process, once per scenario:** `phys_footprint_peak` read before teardown, and the `footprint`
VM-tag breakdown at the end of the heaviest phase (V8, IOSurface, malloc, IOKit and the rest; in
the incident most memory sat under the V8 tag).

**System, sampled every second:** memory pressure, swap used, compressed memory (`vm_stat`), load
average, thermal state, GPU utilization and GPU "in use system memory" (`ioreg` IOAccelerator
statistics, no root needed). Load average before the run starts, to judge if the host was quiet.

**Renderer internals, through Playwright and the DevTools protocol:** JS heap used and total, DOM
nodes, documents, event listeners, layout and style recalculation counts, script and task duration
(`Performance.getMetrics`), long tasks, frame rate during scrub and playback (an
`requestAnimationFrame` counter injected by the driver), dropped video frames
(`getVideoPlaybackQuality()`).

**Scenario outcome:** wall time per phase; time to first window and to an interactive library;
recording start latency (click to recording state) and stop-to-finalized latency; recorded MB per
minute and frames captured against expected; export realtime factor (media seconds per wall
second); output bytes, bitrate, frame count, duration match and audio presence (ffprobe); A/V
start-time offset; output bytes on disk at 25%, 50% and 75% of export progress.

**Weight, per build:** raw, gzip and brotli bytes per chunk of `out/main`, `out/preload` and
`out/renderer`; assets by type (images, fonts, wasm, media); `app.asar` size and its top-level
dependencies by size; unpacked resources and native binaries; packaged `.app` total; `.dmg` and
`.zip` bytes; dependency count. Weight runs on every pull request; startup and idle tie weight to
runtime cost.

## Measurement method

1. **Build** the production app at the requested ref (`electron-vite build` plus `build:unpack` for
   the packaged layout). Dev builds are measured only by `bench:attach`.
2. **Launch fresh** for each scenario through `e2e/helpers/launch.ts`, isolated user-data directory
   and seeded workspace.
3. **Map processes**: `getAppMetrics()` gives PID, type and creation time; renderers are matched to
   windows through `webContents.getOSProcessId()`; descendants of the main PID that Electron does
   not list (native helpers) are found by parent PID.
4. **Sample** every second in a sampler process outside the app. The sampler starts before launch
   and survives a crash.
5. **Mark phases** from the driver with monotonic timestamps; every sample row carries the current
   phase.
6. **Read peaks** of every live process before teardown; a process that exited early is recorded
   with its last sample and its exit, and an unexpected exit fails the scenario.
7. **Verify the outcome** (a finalized output with the expected duration, dimensions and tracks)
   before the scenario counts as passed.
8. **Write** the run folder and the completion manifest, then publish.

## Runners

### Mac mini (authoritative series)

- `bun run bench:remote [--ref <sha>] [--scenario <glob>] [--repeat <n>] [--status]`, modelled on
  `scripts/ui-catalog-remote.sh`: ssh to `macmini`, a private worktree for benchmarks, a launchd
  job so the app runs in the console session with screen-recording permission.
- **Host lock** shared with the UI catalog and the verify runner: whoever holds it runs; the others
  wait up to a limit or skip and record the skip. Changes to `ui-catalog-remote.sh` and the verify
  runner are part of the build.
- **Nightly**: a launchd timer on the mini fetches `origin/main`, runs the full suite and publishes.
- **Release pull request**: running with `--status` posts a `benchmarks/mini` commit status on the
  candidate's head SHA with a link to the run. Informative until open question 1 is answered.

### Hosted runner (on demand, clean environment)

- `.github/workflows/benchmarks.yml`, `workflow_dispatch` only, inputs `ref`, `scenarios`,
  `repeat`. Runs the scenarios the spike proves possible on `macos-15`, as the series
  `hosted-macos-15`, and publishes with a token scoped to the results repository. Dispatch-only, so
  no fork pull request reaches the token.

### Weight on every pull request

- `.github/workflows/bench-weight.yml` on `pull_request`, non-required, `cancel-in-progress` per
  pull request. Builds, measures the weight layers, compares with the latest `main` weight in the
  results repository and updates one sticky comment only when a layer changes. Runner (Linux or
  macOS) is decided by the spike.

## Results repository

`niway-dev/kaipu-benchmarks`, public (open question 2). Creating it is an owner step.

```text
README.md                         generated: latest run per series, how to read it
results.md                        generated: every run, newest first
history/<series>.jsonl            one line per scenario per run, for charts and comparison
runs/<YYYY-MM-DD>T<HHMM>-<sha7>-<host>/
  run.json                        manifest: identities, environment, completion, summaries, verdicts
  weight.json
  scenarios/<scenario>/samples.csv.gz     per-process and system time series
  scenarios/<scenario>/peaks.json         lifetime peaks per process
  scenarios/<scenario>/footprint-peak.txt VM-tag breakdown
scripts/                          render results.md, compare two runs
```

**Series key:** host, build type (production or dev), encoder configuration, fixture hash, schema
version. A change in any of them starts a new series; runs are compared only inside a series.

**`run.json` identities:** app SHA and version, benchmark code SHA, schema and scenario versions,
lockfile hash, Electron and Chromium versions, fixture hashes, encoder settings chosen, macOS
version, hardware model, RAM, runner image (hosted), display scale, load average at start, budgets
file hash and each verdict.

## Regression policy

**Phase 1, data (now):** record everything; no budgets. Four invariants hold from the first run,
because they do not depend on a baseline:

1. **Export streams:** the output file grows during export; at 50% progress at least 30% of the
   final bytes are on disk (thresholds tuned on the first runs). The challenge run on the commit
   before the NIW2-806 fix must fail it.
2. **Idle is idle:** after 20 s settle, summed CPU of all processes averages under 1% over 60 s.
3. **No unexpected process exit** in any scenario.
4. **Complete outcome:** a scenario without a verified output is failed, never skipped silently.

**Phase 2, budgets (after ten valid nightly runs):** memory and weight get absolute budgets in
`apps/kaipu-record/bench/budgets.json`, per scenario and process role, from the baseline plus a
margin. Time and CPU are compared with the last release on the same series, three repeats, as a
report; a statistical test (Mann-Whitney) replaces it when there are enough runs.

## Field sampler (`bench:attach`)

Yes, it can be done, and it needs no app change:

- The owner starts `bun run dev` as usual, then `bun run bench:attach` in another terminal.
- It finds the dev app's processes (the Electron binary of the dev run and its descendants) and
  reads each role from the `--type=` argument Chromium passes to its child processes (renderer,
  gpu-process, utility). It cannot match a renderer to a window from outside; that limit is
  recorded.
- It samples the same per-process and system columns every second until stopped. The owner types a
  label and Enter to add a phase mark ("export start", "scrub").
- It writes the same run folder with series "field / dev / owner-M5", and publishes only with
  `--publish`. It records no file names or titles.
- It never launches Electron, so it respects the rule that agents do not run Electron on the
  owner's laptop. The owner runs it; an agent runs it only when asked.

## Proposed build tickets

Created in Linear after the owner approves this design.

0. **Spike: hosted runner.** Does the production build launch, play and export a 1080p fixture on
   `macos-15`; which encoder path; does `footprint` work; do the bundles build on Linux without the
   Swift step. Decides the hosted scope and the weight runner.
1. **Measurement core** in `apps/kaipu-record/bench/`: sampler, process role map, phase marks,
   `run.json` schema with validation, crash and completion handling, unit tests on parsers against
   real `footprint` and `ps` output.
2. **Results repository and publisher:** create `niway-dev/kaipu-benchmarks` (owner), layout,
   `results.md` and history generators, compare script.
3. **Mini runner, host lock and `export-1080p`**, with the output-growth invariant and the
   challenge run on the pre-NIW2-806 commit.
4. **Weight on every pull request**, three layers and the sticky comment.
5. **Scenarios A on the mini:** startup, idle, idle-tray, playback, edit-short, edit-long,
   warm-session, export-4k, library-many.
6. **Scenarios B on the mini:** record-1080p, record-1080p-full, screenshot.
7. **Nightly and release status** on the mini.
8. **Hosted on-demand workflow** `benchmarks.yml` (after 0).
9. **`bench:attach` field sampler.**
10. **Budgets** from the baseline (after ten valid nightly runs).

## Weak points of the first recommendation, and what changed

The first recommendation was attacked by gpt-6.1-sol with high reasoning
([full report](/specs/2026-11-15-kaipu-benchmarks-design/3-weak-points-gpt-sol/)). All nine weak
points were judged real against the repository; none was handled by existing code.

| #   | Weak point                                                          | Answer in this design                                                   |
| --- | ------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1.1 | A 30% ratio of two export peaks passes while the output is buffered | Output-growth invariant, output-volume fixtures, pre-NIW2-806 challenge |
| 1.2 | A nightly failure does not stop a release                           | Per-SHA `benchmarks/mini` status on the release pull request            |
| 1.3 | A renderer peak is not an application peak                          | Every process with its role; peaks never summed across time             |
| 1.4 | A lifetime peak can be lost or contaminated by startup              | Peaks read before teardown, PID lifetimes, phase traces, exit = failure |
| 1.5 | Hosted and physical Macs may run different encoders                 | Series keyed by host and encoder configuration; never cross-compared    |
| 1.6 | Cold synthetic runs miss the owner's session                        | `warm-session` scenario and the `bench:attach` field series             |
| 1.7 | launchd does not isolate the mini                                   | One host lock for benchmarks, catalog and verify                        |
| 1.8 | A shared schema does not make history comparable                    | Run manifest with identities and hashes; new series on material change  |
| 1.9 | Bundle weight is not shipped weight                                 | Three weight layers: chunks, `.app` manifest, `.dmg`                    |

## Sources and unverified claims

- **The incident:** the owner's sampling of the real app on 2026-11-14, `.session/export-perf/sample.sh`
  and `export-df9e7ec0.csv` (untracked, main checkout). The CSV shows renderer footprint rising
  from 4,665 MB at 15:27:43 to 6,519 MB at 15:31:30 while the `.part` file stayed at 28 bytes, then
  5,585,759,856 bytes at 15:31:41 and the renderer at 830 MB. The RSS-versus-footprint comparison
  (256 MB against 3.1 GB) and the V8 VM-tag attribution come from the same session's `footprint`
  output, not kept in the CSV. Fix: [NIW2-806](https://linear.app/niway/issue/NIW2-806).
- **The prototype sampler** takes fixed PIDs and samples every 10 s; this design replaces it.
- **`footprint` prints `phys_footprint_peak`:** checked on the M5 on 2026-11-14 against a shell
  process. That it is the process lifetime peak is assumed and is part of ticket 1's tests.
- **Unverified:** WebCodecs hardware encode on hosted runners; Linux bundle build without the Swift
  step; `ioreg` GPU statistics on the mini's macOS version; the noise level of the mini between
  nightly runs (measured by the first ten runs).
- **Research reports, verbatim:** [repo sweep](/specs/2026-11-15-kaipu-benchmarks-design/1-repo-sweep-haiku/),
  [state of the art](/specs/2026-11-15-kaipu-benchmarks-design/2-state-of-the-art-sonnet/),
  [weak points](/specs/2026-11-15-kaipu-benchmarks-design/3-weak-points-gpt-sol/).
- **ADRs created:** [0059](/architecture/decisions/0059-benchmarks-run-on-the-mac-mini-and-on-demand-on-a-hosted-runner/),
  [0060](/architecture/decisions/0060-benchmark-results-live-in-niway-dev-kaipu-benchmarks/),
  [0061](/architecture/decisions/0061-benchmarks-measure-every-process-and-collect-data-before-budgets/).
