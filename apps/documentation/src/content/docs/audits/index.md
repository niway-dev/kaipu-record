---
title: Pre-deploy audits
description: The periodic, whole-codebase audit of the desktop app's core features — the method, how to re-run it, and the log of past runs. Run it when features pile up and the app starts to feel slower.
sidebar:
  order: 0
---

# Pre-deploy audits

> **Status: 🔵 Living method.** Each run is a dated folder. A run reviews the **current state** of
> `main`, not a diff — it exists because many merged features erode our overview of the codebase,
> and a small, unexplained slowdown is the first symptom.

## Runs

| Date       | Commit     | Map                                            | Report                               | Outcome                                                                         |
| ---------- | ---------- | ---------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------- |
| 2026-10-15 | `d36b19dd` | [Feature map](/audits/2026-10-15/feature-map/) | [Report](/audits/2026-10-15/report/) | 78 findings (0 critical, 6 high); main slowdown traced to Library re-list churn |

## How a run works

1. **Map (4 agents, read-only, Sonnet).** One agent per core feature — record, screenshot, library,
   edit video — lists the principal source files, the flow across main / preload / renderer, the IPC
   channels, the **hot paths** (anything per frame, per pointer move, per interval, per list) and
   which files have no tests. The result is `feature-map.md`. Diff it against the previous run's map
   to see what grew.
2. **Audit (8 agents, read-only, Opus).** Two per feature, each with one lens:
   - **A — performance, optimizations, resource leaks, observability.** Quantify costs (syscalls per
     list, renders per pointer move, bytes copied per chunk) and say what would measure them.
   - **B — error handling, bugs, logic flaws, races, data integrity.**
     All eight share one brief (below). Each must give `file:line`, trigger → consequence, try to refute
     the finding first, and mark it `confirmed` (full path traced) or `plausible`.
3. **Consolidate (orchestrator).** Merge the eight finding files into `report.md`: a one-minute
   summary, the cross-cutting themes, a prioritized fix list, and every finding grouped by feature.
   Findings already in an earlier audit are referenced, not repeated.
4. **Act.** Create Linear tickets (team NIW2, project Kaipu, label `claude`) for what we will fix;
   record "checked and fine" items so the next run does not re-check them.

Opus is used for the auditors because hunting logic bugs and cross-process races needs the extra
reasoning; mapping is mechanical and runs on Sonnet.

## The shared auditor brief

Paste this, with the feature, lens and focus questions, into each auditor's prompt.

```text
App under audit: apps/kaipu-record (Electron: main / preload / renderer / shared).
This is a periodic pre-deploy review of the current state — not of a diff. Find real, actionable
problems with evidence. Quality over quantity.

Inputs: the run's feature-map.md (your feature's section first), previous audit results
(do not re-report; mark regressions "Known: #n"), perf trade-off notes in backlog/, root CLAUDE.md.

Rules:
- READ-ONLY. Do not launch the app or run the e2e suite; targeted vitest runs are allowed.
- Every finding: file:line you read + concrete trigger → consequence. Try to refute it first.
  Confidence "confirmed" only if the full path was traced, otherwise "plausible".
- No style nits. Only what hurts users, data, performance, or our ability to see production problems.
- For performance, estimate magnitude and say what would measure it.

Output per finding: ID, title, severity (critical/high/medium/low), category, confidence,
where, what happens, evidence, fix sketch, effort (S/M/L), known.
Plus a summary and a "checked and fine" list.
```

The exact brief and focus questions used in a run are kept in that run's report appendix.

## Related

- [Fable audit — results](/backlog/fable-audit-results/) — the pre-testers audit (46 findings).
- [Code-quality audit playbook](/backlog/code-quality-audit/) — component health and boundaries, a different lens.
- [Recording compositor performance](/backlog/recording-compositor-perf/) — a tracked perf trade-off.
