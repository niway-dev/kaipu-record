#!/usr/bin/env bun
/**
 * Regression check for `.github/workflows/release-desktop.yml` (ADR 0023).
 *
 * The desktop release has one build job per OS and a single `publish` job. The invariant
 * worth pinning is that only `publish` creates the GitHub Release: two jobs each running
 * `softprops/action-gh-release` with `draft: true` can create two draft releases for one
 * tag, because a draft carries no tag to match on. Nothing would fail; a human would find
 * two drafts after the fact.
 *
 * This reads the real workflow file and fails if any `softprops/action-gh-release` step
 * sits outside the job named `publish`, or if `publish` does not have exactly one. It also
 * pins what makes `publish` safe: the tag-only `if:` gate, `needs` on both build jobs, and
 * every uploaded artifact (bar diagnostics) being downloaded under the same name.
 *
 * Run: bun scripts/check-release-workflow.ts [path-to-workflow]
 */

import { readFileSync } from "node:fs";

const WORKFLOW = process.argv[2] ?? ".github/workflows/release-desktop.yml";
const PUBLISHER_JOB = "publish";
const GH_RELEASE = /^\s*(?:-\s*)?uses:\s*softprops\/action-gh-release@/;

const lines = readFileSync(WORKFLOW, "utf8").split("\n");

// Job ids are the two-space-indented keys directly under the top-level `jobs:` key.
const jobsStart = lines.findIndex((l) => l === "jobs:");
if (jobsStart === -1) {
  console.error(`FAIL  no top-level 'jobs:' key found in ${WORKFLOW}`);
  process.exit(1);
}

/** Uploaded for humans debugging a run, never consumed by `publish`. */
const DIAGNOSTIC_ARTIFACTS = new Set(["playwright-report"]);
const REQUIRED_NEEDS = ["build-mac", "build-win"];

const releaseStepsByJob = new Map<string, number>();
const jobLines = new Map<string, string[]>();
let currentJob: string | null = null;
for (let i = jobsStart + 1; i < lines.length; i++) {
  const line = lines[i]!;
  if (/^\S/.test(line) && !line.startsWith("#")) break; // next top-level key ends `jobs:`
  const job = /^ {2}([A-Za-z_][\w-]*):\s*$/.exec(line);
  if (job) {
    currentJob = job[1]!;
    jobLines.set(currentJob, []);
    continue;
  }
  if (currentJob !== null) jobLines.get(currentJob)!.push(line);
  if (currentJob !== null && GH_RELEASE.test(line)) {
    releaseStepsByJob.set(currentJob, (releaseStepsByJob.get(currentJob) ?? 0) + 1);
  }
}

const failures: string[] = [];
for (const [job, count] of releaseStepsByJob) {
  if (job !== PUBLISHER_JOB) {
    failures.push(
      `job '${job}' has ${count} softprops/action-gh-release step(s); only '${PUBLISHER_JOB}' may create the GitHub Release (ADR 0023, two jobs can create two drafts for one tag)`,
    );
  }
}
const inPublisher = releaseStepsByJob.get(PUBLISHER_JOB) ?? 0;
if (inPublisher !== 1) {
  failures.push(
    `job '${PUBLISHER_JOB}' must have exactly one softprops/action-gh-release step, found ${inPublisher}`,
  );
}

const publishLines = jobLines.get(PUBLISHER_JOB) ?? [];
if (!publishLines.some((l) => /^ {4}if:\s*startsWith\(github\.ref, 'refs\/tags\/'\)\s*$/.test(l))) {
  failures.push(
    `job '${PUBLISHER_JOB}' must be gated with "if: startsWith(github.ref, 'refs/tags/')" so a manual dispatch never releases`,
  );
}

const needsLine = publishLines.find((l) => /^ {4}needs:/.test(l)) ?? "";
const needs = [...needsLine.matchAll(/[A-Za-z_][\w-]*/g)].map((m) => m[0]).slice(1);
for (const required of REQUIRED_NEEDS) {
  if (!needs.includes(required)) {
    failures.push(
      `job '${PUBLISHER_JOB}' must list '${required}' in needs, found: [${needs.join(", ")}]`,
    );
  }
}

// Artifact names: what is uploaded must be what is downloaded, or the first tag finds out.
const artifactNames = (action: string): Set<string> => {
  const names = new Set<string>();
  lines.forEach((l, i) => {
    if (!new RegExp(`uses:\\s*actions/${action}@`).test(l)) return;
    for (let j = i + 1; j < lines.length && !/^\s*-\s/.test(lines[j]!); j++) {
      const m = /^\s+name:\s*(\S+)\s*$/.exec(lines[j]!);
      if (m) {
        names.add(m[1]!);
        break;
      }
    }
  });
  return names;
};
const uploaded = new Set(
  [...artifactNames("upload-artifact")].filter((n) => !DIAGNOSTIC_ARTIFACTS.has(n)),
);
const downloaded = artifactNames("download-artifact");
const sorted = (set: Set<string>) => [...set].sort().join(", ");
if (sorted(uploaded) !== sorted(downloaded)) {
  failures.push(
    `upload-artifact names [${sorted(uploaded)}] must equal download-artifact names [${sorted(downloaded)}]`,
  );
}

if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL  ${f}`);
  console.error(`\n${failures.length} release workflow check(s) failed in ${WORKFLOW}.`);
  process.exit(1);
}
console.log(
  `Release workflow check passed: one gh-release step, in '${PUBLISHER_JOB}'; tag gate, needs and artifact names pinned (${WORKFLOW}).`,
);
