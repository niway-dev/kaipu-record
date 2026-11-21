---
title: "Kaipu benchmarks: weak points of the first recommendation (gpt-6.1-sol)"
description: "Verbatim attack on the first recommendation (hosted runner plus Mac mini, a 30% export-memory invariant, nightly failures as the only alarm), from gpt-6.1-sol with high reasoning, 2026-11-14."
sidebar:
  order: 3
---

> **Raw research, kept verbatim.** Attacker: gpt-6.1-sol (Codex, reasoning effort high, read-only on the repository), 2026-11-14, through cs-find-weak-points. It saw only the claims and the facts, not the reasoning or the alternatives. Its brief is quoted first, then its report exactly as it came back, with local absolute paths made repo-relative. It is evidence for the [Kaipu benchmarks design](/specs/2026-11-15-kaipu-benchmarks-design/), not a decision: where they disagree, the spec wins.

## The brief it received

```text
Act as the review sub-agent for this task.

Do not edit any file. Do not run the Electron app. You may read the repository in the current directory (niway-dev/kaipu-record, a public monorepo; desktop app in apps/kaipu-record) and the web.

Someone is confident in the claims below. Your job is to find where they are weak. Do not balance them with their strengths and do not soften findings.

Claims:
A. A performance benchmark suite for the Electron desktop app can be split across two places and stay trustworthy over time: (1) the GitHub-hosted macOS runner (macos-15, arm64 VM) measures bundle weight, idle, editing, playback and export memory of the production build (electron-vite build, launched with Playwright's _electron) on synthetic ffmpeg testsrc fixtures; (2) a Mac mini on the owner's desk, driven over ssh as a launchd job (never as a self-hosted Actions runner), measures screen recording, screenshots, 4K export, long takes (10–60 min) and the timing/CPU numbers. Both write the same JSON schema per run into a separate public repository (niway-dev/kaipu-benchmarks), one folder per run.
B. A memory regression like "the export holds the whole encoded video in renderer RAM" is reliably caught by (i) an invariant: renderer peak phys_footprint exporting a 4-minute input exceeds the peak for a 1-minute input by less than 30%, and (ii) absolute per-scenario budgets; the peak is read from `footprint -p <pid>`'s phys_footprint_peak after launching a fresh app per scenario, so 1-second interval sampling cannot miss the peak.
C. No benchmark gates a merge. A budget breach shows as a failed nightly run on main (owner gets the GitHub failure email or sees it in the results repo) and is checked on the desktop release pull request, and that is enough to stop regressions from shipping.

Facts they must hold against (verified unless marked):
- Incident 2026-11-14 (verified, owner's sampling): during a ~5.6 GB 1080p export of a long take, renderer phys_footprint grew from 4.6 GB to 6.5 GB over ~4 min while the output file stayed at 28 bytes; then 5.59 GB were written in ~10 s and footprint dropped to ~0.6 GB. RSS showed 256 MB against a 3.1 GB footprint at one point. Most of the memory was under the V8 VM tag. Export runs in the renderer with WebCodecs + mediabunny.
- `footprint -p <pid>` prints phys_footprint and phys_footprint_peak (verified on this machine). phys_footprint_peak is the process lifetime peak (assumed).
- Electron is multi-process: main, one or more renderers (one per BrowserWindow; the app has several floating windows, some prewarmed hidden), GPU process, utility/network processes.
- GitHub-hosted free macOS runner: M1 arm64, 3 cores, 7 GB RAM, VM on Apple Virtualization Framework, Metal Performance Shaders not supported (verified, GitHub docs). Screen-recording TCC permission cannot be granted non-interactively on hosted images (assumed). Whether VideoToolbox hardware encode is available to WebCodecs there is unknown.
- GitHub says self-hosted runners should almost never be used with public repositories (verified).
- ADR 0027 (accepted): ordinary PRs get an immediate pass on the required check; full verification incl. macOS E2E runs only on release-please PRs and manual dispatch. The owner wants fast merges and accepts finding regressions on the release PR.
- The Mac mini also runs the UI state catalog (ADR 0044, a ~10-min launchd job driven over ssh) and verify scenarios for agents, on demand; it is the owner's machine with the owner logged in at the console (verified). Agents must never run Electron on the owner's laptop (rule).
- The owner judges performance in `bun run dev` (dev build, React dev mode) on real long takes, around 54 minutes (verified); dev-mode React costs were measured at ~600 ms per commit in one case.
- Existing building blocks (verified): Playwright Electron launch helper apps/kaipu-record/e2e/helpers/launch.ts (isolated user-data-dir per launch), verify scenarios in apps/kaipu-record/verify/ (one generates a 10-min ffmpeg testsrc2 1280x720 fixture), scripts/ui-catalog-remote.sh (ssh + launchd on the mini), a spike apps/kaipu-record/scripts/spikes/image-editor-m0/color-memory/ that uses app.getAppMetrics() and footprint.
- Owner's goal: measure RAM, CPU and weight for idle, recording, screenshots, editing, editing long videos, export 1080p, export 4K, playback; know how much weight a big animation or an added/removed library adds; keep the results over time.

Write a Markdown document with these sections:
1. Weak points, most serious first. For each: what breaks, the concrete scenario (inputs, state, sequence) in which it breaks, how likely it is, the evidence that would confirm or rule it out, and one way to fix or contain it.
2. Hidden assumptions the claims need to be true.
3. Alternatives that beat the claims, and under which conditions.
4. What would change your mind: the observation that would make the claims safe.
Mark what you know versus what you infer. Say so if you found nothing serious; do not invent weak points to fill the list. Reply with the document only.

```

## The report

# Review of the proposed desktop benchmarks

Serious weaknesses exist in all three claims. **B does not reliably detect whole-output buffering, C does not establish a release barrier, and A lacks the controls needed to make historical results comparable.**

**Evidence labels:** **Known** means supplied verified facts, repository code inspected during this review, or cited primary documentation. **Inferred** means a plausible failure mechanism that has not been demonstrated by running the benchmarks. No files were edited and Electron was not launched.

## 1. Weak points, most serious first

### 1.1 The 30% invariant can pass while the renderer buffers the entire output — claim B

**What breaks:** Comparing total process peaks confounds fixed memory with memory that grows with output size. Absolute budgets do not repair this unless the fixtures produce enough bytes to cross them.

**Concrete scenario:** An illustrative renderer has 600 MB of fixed memory and retains 40 MB of encoded output per minute:

- One-minute export peak: 640 MB.
- Four-minute export peak: 760 MB.
- Increase: 18.75%, so the invariant passes.
- A 54-minute export retains 2,160 MB of output, in addition to fixed memory.

Both short exports can also pass an absolute budget above 760 MB. Startup or editor-initialization peaks can mask the difference further.

**Known:** The supplied incident involved approximately 5.6 GB of output and multi-gigabyte renderer footprint. The inspected export presets support constant-quality encoding, whose output size depends on content. Mediabunny explicitly distinguishes whole-file buffering from streaming targets. [Mediabunny output documentation](https://mediabunny.dev/guide/writing-media-files)

**Likelihood:** The mathematical false negative is certain under the illustrative conditions. Whether the selected fixtures meet those conditions is unmeasured. The claimed reliability is unsupported until demonstrated.

**Evidence:** Run a deliberately whole-output-buffering implementation against the actual one- and four-minute fixtures and budgets. Record output bytes, startup peak, export-phase footprint and final peak. A passing result disproves the detector immediately.

**Containment:** Require the suite to reject this deliberate regression. Choose fixtures by encoded output volume as well as duration, and supplement short tests with a multi-gigabyte export and a limit on outstanding encoded bytes.

### 1.2 Nightly failure plus email does not stop a release — claim C

**What breaks:** Detection and notification do not establish that the exact release candidate was measured and accepted.

**Concrete scenario:** A regression merges after the nightly run. The desktop release PR is updated and merged before the next nightly. Its latest recorded benchmark belongs to an earlier SHA. Alternatively, the mini is unavailable, leaving an old passing result while hosted measurements continue.

**Known:** The accepted [release-candidate verification decision](/architecture/decisions/0027-verify-release-candidates-only/) deliberately permits ordinary merges without full verification. Claim C adds no explicit freshness rule, exact-SHA requirement, missing-result policy or enforced acceptance record for benchmarks.

**Likelihood:** Structurally possible whenever releases occur between nightly runs. The frequency depends on release practice; email attention is not a measurable barrier.

**Evidence:** Exercise a release with a stale passing result, an absent mini result and a known budget breach. Observe whether each prevents publication of that candidate.

**Containment:** Keep ordinary PRs fast, but require an exact-candidate benchmark attestation before release approval or publication. Missing, stale and incomplete results must block that release step. A documented manual barrier can work, but its acceptance record must identify the candidate and both benchmark runs.

### 1.3 A renderer peak is not an application memory peak — claims A and B

**What breaks:** Measuring one renderer misses memory in other renderers, main, GPU and utility processes. Changes can move allocations across process boundaries without reducing application cost.

**Concrete scenario:** Export chunks leave the worker promptly but accumulate in main-process IPC or disk-write queues. The measured renderer stays within budget while application memory grows. Alternatively, the harness follows the first window, while the expensive operation runs in another renderer.

**Known:** The launch helper returns `app.firstWindow()`. Its comments acknowledge multiple-window races. The export worker transfers chunks to its renderer; [`export-runner.ts`](https://github.com/niway-dev/kaipu-record/blob/main/apps/kaipu-record/src/renderer/src/features/video-editor/export/export-runner.ts) forwards them through `recordingWrite`. The worker’s stream callback posts data without waiting for a disk-write acknowledgement.

**Inferred:** Unbounded accumulation in those queues is a candidate failure, not an established diagnosis of the incident.

**Likelihood:** High exposure because multiple processes and the export handoff already exist. The location and magnitude of any accumulation remain unmeasured.

**Evidence:** Associate window identity and route with OS PID throughout the run. Capture main, every renderer, GPU and utility processes alongside bytes produced, forwarded and written.

**Containment:** Retain per-role budgets and an explicitly defined application-wide footprint measure. Do not describe the sum of independent process lifetime peaks as simultaneous application peak; those peaks may occur at different times.

### 1.4 A lifetime high-water mark does not make the measurement unconditionally complete — claim B

**What breaks:** The promise that one-second sampling “cannot miss the peak” depends on measuring the correct surviving process and reading the right counter before it exits.

**Concrete scenario:** A renderer allocates heavily, crashes and is replaced between polls. The next poll measures the replacement. Or the harness closes the app immediately after completion, before the final peak read. A missing measurement then becomes a skipped scenario or a low last-observed value.

A separate failure occurs when initialization creates a larger peak than export: the lifetime maximum is genuine, but it cannot identify export growth.

**Known:** Apple’s kernel exposes a physical-footprint lifetime maximum. That supports the existence of such a counter; it does not verify the exact mapping and behavior of the installed `footprint` output on both benchmark hosts. [Apple XNU implementation](https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/kern/bsd_kern.c)

**Likelihood:** Startup contamination is plausible. Process-loss exposure becomes especially relevant during memory regressions. Neither has been quantified here.

**Evidence:** On each supported OS image, allocate and touch memory briefly, release it between polls, then read the reported peak. Separately test renderer crash, replacement, early exit and parser failure.

**Containment:** Read peaks before teardown, track PID lifetimes, and fail scenarios with unexpected process loss or missing counters. Record phase boundaries and current-footprint traces separately from lifetime peaks. Do not subtract two lifetime maxima and call the result export memory.

### 1.5 Hosted and physical Macs can execute different export workloads — claim A

**What breaks:** Matching source files, presets and schema does not ensure matching codec paths, output sizes or memory behavior.

**Concrete scenario:** The hosted VM selects bitrate encoding while the mini selects constant-quality encoding. The same four-minute source produces different output sizes and encoder queues. A buffering regression passes on the host because it generates fewer bytes.

**Known:** [`video-encoding.ts`](https://github.com/niway-dev/kaipu-record/blob/main/apps/kaipu-record/src/renderer/src/features/video-editor/export/video-encoding.ts) explicitly chooses different encoding settings from platform support probes. Hosted hardware encode availability is unknown in the supplied facts. GitHub documents the constrained hosted environment, including 7 GB RAM. [GitHub runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)

**Inferred:** Actual divergence between these two hosts has not been measured. Missing Metal Performance Shaders support alone does not establish missing VideoToolbox encoding.

**Likelihood:** Material and unresolved: platform-dependent branching is present in the code.

**Evidence:** Run an overlapping export on both hosts and record selected configuration, available backend diagnostics, output bytes, frame count, audio presence and footprint. A successful support probe alone does not establish which physical encoder executed.

**Containment:** Maintain separate baselines and budgets by environment and encoding configuration. Require a shared calibration scenario on both machines. Treat hosted results as coverage of the hosted configuration, not proof of physical-Mac behavior.

### 1.6 Cold synthetic production runs leave the owner’s observed workload uncovered — claims A and B

**What breaks:** Fresh-process isolation removes accumulated application state. Production-only measurements also cannot detect React development-mode costs.

**Concrete scenario:** The owner opens a 54-minute real recording, edits, scrubs, previews and exports repeatedly in one session. Retained resources accumulate between operations. Every fresh-app scenario passes. Separately, React development commits regress while production measurements stay flat.

Synthetic fixed-rate video also omits combinations such as change-driven screen frames, audio, webcam, overlays and repeated edits.

**Known:** The owner judges performance in `bun run dev`, including a measured approximately 600 ms React commit. The export worker has distinct paths for audio, webcam and sparse screen-frame gaps. Claim A includes long takes, but does not specify representative content, session history or development builds.

**Likelihood:** High for the coverage gap. The probability of a specific missed regression is unknown.

**Evidence:** Compare cold synthetic runs with a sanitized representative long recording, then repeat editing and export in one process. Measure the same interaction sequence in development and production.

**Containment:** Keep cold tests, but add a warm-session sequence and representative long-take fixture. Track development interaction latency separately when evaluating the owner’s development experience.

### 1.7 launchd does not isolate the mini from competing work — claim A

**What breaks:** A launch mechanism does not reserve CPU, memory, disk, encoders or the visible desktop.

**Concrete scenario:** A 60-minute recording overlaps the UI catalog or an agent verification. Other app windows enter the capture, encoder contention changes CPU and duration, and concurrent memory pressure changes collection behavior. The resulting JSON looks like an application regression.

**Known:** The mini serves all these workloads. The inspected [`ui-catalog-remote.sh`](https://github.com/niway-dev/kaipu-record/blob/main/apps/kaipu-record/scripts/ui-catalog-remote.sh) uses a reusable checkout and submits a launchd job; its orchestration does not itself establish a shared reservation across benchmark, catalog and verify workloads.

**Likelihood:** Plausible with on-demand agents and long runs. Actual overlap frequency is unknown.

**Evidence:** Record workload ownership, concurrent processes, console/display state, memory pressure and available thermal state. Compare repeated isolated runs with a deliberately overlapping catalog run.

**Containment:** Use one host-wide reservation honored by all three workloads, covering preparation through teardown. Mark contaminated runs invalid rather than silently folding them into history.

### 1.8 A shared schema does not make historical numbers comparable — claim A

**What breaks:** Identical JSON fields can describe different experiments after fixture, toolchain, scenario or host changes.

**Concrete scenario:** An Electron upgrade changes codec behavior while a fixture is regenerated using a new ffmpeg version. A scenario also stops waiting for hidden-window prewarming. The next result improves, but no stored metadata identifies which change caused it.

CPU is similarly ambiguous unless the schema defines process scope, interval, core normalization and whether it reports CPU time or utilization.

**Known:** GitHub runner images evolve. The helper launches prewarmed-window behavior, and the application’s export configuration is platform-dependent. Claim A specifies a common schema and per-run folders, not an experiment identity or comparability policy.

**Likelihood:** High over time unless explicitly controlled.

**Evidence:** Take two historical results and reconstruct their exact inputs, binaries, measurement boundaries and environment without consulting the original operator.

**Containment:** Store immutable app SHA, benchmark SHA, schema/scenario versions, lockfile and artifact hashes, fixture hashes, encoding settings, runner image, OS, hardware and raw measurements. Separate comparable series when any material dimension changes. Publish a completion manifest that identifies missing and failed scenarios.

### 1.9 `electron-vite build` weight is not shipped application weight — claim A and the owner’s goal

**What breaks:** Bundle totals cannot account for every packaged dependency, native helper, asset or installer change.

**Concrete scenario:** A new library is externalized into packaged dependencies, or a native helper grows. Renderer output barely changes while the installed application gets larger. Conversely, a large asset increases bundle bytes but compresses well in the installer.

**Known:** [`package.json`](https://github.com/niway-dev/kaipu-record/blob/main/apps/kaipu-record/package.json) separates the application build from `electron-builder` packaging. [`electron-builder.yml`](https://github.com/niway-dev/kaipu-record/blob/main/apps/kaipu-record/electron-builder.yml) configures additional packaged files and unpacked resources. The launch helper runs the built main entry with Electron, rather than proving execution of the shipped `.app`.

**Likelihood:** High that these weight measures diverge; whether a particular dependency does so requires an artifact comparison.

**Evidence:** Compare renderer/main chunks, packaged dependencies and resources, unpacked `.app` bytes, and downloadable artifact bytes for the same SHA.

**Containment:** Report those weights separately and retain a file-level size manifest. Add release-artifact validation when making claims about shipped size or runtime behavior.

## 2. Hidden assumptions the claims need to be true

- **Detector sensitivity:** One- and four-minute fixtures generate enough encoded bytes to expose buffering despite startup memory and configured budgets.
- **Process identity:** The harness follows the renderer actually executing the scenario, including window changes and process replacement.
- **Counter semantics:** Both hosts expose the intended lifetime footprint maximum, with stable parsing and permissions.
- **Failure handling:** OOM, crashes, hangs, skipped codecs, missing mini runs and upload failures cannot become passing or absent data.
- **Scenario completion:** “Done” means a valid, finalized output with expected duration, dimensions and tracks—not merely a progress notification.
- **Comparable workloads:** Encoding configuration, media complexity, audio, webcam, edits and feature flags are recorded and controlled.
- **Controlled mini:** Other agent jobs and owner activity respect a shared reservation; console permissions and display state remain valid.
- **Reproducible history:** The exact application, benchmark, fixtures and environment can be recovered from each result.
- **Release freshness:** The release decision consumes complete results for the exact candidate, including the mini scenarios.
- **Notification delivery:** Someone receives, reads and acts on the failure before publication.
- **Meaningful budgets:** Budgets have demonstrated sensitivity and acceptable repeatability; repeated noise does not lead to routine dismissal.
- **Scope:** macOS measurements are sufficient for the intended claims; they cannot establish Windows or Linux performance.

## 3. Alternatives that beat the claims, and under which conditions

### Exact-candidate release acceptance

Keep ordinary PRs unrestricted. Require complete benchmark evidence for the release candidate before publication.

This beats nightly notification when releases can happen between scheduled runs or the mini can be unavailable. It preserves fast merges while creating an auditable shipping barrier.

### A detector validated against deliberate regressions

Challenge the suite with whole-output buffering, delayed final writes, excessive outstanding chunks and process loss. Require each challenge to fail.

This beats adopting a 30% threshold by intuition. It establishes that the actual fixtures, counters and budgets detect the failure being claimed.

### Direct streaming measurements alongside footprint

Measure encoded bytes produced, writes acknowledged, outstanding bytes and output progress during export. Allow legitimate header reservations and positional rewrites.

This beats duration-only inference when the concern is whole-output retention or missing backpressure. Memory measurements remain necessary for decoder, compositor and unrelated allocations.

### Hardware-first export baselines with hosted structural checks

Use the mini as the authoritative real-Mac export series. Use hosted runners for bundle analysis and explicitly identified hosted scenarios, with one overlapping calibration workload.

This beats treating the split as interchangeable when codec paths differ. It requires reliable mini scheduling and exact-candidate coverage.

### Paired baseline and candidate runs on the reserved mini

Run the previous accepted build and candidate under the same controlled session, with repeats sufficient to characterize variation.

This beats comparing isolated nightly numbers when host updates, thermal conditions or workload noise dominate the expected change.

### Separate cold production and warm representative sessions

Retain cold production budgets, then add repeated operations on a representative long recording. Maintain a separate development interaction series.

This beats a single synthetic production suite when the goal includes the owner’s long-session editing experience and React development costs.

## 4. What would change my mind

I would consider the claims safe only after observing all of the following:

1. **The detector rejects the target defect:** Deliberate whole-output buffering fails the actual short-fixture checks, and a representative multi-gigabyte export fails independently.
2. **Measurement survives hostile lifecycles:** Brief allocation spikes remain visible; crashes, renderer replacement and unavailable counters produce explicit failures.
3. **Process coverage is demonstrated:** An allocation moved from renderer to main or GPU still breaches the appropriate application budget.
4. **The split is calibrated:** Both machines run a shared scenario with recorded encoding configuration and output characteristics; material differences produce separate baselines.
5. **The mini is controlled:** Catalog and verify jobs cannot overlap a benchmark, and invalid console or capture state prevents a valid result.
6. **History is reconstructible:** A past run can be reproduced from its stored identities, fixtures, artifacts and environment metadata.
7. **Representative sessions are covered:** Repeated editing, playback and export of a real long take are measured; development-mode interaction costs have their own series.
8. **Release prevention is exercised:** A stale result, missing mini result and known breach each stop publication of the exact candidate while ordinary PR merges remain fast.
9. **Weight matches the stated question:** A dependency addition is traceable through bundles, packaged application contents and download size.

Without these observations, the proposal can collect numbers, but its claims of reliable regression detection and prevention of shipping remain unproven.
