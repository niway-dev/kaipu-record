#!/usr/bin/env bun
/**
 * Regression check for `.github/workflows/pr-checks.yml`.
 *
 * Workflow `if:` expressions are the kind of code that is only ever exercised in
 * production, by the very events you are trying to get right. PR #165 paid for that twice
 * in one day: release-please's `autorelease:` label housekeeping started two full
 * verifications, one of them 13 seconds after the PR had merged.
 *
 * So this script reads the REAL workflow file, extracts the REAL `if:` expressions and the
 * REAL gate shell scripts, and runs them against synthetic GitHub event payloads. It does
 * not restate the conditions — a copy would pass while the workflow is broken, which is
 * the one thing a test like this must not do.
 *
 * What it cannot prove: that GitHub delivers the events these payloads model, that
 * job-level `concurrency` cancels the way the docs say, or that release-please leaves a
 * ready PR ready when it force-pushes. Those need a real release cycle. See ADR 0005.
 *
 * Run: bun scripts/check-workflow-eligibility.ts
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WORKFLOW = ".github/workflows/pr-checks.yml";
const source = readFileSync(WORKFLOW, "utf8");

// ── Reading the workflow ────────────────────────────────────────────────────────

/** The YAML text of one job, from `  <id>:` to the next job at the same indent. */
function jobBlock(id: string): string {
  const lines = source.split("\n");
  const start = lines.findIndex((l) => l === `  ${id}:`);
  if (start === -1) throw new Error(`job '${id}' not found in ${WORKFLOW}`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}[A-Za-z_][\w-]*:/.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/** The job's `if:` expression, unwrapped from `>-` folding and `${{ }}`. */
function ifExpression(id: string): string {
  const block = jobBlock(id);
  // Both spellings: a folded `if: >-` block, and a single-line `if: ${{ … }}`. The gate
  // deliberately uses the short form now that it has no conditions left to fold.
  const inline = block.match(/\n {4}if: (\$\{\{.*\}\})\s*$/m);
  if (inline)
    return inline[1]!
      .replace(/^\$\{\{/, "")
      .replace(/\}\}$/, "")
      .trim();
  const m = block.match(/\n {4}if: >-\n([\s\S]*?)(?=\n {4}[a-z_-]+:|$)/);
  if (!m) throw new Error(`job '${id}' has no 'if:' condition`);
  const folded = m[1]!
    .split("\n")
    .map((l) => l.trim())
    // Drop the explanatory comments that sit between `if:` and the next key; the
    // capture runs to the next 4-space key, which is deliberately loose so a
    // reformatted file fails loudly here rather than silently reading half a rule.
    .filter((l) => l !== "" && !l.startsWith("#"))
    .join(" ");
  const inner = folded.match(/^\$\{\{([\s\S]*)\}\}$/);
  return (inner ? inner[1]! : folded).trim();
}

/** The `run:` body of a named step inside a job. */
function stepScript(jobId: string, stepName: string): string {
  const block = jobBlock(jobId);
  const marker = `- name: ${stepName}`;
  const at = block.indexOf(marker);
  if (at === -1) throw new Error(`step '${stepName}' not found in job '${jobId}'`);
  const after = block.slice(at);
  const m = after.match(/\n {8}run: \|\n([\s\S]*?)(?=\n {6}- name:|\n {2}[a-z_-]+:|$)/);
  if (!m) throw new Error(`step '${stepName}' in '${jobId}' has no block 'run: |'`);
  return m[1]!
    .split("\n")
    .map((l) => (l.startsWith("          ") ? l.slice(10) : l))
    .join("\n");
}

/** The `types:` list under `on.pull_request`. */
function triggerTypes(): string[] {
  const m = source.match(/\n {4}types:\n([\s\S]*?)(?=\n {2}[a-z_]+:|\n[a-z])/);
  if (!m) throw new Error("no 'types:' list found");
  return [...m[1]!.matchAll(/^ {6}- (\S+)/gm)].map((x) => x[1]!);
}

/** A job's `concurrency.group` template, or null when it declares none. */
function concurrencyGroup(id: string): string | null {
  const m = jobBlock(id).match(/\n {4}concurrency:\n {6}group: (.+)/);
  return m ? m[1]!.trim() : null;
}

// ── A GitHub-expressions evaluator, for the subset this workflow uses ───────────

type Val = string | number | boolean | null;

function tokenize(src: string): string[] {
  const re = /\s*('(?:[^']|'')*'|==|!=|&&|\|\||[()!,]|[A-Za-z_][\w.-]*)/y;
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) throw new Error(`cannot tokenize at: ${src.slice(i, i + 30)}`);
    out.push(m[1]!);
    i = re.lastIndex;
  }
  return out;
}

/** GitHub coerces across types to a number before comparing: null and '' are both 0. */
function toNumber(v: Val): number {
  if (v === null) return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v;
  if (v === "") return 0;
  const n = Number(v);
  return Number.isNaN(n) ? Number.NaN : n;
}

function looseEq(a: Val, b: Val): boolean {
  if (typeof a === typeof b && a !== null && b !== null) {
    if (typeof a === "string") return a.toLowerCase() === (b as string).toLowerCase();
    return a === b;
  }
  if (a === null && b === null) return true;
  const na = toNumber(a);
  const nb = toNumber(b);
  if (Number.isNaN(na) || Number.isNaN(nb)) return false;
  return na === nb;
}

function truthy(v: Val): boolean {
  if (v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v !== "";
  return v !== 0;
}

function evaluate(expr: string, ctx: Record<string, unknown>): boolean {
  const tokens = tokenize(expr);
  let pos = 0;
  const peek = (): string | undefined => tokens[pos];
  const eat = (t?: string): string => {
    const tok = tokens[pos++];
    if (t && tok !== t) throw new Error(`expected ${t}, got ${tok}`);
    return tok!;
  };

  function lookup(path: string): Val {
    let cur: unknown = ctx;
    for (const part of path.split(".")) {
      if (cur === null || cur === undefined || typeof cur !== "object") return null;
      cur = (cur as Record<string, unknown>)[part];
    }
    if (cur === undefined) return null;
    return cur as Val;
  }

  function primary(): Val {
    const tok = peek();
    if (tok === "(") {
      eat("(");
      const v = orExpr();
      eat(")");
      return v;
    }
    if (tok === "!") {
      eat("!");
      return !truthy(primary());
    }
    const t = eat();
    if (t.startsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
    if (t === "true") return true;
    if (t === "false") return false;
    if (t === "null") return null;
    if (peek() === "(") {
      eat("(");
      const args: Val[] = [];
      while (peek() !== ")") {
        args.push(orExpr());
        if (peek() === ",") eat(",");
      }
      eat(")");
      switch (t) {
        case "always":
          return true;
        case "startsWith":
          return String(args[0] ?? "")
            .toLowerCase()
            .startsWith(String(args[1] ?? "").toLowerCase());
        case "contains":
          return String(args[0] ?? "")
            .toLowerCase()
            .includes(String(args[1] ?? "").toLowerCase());
        default:
          throw new Error(`unsupported function: ${t}()`);
      }
    }
    return lookup(t);
  }

  function cmpExpr(): Val {
    const left = primary();
    const op = peek();
    if (op === "==" || op === "!=") {
      eat(op);
      const right = primary();
      return op === "==" ? looseEq(left, right) : !looseEq(left, right);
    }
    return left;
  }

  function andExpr(): Val {
    let v = cmpExpr();
    while (peek() === "&&") {
      eat("&&");
      const r = cmpExpr();
      v = truthy(v) ? r : v;
    }
    return v;
  }

  function orExpr(): Val {
    let v = andExpr();
    while (peek() === "||") {
      eat("||");
      const r = andExpr();
      v = truthy(v) ? v : r;
    }
    return v;
  }

  const result = orExpr();
  if (pos !== tokens.length) throw new Error(`trailing tokens in: ${expr}`);
  return truthy(result);
}

// ── Scenarios ──────────────────────────────────────────────────────────────────

const RELEASE_BRANCH = "release-please--branches--main--components--desktop";
/** A release candidate that ships no desktop build: no shards, no macOS (ADR 0052). */
const WEB_RELEASE_BRANCH = "release-please--branches--main--components--web";

interface EventOptions {
  action: string;
  headRef?: string;
  draft?: boolean;
  state?: string;
  merged?: boolean;
  baseChangedFrom?: string;
  titleChanged?: boolean;
}

function pullRequestEvent(o: EventOptions): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  if (o.baseChangedFrom !== undefined) changes.base = { ref: { from: o.baseChangedFrom } };
  if (o.titleChanged) changes.title = { from: "old title" };
  return {
    github: {
      event_name: "pull_request",
      head_ref: o.headRef ?? "feat/ordinary",
      ref: "refs/pull/165/merge",
      event: {
        action: o.action,
        changes,
        pull_request: {
          number: 165,
          state: o.state ?? "open",
          merged: o.merged ?? false,
          draft: o.draft ?? false,
          head: { sha: "1bd8b2a" },
        },
      },
    },
  };
}

const dispatchEvent = {
  github: { event_name: "workflow_dispatch", head_ref: "", ref: "refs/heads/main", event: {} },
};

interface Expectation {
  verify: boolean;
  e2e: boolean;
  gate: boolean;
  legacy: boolean;
  cancel: boolean;
}

/**
 * The gate reads `needs.*.result`, so the scenarios have to model it. Without this the
 * script would evaluate the gate's condition against an empty `needs` context and every
 * lookup would come back null — it would agree with itself while the workflow was wrong.
 *
 * Default: a job that the scenario expects to run ends in `success`, one that does not
 * ends in `skipped`. Scenarios that exist to exercise a failure or a cancellation say so.
 */
type JobResult = "success" | "failure" | "cancelled" | "skipped";

/**
 * The outputs of `Classify the change` for a scenario, by running the REAL step. It used to
 * be mirrored here; with scoping (ADR 0052) the outputs drive which parts run, so a mirror
 * would agree with itself while the workflow's rule was wrong.
 */
function classifyFor(ctx: Record<string, unknown>, docsOnly: boolean): Record<string, string> {
  const github = ctx.github as { event_name: string; head_ref: string };
  const files =
    github.event_name === "workflow_dispatch"
      ? null
      : docsOnly
        ? ["apps/documentation/src/content/docs/a.md"]
        : ["apps/kaipu-record/src/a.ts"];
  return runClassify(github.event_name, github.head_ref, files);
}

function needsContext(
  ctx: Record<string, unknown>,
  expect: Expectation,
  override: Partial<Record<string, JobResult>> = {},
  docsOnly = false,
) {
  // `changes` runs on every non-draft revision; everything else waits on its verdict.
  // Whether it ran comes from evaluating its own condition, not from the expectation.
  const changes: JobResult =
    override.changes ?? (evaluate(exprs.changes, ctx) ? "success" : "skipped");
  const verify: JobResult = override.verify ?? (expect.verify ? "success" : "skipped");
  const e2e: JobResult = override.e2e_desktop ?? (expect.e2e ? "success" : "skipped");
  const gate: JobResult = override.gate ?? (expect.gate ? "success" : "skipped");
  const changesNeed = {
    result: changes,
    // A job output is the empty string unless the job succeeded and set it.
    outputs:
      changes === "success"
        ? classifyFor(ctx, docsOnly)
        : Object.fromEntries(OUTPUT_KEYS.map((k) => [k, ""])),
  };
  // The parallel parts `verify` collects. Each one ran exactly when its OWN condition says
  // so, given the classification — that is how a scope skips `tests_desktop` or `bundles`.
  const part = (id: string): { result: JobResult } => ({
    result:
      override[id] ??
      (evaluate(exprs[id as keyof typeof exprs], { ...ctx, needs: { changes: changesNeed } })
        ? "success"
        : "skipped"),
  });
  return {
    changes: changesNeed,
    lint: part("lint"),
    types: part("types"),
    tests: part("tests"),
    tests_desktop: part("tests_desktop"),
    bundles: part("bundles"),
    docs: part("docs"),
    verify: { result: verify },
    e2e_desktop: { result: e2e },
    gate: { result: gate },
  };
}

const scenarios: Array<{
  n: number;
  title: string;
  ctx: Record<string, unknown>;
  eventType: string;
  expect: Expectation;
  /** Non-default job results, for the supersede and failure paths. */
  results?: Partial<Record<string, JobResult>>;
  /** What `changes` classified the pull request as. Default: code. */
  docsOnly?: boolean;
  /** Which scoped parts must run (ADR 0052), checked against their real conditions. */
  parts?: { tests_desktop: boolean; bundles: boolean };
}> = [
  {
    n: 1,
    title: "Ordinary PR targeting main",
    ctx: pullRequestEvent({ action: "opened" }),
    eventType: "opened",
    // ADR 0027: only release candidates are verified in Actions. An ordinary pull request
    // starts no verification runner, and the gate reports an immediate pass.
    expect: { verify: false, e2e: false, gate: true, legacy: true, cancel: false },
  },
  {
    n: 3,
    title: "Release PR opened as draft",
    ctx: pullRequestEvent({ action: "opened", headRef: RELEASE_BRANCH, draft: true }),
    eventType: "opened",
    // Silent, not red. A draft commit is usually the same commit that will be verified the
    // moment the PR is marked ready; a failure reported here would survive that
    // verification and block the merge, because the rollup takes the worst conclusion
    // across runs. GitHub refuses to merge a draft on its own.
    expect: { verify: false, e2e: false, gate: false, legacy: false, cancel: false },
  },
  {
    n: 4,
    title: "Draft release PR updated (release-please rewrite)",
    ctx: pullRequestEvent({ action: "synchronize", headRef: RELEASE_BRANCH, draft: true }),
    eventType: "synchronize",
    expect: { verify: false, e2e: false, gate: false, legacy: false, cancel: false },
  },
  {
    n: 5,
    title: "Release PR marked ready for review",
    ctx: pullRequestEvent({ action: "ready_for_review", headRef: RELEASE_BRANCH }),
    eventType: "ready_for_review",
    expect: { verify: true, e2e: true, gate: true, legacy: true, cancel: false },
  },
  {
    n: 6,
    title: "Ready release PR updated to a new revision",
    ctx: pullRequestEvent({ action: "synchronize", headRef: RELEASE_BRANCH }),
    eventType: "synchronize",
    expect: { verify: true, e2e: true, gate: true, legacy: true, cancel: false },
  },
  {
    n: 13,
    // ADR 0010 made every candidate run macOS; ADR 0052 takes it away from the ones that
    // ship no desktop build. A web release no longer waits on the desktop suite (#429).
    title: "Ready WEB release candidate (no desktop parts)",
    ctx: pullRequestEvent({ action: "ready_for_review", headRef: WEB_RELEASE_BRANCH }),
    eventType: "ready_for_review",
    expect: { verify: true, e2e: false, gate: true, legacy: true, cancel: false },
    parts: { tests_desktop: false, bundles: true },
  },
  {
    n: 31,
    title: "Ready API release candidate (no desktop parts)",
    ctx: pullRequestEvent({
      action: "ready_for_review",
      headRef: "release-please--branches--main--components--api",
    }),
    eventType: "ready_for_review",
    expect: { verify: true, e2e: false, gate: true, legacy: true, cancel: false },
    parts: { tests_desktop: false, bundles: true },
  },
  {
    n: 32,
    title: "Ready desktop candidate (no Workers bundle)",
    ctx: pullRequestEvent({ action: "ready_for_review", headRef: RELEASE_BRANCH }),
    eventType: "ready_for_review",
    expect: { verify: true, e2e: true, gate: true, legacy: true, cancel: false },
    parts: { tests_desktop: true, bundles: false },
  },
  {
    n: 33,
    title: "Ready release candidate of an unknown component (verifies all)",
    ctx: pullRequestEvent({
      action: "ready_for_review",
      headRef: "release-please--branches--main--components--cli",
    }),
    eventType: "ready_for_review",
    expect: { verify: true, e2e: true, gate: true, legacy: true, cancel: false },
    parts: { tests_desktop: true, bundles: true },
  },
  {
    n: 34,
    title: "Ready web candidate whose workspace tests failed",
    ctx: pullRequestEvent({ action: "synchronize", headRef: WEB_RELEASE_BRANCH }),
    eventType: "synchronize",
    results: { tests: "failure", verify: "failure" },
    // A real verdict: no E2E is expected for a web candidate, and the gate still reports.
    expect: { verify: true, e2e: false, gate: true, legacy: true, cancel: false },
    parts: { tests_desktop: false, bundles: true },
  },
  {
    n: 35,
    title: "Ready desktop candidate whose shard failed",
    ctx: pullRequestEvent({ action: "synchronize", headRef: RELEASE_BRANCH }),
    eventType: "synchronize",
    results: { tests_desktop: "failure", verify: "failure" },
    expect: { verify: true, e2e: true, gate: true, legacy: true, cancel: false },
    parts: { tests_desktop: true, bundles: false },
  },
  {
    n: 36,
    title: "Ready web candidate superseded while its tests ran",
    ctx: pullRequestEvent({ action: "synchronize", headRef: WEB_RELEASE_BRANCH }),
    eventType: "synchronize",
    // Cancelled by a newer revision: `verify` stays silent and so does the gate, even though
    // this candidate has no E2E to wait for.
    results: { tests: "cancelled" },
    expect: { verify: false, e2e: false, gate: false, legacy: false, cancel: false },
  },
  {
    n: 37,
    title: "Ready desktop candidate superseded while a shard ran",
    ctx: pullRequestEvent({ action: "synchronize", headRef: RELEASE_BRANCH }),
    eventType: "synchronize",
    results: { tests_desktop: "cancelled" },
    expect: { verify: false, e2e: true, gate: false, legacy: false, cancel: false },
  },
  {
    n: 9,
    title: "Release PR returned to draft during verification",
    ctx: pullRequestEvent({
      action: "converted_to_draft",
      headRef: RELEASE_BRANCH,
      draft: true,
    }),
    eventType: "converted_to_draft",
    // Same commit, and it may well be marked ready again. Staying silent is what lets that
    // later verification stand alone on the commit.
    expect: { verify: false, e2e: false, gate: false, legacy: false, cancel: true },
  },
  {
    n: 14,
    title: "Ready desktop candidate, verification failed",
    ctx: pullRequestEvent({ action: "synchronize", headRef: RELEASE_BRANCH }),
    eventType: "synchronize",
    results: { verify: "failure" },
    // A real verdict about this commit. It MUST be reported, or nothing blocks the merge.
    expect: { verify: true, e2e: true, gate: true, legacy: true, cancel: false },
  },
  {
    n: 15,
    title: "Ready desktop candidate superseded mid-E2E",
    ctx: pullRequestEvent({ action: "synchronize", headRef: RELEASE_BRANCH }),
    eventType: "synchronize",
    results: { e2e_desktop: "cancelled" },
    // Superseded means a newer run owns the verdict. Reporting a failure here would
    // outlive it on the same commit if the candidate is re-verified without a new push.
    expect: { verify: true, e2e: true, gate: false, legacy: false, cancel: false },
  },
  {
    n: 16,
    title: "Ready desktop candidate whose verification was cancelled",
    ctx: pullRequestEvent({ action: "synchronize", headRef: RELEASE_BRANCH }),
    eventType: "synchronize",
    results: { verify: "cancelled", e2e_desktop: "cancelled" },
    expect: { verify: true, e2e: true, gate: false, legacy: false, cancel: false },
  },
  {
    n: 17,
    title: "Ordinary PR opened as draft",
    ctx: pullRequestEvent({ action: "opened", draft: true }),
    eventType: "opened",
    // The readiness policy now covers every PR: a draft pushes freely without runners.
    expect: { verify: false, e2e: false, gate: false, legacy: false, cancel: false },
  },
  {
    n: 19,
    title: "Ordinary PR returned to draft",
    ctx: pullRequestEvent({ action: "converted_to_draft", draft: true }),
    eventType: "converted_to_draft",
    expect: { verify: false, e2e: false, gate: false, legacy: false, cancel: true },
  },
  {
    n: 20,
    title: "Ready desktop candidate, desktop E2E failed",
    ctx: pullRequestEvent({ action: "synchronize", headRef: RELEASE_BRANCH }),
    eventType: "synchronize",
    results: { e2e_desktop: "failure" },
    // A real verdict: it must be reported, so the red E2E blocks the merge.
    expect: { verify: true, e2e: true, gate: true, legacy: true, cancel: false },
  },
  {
    n: 21,
    title: "Ready candidate superseded while its tests ran",
    ctx: pullRequestEvent({ action: "synchronize", headRef: RELEASE_BRANCH }),
    eventType: "synchronize",
    // A part cancelled by a newer revision: `verify` must not run, so it cannot turn the
    // cancellation into a failure that lands on a commit this run knows nothing about.
    results: { tests: "cancelled" },
    expect: { verify: false, e2e: true, gate: false, legacy: false, cancel: false },
  },
  {
    n: 22,
    title: "Ready candidate whose lint failed",
    ctx: pullRequestEvent({ action: "synchronize", headRef: RELEASE_BRANCH }),
    eventType: "synchronize",
    // A real verdict: `verify` runs (always()), fails, and the gate reports it.
    results: { lint: "failure", verify: "failure" },
    expect: { verify: true, e2e: true, gate: true, legacy: true, cancel: false },
  },
  {
    n: 29,
    title: "Upper PR of a stack (base is another branch)",
    ctx: pullRequestEvent({ action: "opened", headRef: "design/stacked-upper" }),
    eventType: "opened",
    // GitHub judges every PR in a stack against main's required check, so it must
    // report; like any ordinary PR, with an immediate pass.
    expect: { verify: false, e2e: false, gate: true, legacy: true, cancel: false },
  },
  {
    n: 30,
    title: "Docs-only release PR",
    ctx: pullRequestEvent({ action: "ready_for_review", headRef: RELEASE_BRANCH }),
    eventType: "ready_for_review",
    docsOnly: true,
    expect: { verify: true, e2e: false, gate: true, legacy: true, cancel: false },
  },
  {
    n: 23,
    title: "Docs-only PR",
    ctx: pullRequestEvent({ action: "synchronize" }),
    eventType: "synchronize",
    docsOnly: true,
    // Not a release candidate: an immediate pass, like any ordinary pull request.
    expect: { verify: false, e2e: false, gate: true, legacy: true, cancel: false },
  },
  {
    n: 24,
    title: "Docs-only release PR whose lint failed",
    ctx: pullRequestEvent({ action: "synchronize", headRef: RELEASE_BRANCH }),
    eventType: "synchronize",
    docsOnly: true,
    results: { lint: "failure", verify: "failure" },
    expect: { verify: true, e2e: false, gate: true, legacy: true, cancel: false },
  },
  {
    n: 25,
    title: "PR whose change detection failed",
    ctx: pullRequestEvent({ action: "synchronize" }),
    eventType: "synchronize",
    results: { changes: "failure" },
    // Nothing can run without a classification, and the gate reports the failure instead
    // of leaving the required check on "Expected".
    expect: { verify: false, e2e: false, gate: true, legacy: true, cancel: false },
  },
  {
    n: 26,
    title: "Docs-only PR opened as draft",
    ctx: pullRequestEvent({ action: "opened", draft: true }),
    eventType: "opened",
    results: { changes: "skipped" },
    expect: { verify: false, e2e: false, gate: false, legacy: false, cancel: false },
  },
  {
    n: 27,
    title: "Docs-only release PR superseded while its tests ran",
    ctx: pullRequestEvent({ action: "synchronize", headRef: RELEASE_BRANCH }),
    eventType: "synchronize",
    docsOnly: true,
    results: { tests: "cancelled" },
    expect: { verify: false, e2e: false, gate: false, legacy: false, cancel: false },
  },
  {
    n: 28,
    title: "PR whose change detection was cancelled",
    ctx: pullRequestEvent({ action: "synchronize" }),
    eventType: "synchronize",
    results: { changes: "cancelled" },
    // Not a classification and not a failure: this run decided nothing.
    expect: { verify: false, e2e: false, gate: false, legacy: false, cancel: false },
  },
  {
    n: 12,
    title: "Manual dispatch",
    ctx: dispatchEvent,
    eventType: "workflow_dispatch",
    // The one place the gate legitimately does not run: there is no pull request to
    // report a check on. Everywhere else it must run — see the guard below.
    expect: { verify: true, e2e: true, gate: false, legacy: false, cancel: false },
  },
];

// ── Run ────────────────────────────────────────────────────────────────────────

const failures: string[] = [];
const ok = (cond: boolean, msg: string): void => {
  if (!cond) failures.push(msg);
};

const exprs = {
  changes: ifExpression("changes"),
  lint: ifExpression("lint"),
  types: ifExpression("types"),
  tests: ifExpression("tests"),
  tests_desktop: ifExpression("tests_desktop"),
  bundles: ifExpression("bundles"),
  docs: ifExpression("docs"),
  verify: ifExpression("verify"),
  e2e: ifExpression("e2e_desktop"),
  gate: ifExpression("gate"),
  legacy: ifExpression("legacy-gate"),
  cancel: ifExpression("cancel-superseded"),
};

const classify = stepScript("changes", "Classify the change");
const scratch = mkdtempSync(join(tmpdir(), "kaipu-classify-"));
const OUTPUT_KEYS = [
  "docs_only",
  "release",
  "scope",
  "desktop",
  "workers",
  "e2e",
  "build_filter",
  "types_filter",
  "test_filter",
];

/** Runs the real classify step and returns every output it wrote. */
function runClassify(
  event: string,
  headRef: string,
  files: string[] | null,
): Record<string, string> {
  const listPath = join(scratch, "changed-files.txt");
  const outPath = join(scratch, "output.txt");
  writeFileSync(outPath, "");
  writeFileSync(listPath, files && files.length ? `${files.join("\n")}\n` : "");
  execFileSync("bash", ["-c", classify], {
    env: {
      ...process.env,
      FILES: files === null ? join(scratch, "missing.txt") : listPath,
      GITHUB_OUTPUT: outPath,
      EVENT: event,
      HEAD_REF: headRef,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out: Record<string, string> = {};
  for (const line of readFileSync(outPath, "utf8").split("\n")) {
    const at = line.indexOf("=");
    if (at > 0) out[line.slice(0, at)] = line.slice(at + 1);
  }
  return out;
}

/** Runs a real workflow script under bash with the given env; returns its exit code and stdout. */
function runScript(script: string, env: Record<string, string>): { code: number; out: string } {
  try {
    const out = execFileSync("bash", ["-c", script], {
      env: { ...process.env, ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    return { code: err.status ?? -1, out: err.stdout ?? "" };
  }
}

console.log(`Workflow: ${WORKFLOW}`);
console.log(`Trigger types: ${triggerTypes().join(", ")}\n`);
console.log(
  "  #  scenario                                        verify  e2e   gate  legacy  cancel",
);
console.log(
  "  -  ----------------------------------------------  ------  ----  ----  ------  ------",
);

/** The `needs` context a scenario's run would produce, `changes` included. */
const scenarioNeeds = (s: (typeof scenarios)[number]) =>
  needsContext(s.ctx, s.expect, s.results, s.docsOnly);

for (const s of scenarios) {
  const ctx = { ...s.ctx, needs: scenarioNeeds(s) };
  // The verifying parts run exactly when `changes` succeeded and classified a release
  // candidate (ADR 0027), so an ordinary pull request starts none of them.
  ok(
    evaluate(exprs.lint, ctx) ===
      (ctx.needs.changes.result === "success" && ctx.needs.changes.outputs.release === "true"),
    `scenario ${s.n} (${s.title}): the verifying parts must run only on a classified release candidate`,
  );
  if (s.parts) {
    for (const id of ["tests_desktop", "bundles"] as const) {
      ok(
        evaluate(exprs[id], ctx) === s.parts[id],
        `scenario ${s.n} (${s.title}): part '${id}' expected to ${s.parts[id] ? "run" : "be skipped"}`,
      );
    }
  }
  const got = {
    verify: evaluate(exprs.verify, ctx),
    e2e: evaluate(exprs.e2e, ctx),
    gate: evaluate(exprs.gate, ctx),
    legacy: evaluate(exprs.legacy, ctx),
    cancel: evaluate(exprs.cancel, ctx),
  };
  const mark = (a: boolean, b: boolean): string => (a === b ? (a ? "run" : " - ") : "BAD");
  console.log(
    `  ${String(s.n).padStart(2)} ${s.title.padEnd(48)}` +
      `${mark(got.verify, s.expect.verify).padEnd(8)}` +
      `${mark(got.e2e, s.expect.e2e).padEnd(6)}` +
      `${mark(got.gate, s.expect.gate).padEnd(6)}` +
      `${mark(got.legacy, s.expect.legacy).padEnd(8)}` +
      `${mark(got.cancel, s.expect.cancel)}`,
  );
  for (const key of ["verify", "e2e", "gate", "legacy", "cancel"] as const) {
    ok(
      got[key] === s.expect[key],
      `scenario ${s.n} (${s.title}): job '${key}' expected ${s.expect[key]}, got ${got[key]}`,
    );
  }
  if (s.eventType !== "workflow_dispatch") {
    ok(
      triggerTypes().includes(s.eventType),
      `scenario ${s.n}: '${s.eventType}' is not in the workflow's types list`,
    );
  }
}

// Scenario 7: label churn must not be a trigger at all — and neither may `edited`. An
// `edited` run (release-please rewrites its PR body on every update) verifies nothing and
// reports every check as skipped; GitHub counts a skipped required check as passing, so the
// PR read "All checks have passed" while the real run was still working (PR #195).
console.log("\nScenario 7 — label churn and body edits are not triggers");
ok(
  !triggerTypes().includes("edited"),
  "'edited' must not be a trigger type: its run reports skipped checks that GitHub counts as passing",
);
console.log(
  `  'edited' in types: ${triggerTypes().includes("edited") ? "YES (regression)" : "no — workflow never starts"}`,
);
for (const t of ["labeled", "unlabeled"]) {
  const listed = triggerTypes().includes(t);
  console.log(`  '${t}' in types: ${listed ? "YES (regression)" : "no — workflow never starts"}`);
  ok(!listed, `'${t}' must not be a trigger type: it is what caused PR #165 runs #13 and #16`);
}

// Concurrency: the canceller must share the verify job's group, and nothing else may.
console.log("\nConcurrency groups");
const verifyGroup = concurrencyGroup("verify");
const cancelGroup = concurrencyGroup("cancel-superseded");
console.log(`  verify:            ${verifyGroup}`);
console.log(`  cancel-superseded: ${cancelGroup}`);
console.log(`  e2e_desktop:       ${concurrencyGroup("e2e_desktop")}`);
ok(verifyGroup !== null, "the verify job must declare a job-level concurrency group");
ok(
  cancelGroup !== null &&
    verifyGroup !== null &&
    cancelGroup.startsWith(verifyGroup.split(" ||")[0]!),
  "cancel-superseded must share the verify job's concurrency group to cancel it",
);
ok(
  concurrencyGroup("e2e_desktop") !== null &&
    concurrencyGroup("e2e_desktop") !== concurrencyGroup("verify"),
  "e2e_desktop must cancel its own supersedes, in a group of its own",
);
// THE INVARIANT THIS WHOLE SCRIPT EXISTS FOR.
//
// GitHub resolves a required check across every check run of that name on the head commit
// by taking the WORST conclusion, not the latest, and a commit can collect several runs:
// release-please force-pushes and rewrites the body in the same second, and returning a
// candidate to draft and back does it too. So:
//
//   - a run that DID verify must report, whatever the verdict — otherwise nothing blocks;
//   - a run that did NOT verify must report nothing — `skipped` is neutral in the rollup,
//     whereas a failure lands permanently on a commit this run knows nothing about and
//     outlives the verification that follows it.
//
// Measured on this repository on 2026-09-27 (PR #178): skipped + success rolled up to
// SUCCESS, failure + success rolled up to FAILURE and the candidate could not merge.
console.log("\nThe one report per commit invariant");
for (const s of scenarios) {
  if (s.eventType === "workflow_dispatch") continue;
  const needs = scenarioNeeds(s);
  const ctx = { ...s.ctx, needs };
  const verified = ["success", "failure"].includes(needs.verify.result);
  // A run decides in three ways (ADR 0027): it classified the PR as not a release candidate;
  // its classification failed; or it verified a candidate, with the E2E either reaching a
  // verdict or classified as not required (docs-only).
  const e2eDecided =
    ["success", "failure"].includes(needs.e2e_desktop.result) ||
    (needs.e2e_desktop.result === "skipped" &&
      needs.changes.result === "success" &&
      needs.changes.outputs.e2e === "false");
  const mustReport =
    (needs.changes.result === "success" && needs.changes.outputs.release === "false") ||
    needs.changes.result === "failure" ||
    (verified && e2eDecided);
  const reports = evaluate(exprs.gate, ctx);
  console.log(
    `  ${String(s.n).padStart(2)} ${s.title.slice(0, 52).padEnd(54)}` +
      `${mustReport ? "must report" : "must stay silent"} -> ${reports ? "reports" : "silent"}`,
  );
  ok(
    reports === mustReport,
    `scenario ${s.n} (${s.title}): the gate must ${mustReport ? "report" : "stay silent"}`,
  );
  ok(
    !reports || evaluate(exprs.legacy, ctx),
    `scenario ${s.n} (${s.title}): the alias must report whenever the gate does`,
  );
}

// The gate decides off `needs.*.result` and nothing else. A condition on the event shape
// is how a run that DID verify ends up silent — the previous spelling of this guard banned
// every condition instead, which made the run that verified NOTHING fail closed and
// blocked desktop 0.9.0 on three consecutive revisions.
for (const id of ["gate", "legacy-gate"]) {
  const expr = ifExpression(id);
  ok(
    !/draft/.test(expr) && !/changes\.base/.test(expr) && !/\.state\b/.test(expr),
    `'${id}' must not condition on the event shape (draft, state, changes.base) — only on ` +
      `needs.*.result, so a run that verified always reports (got: ${expr})`,
  );
  ok(
    /needs\./.test(expr),
    `'${id}' must read needs.*.result to know whether this run decided (got: ${expr})`,
  );
}
ok(
  concurrencyGroup("gate") === null && concurrencyGroup("legacy-gate") === null,
  "the gate jobs must not join a cancelling concurrency group",
);
ok(
  !/^concurrency:/m.test(source),
  "there must be no workflow-level concurrency: it cancels valid verifications from irrelevant events",
);

// Scenario 11 + the gate's own decision table, by running the real shell script.
console.log("\nScenario 11 — the real merge-requirements script, by exit code");
const decide = stepScript("gate", "Check whether verification permits merging");
// [isDraft, verify, e2e, changes, docsOnly, release, e2eRequired, expected exit, label]
type DecideCase = [string, string, string, string, string, string, string, number, string];
const decideCases: DecideCase[] = [
  // The row that would have caught the 0.8.1 green button.
  ["true", "skipped", "skipped", "skipped", "", "", "", 1, "draft: nothing verified"],
  ["false", "success", "success", "success", "false", "true", "true", 0, "candidate: all green"],
  // This row is the one that would have stopped desktop 0.8.0 before the tag existed.
  ["false", "success", "failure", "success", "false", "true", "true", 1, "candidate: E2E failed"],
  [
    "false",
    "success",
    "cancelled",
    "success",
    "false",
    "true",
    "true",
    1,
    "candidate: E2E superseded",
  ],
  [
    "false",
    "success",
    "skipped",
    "success",
    "false",
    "true",
    "true",
    1,
    "candidate: E2E never ran",
  ],
  [
    "false",
    "failure",
    "success",
    "success",
    "false",
    "true",
    "true",
    1,
    "candidate: verify failed",
  ],
  ["false", "skipped", "skipped", "success", "false", "true", "true", 1, "candidate: nothing ran"],
  // ADR 0027: an ordinary pull request is not verified here, and passes at once.
  ["false", "skipped", "skipped", "success", "false", "false", "false", 0, "ordinary PR"],
  ["false", "skipped", "skipped", "success", "true", "false", "false", 0, "ordinary docs-only PR"],
  ["false", "success", "skipped", "success", "true", "true", "false", 0, "docs-only candidate"],
  [
    "false",
    "failure",
    "skipped",
    "success",
    "true",
    "true",
    "false",
    1,
    "docs-only candidate, verify failed",
  ],
  [
    "false",
    "success",
    "failure",
    "success",
    "true",
    "true",
    "false",
    1,
    "docs-only candidate, E2E failed",
  ],
  ["false", "skipped", "skipped", "failure", "", "", "", 1, "change detection failed"],
  // ADR 0052: a candidate that ships no desktop build does not need the desktop E2E.
  ["false", "success", "skipped", "success", "false", "true", "false", 0, "web/api candidate"],
  ["false", "failure", "skipped", "success", "false", "true", "false", 1, "web/api, verify failed"],
  ["false", "cancelled", "skipped", "success", "false", "true", "false", 1, "web/api, superseded"],
  ["false", "skipped", "skipped", "success", "false", "true", "false", 1, "web/api, nothing ran"],
];
for (const [
  isDraft,
  verify,
  e2e,
  changes,
  docsOnly,
  release,
  e2eRequired,
  wantCode,
  label,
] of decideCases) {
  // Every candidate row is a desktop candidate except the ones labelled web/api; the
  // docs-only rows are desktop candidates whose E2E was skipped for being docs-only.
  const scope = release !== "true" ? "none" : label.startsWith("web/api") ? "web" : "desktop";
  const { code, out } = runScript(decide, {
    IS_DRAFT: isDraft,
    VERIFY: verify,
    E2E: e2e,
    CHANGES: changes,
    DOCS_ONLY: docsOnly,
    E2E_REQUIRED: e2eRequired,
    RELEASE: release,
    SCOPE: scope,
    SHA: "1bd8b2a",
  });
  console.log(
    `  draft=${isDraft.padEnd(5)} verify=${verify.padEnd(9)} e2e=${e2e.padEnd(9)} changes=${changes.padEnd(8)} docs=${docsOnly.padEnd(5)} exit=${code}  ${label}`,
  );
  ok(
    code === wantCode,
    `Decide(draft=${isDraft}, verify=${verify}, e2e=${e2e}) expected exit ${wantCode}, got ${code}`,
  );
  ok(
    !/verify.{0,3}label/i.test(out),
    `Decide must not mention the retired 'verify' label (verify=${verify}, e2e=${e2e})`,
  );
}

// The docs-only classifier, by running the real step against file lists. Every row that
// is not plainly documentation must come out as code: a wrong answer here skips the E2E.
console.log("\nDocs-only classifier — the real step, by its output");
const classifyCases: Array<[string[] | null, boolean, string]> = [
  [["apps/documentation/src/content/docs/marketing/index.md"], true, "docs site page"],
  [
    ["README.md", "apps/kaipu-record/CHANGELOG.md", ".claude/skills/x/SKILL.md"],
    true,
    "Markdown anywhere",
  ],
  [
    ["apps/documentation/astro.config.mjs", "apps/documentation/package.json"],
    true,
    "docs site config",
  ],
  [
    ["apps/documentation/src/content/docs/a.md", "apps/kaipu-record/src/main/index.ts"],
    false,
    "docs plus code",
  ],
  [["apps/documentation-evil/x.ts"], false, "lookalike prefix"],
  [["notes.md.ts"], false, "Markdown-looking extension"],
  [["package.json"], false, "root manifest"],
  [["bun.lock", "docs/a.md"], false, "lockfile plus docs"],
  [[], false, "empty list"],
  [null, false, "no list (manual dispatch)"],
  [Array.from({ length: 3000 }, (_, i) => `apps/documentation/p${i}.md`), false, "API cap reached"],
];
for (const [files, want, label] of classifyCases) {
  const got = runClassify("pull_request", "feat/ordinary", files).docs_only === "true";
  console.log(`  docs_only=${String(got).padEnd(5)} ${label}`);
  ok(got === want, `classifier on '${label}' expected docs_only=${want}, got ${got}`);
}

// The E2E rule, by running the same real step: DESKTOP release candidates and manual
// dispatches only, never docs-only (ADR 0052). A wrong answer here either skips the release
// E2E of the desktop app or puts macOS back on a web or API release.
console.log("\nE2E rule — the real step, by its output");
const DESKTOP_BRANCH = "release-please--branches--main--components--desktop";
const API_BRANCH = "release-please--branches--main--components--api";
const e2eCases: Array<[string, string, string[] | null, boolean, string]> = [
  ["pull_request", DESKTOP_BRANCH, ["apps/kaipu-record/src/a.ts"], true, "desktop release, code"],
  ["pull_request", WEB_RELEASE_BRANCH, ["apps/web-hono/src/a.ts"], false, "web release, code"],
  ["pull_request", API_BRANCH, ["apps/server-hono/src/a.ts"], false, "api release, code"],
  ["pull_request", DESKTOP_BRANCH, ["CHANGELOG.md"], false, "desktop release, docs only"],
  ["pull_request", "feat/ordinary", ["apps/kaipu-record/src/a.ts"], false, "ordinary PR, code"],
  [
    "pull_request",
    "feat/release-please--branches--main",
    ["apps/kaipu-record/src/a.ts"],
    false,
    "lookalike branch",
  ],
  ["workflow_dispatch", "", null, true, "manual dispatch"],
];
for (const [event, headRef, files, want, label] of e2eCases) {
  const got = runClassify(event, headRef, files).e2e === "true";
  console.log(`  e2e=${String(got).padEnd(5)} ${label}`);
  ok(got === want, `E2E rule on '${label}' expected e2e=${want}, got ${got}`);
}

// The scope rule (ADR 0052): the component comes from the branch name, and an unknown one
// is `all`. Every output the jobs read is pinned, filters included, because a wrong filter
// silently verifies the wrong packages.
console.log("\nScope rule — the real step, by its outputs");
const CODE = ["apps/kaipu-record/src/a.ts"];
const ALL_FILTERS = { build_filter: "@kaipu/*", types_filter: "*", test_filter: "!kaipu-record" };
const scopeCases: Array<[string, string, string[] | null, Record<string, string>, string]> = [
  [
    "pull_request",
    WEB_RELEASE_BRANCH,
    CODE,
    {
      release: "true",
      scope: "web",
      desktop: "false",
      workers: "true",
      e2e: "false",
      build_filter: "web-hono^...",
      types_filter: "web-hono...",
      test_filter: "web-hono...",
    },
    "web candidate",
  ],
  [
    "pull_request",
    API_BRANCH,
    CODE,
    {
      release: "true",
      scope: "api",
      desktop: "false",
      workers: "true",
      e2e: "false",
      build_filter: "server-hono^...",
      types_filter: "server-hono...",
      test_filter: "server-hono...",
    },
    "api candidate",
  ],
  [
    "pull_request",
    DESKTOP_BRANCH,
    CODE,
    {
      release: "true",
      scope: "desktop",
      desktop: "true",
      workers: "false",
      e2e: "true",
      build_filter: "kaipu-record^...",
      types_filter: "kaipu-record...",
      test_filter: "kaipu-record^...",
    },
    "desktop candidate",
  ],
  [
    "pull_request",
    DESKTOP_BRANCH,
    ["CHANGELOG.md"],
    { release: "true", scope: "desktop", desktop: "true", workers: "false", e2e: "false" },
    "desktop candidate, docs only",
  ],
  [
    "workflow_dispatch",
    "",
    null,
    {
      release: "true",
      scope: "all",
      desktop: "true",
      workers: "true",
      e2e: "true",
      ...ALL_FILTERS,
    },
    "manual dispatch",
  ],
  [
    "pull_request",
    "release-please--branches--main--components--cli",
    CODE,
    {
      release: "true",
      scope: "all",
      desktop: "true",
      workers: "true",
      e2e: "true",
      ...ALL_FILTERS,
    },
    "unknown component on a release-please branch",
  ],
  [
    "pull_request",
    "release-please--branches--main",
    CODE,
    {
      release: "true",
      scope: "all",
      desktop: "true",
      workers: "true",
      e2e: "true",
      ...ALL_FILTERS,
    },
    "release-please branch without a component",
  ],
  [
    "pull_request",
    "feat/web",
    CODE,
    { release: "false", scope: "none", desktop: "false", workers: "false", e2e: "false" },
    "ordinary PR is not a candidate, so it has no scope",
  ],
];
for (const [event, headRef, files, want, label] of scopeCases) {
  const got = runClassify(event, headRef, files);
  console.log(
    `  ${label.padEnd(48)} scope=${(got.scope ?? "?").padEnd(8)} desktop=${got.desktop} workers=${got.workers} e2e=${got.e2e}`,
  );
  for (const [key, value] of Object.entries(want)) {
    ok(
      got[key] === value,
      `scope rule on '${label}': ${key} expected '${value}', got '${got[key]}'`,
    );
  }
}

// The collector, by running its real script: a scoped part may be skipped only where the
// scope does not cover it. A skip anywhere else is a part that failed to start, and counts
// as a failure.
console.log("\nCollector — the real `All checks passed` script, by exit code");
const collect = stepScript("verify", "Require every part to have passed");
// [lint, types, tests, tests_desktop, bundles, docs, desktop, workers, expected exit, label]
type CollectCase = [string, string, string, string, string, string, string, string, number, string];
const collectCases: CollectCase[] = [
  ["success", "success", "success", "success", "success", "success", "true", "true", 0, "all"],
  [
    "success",
    "success",
    "success",
    "skipped",
    "success",
    "success",
    "false",
    "true",
    0,
    "web or api",
  ],
  ["success", "success", "success", "success", "skipped", "success", "true", "false", 0, "desktop"],
  [
    "success",
    "success",
    "failure",
    "skipped",
    "success",
    "success",
    "false",
    "true",
    1,
    "workspace tests failed",
  ],
  [
    "success",
    "success",
    "success",
    "failure",
    "skipped",
    "success",
    "true",
    "false",
    1,
    "a desktop shard failed",
  ],
  [
    "success",
    "success",
    "success",
    "skipped",
    "success",
    "success",
    "true",
    "true",
    1,
    "shards skipped but required",
  ],
  [
    "success",
    "success",
    "success",
    "success",
    "skipped",
    "success",
    "true",
    "true",
    1,
    "bundles skipped but required",
  ],
  [
    "failure",
    "success",
    "success",
    "skipped",
    "success",
    "success",
    "false",
    "true",
    1,
    "lint failed",
  ],
  [
    "success",
    "failure",
    "success",
    "skipped",
    "success",
    "success",
    "false",
    "true",
    1,
    "types failed",
  ],
  [
    "success",
    "success",
    "success",
    "skipped",
    "failure",
    "success",
    "false",
    "true",
    1,
    "bundles failed",
  ],
  [
    "success",
    "success",
    "success",
    "skipped",
    "success",
    "failure",
    "false",
    "true",
    1,
    "docs failed",
  ],
  [
    "success",
    "success",
    "skipped",
    "skipped",
    "success",
    "success",
    "false",
    "true",
    1,
    "tests never ran",
  ],
];
for (const [
  lint,
  types,
  tests,
  testsDesktop,
  bundles,
  docs,
  desktop,
  workers,
  wantCode,
  label,
] of collectCases) {
  const code = runScript(collect, {
    LINT: lint,
    TYPES: types,
    TESTS: tests,
    TESTS_DESKTOP: testsDesktop,
    BUNDLES: bundles,
    DOCS: docs,
    DESKTOP: desktop,
    WORKERS: workers,
  }).code;
  console.log(`  exit=${code}  ${label}`);
  ok(code === wantCode, `collector '${label}' expected exit ${wantCode}, got ${code}`);
}

// Scoped candidates end to end, every link REAL: classify the change, decide which parts
// run from their own conditions, collect them with the real script, evaluate the gate's
// condition and run its script. This is the check that a web release no longer waits on the
// desktop suite, and that the desktop one still does.
console.log("\nScoped candidates — classify, parts, collector and gate chained");
interface Chain {
  label: string;
  event: "pull_request" | "workflow_dispatch";
  headRef: string;
  docsOnly?: boolean;
  failing?: Partial<Record<string, JobResult>>;
  want: {
    scope: string;
    testsDesktop: JobResult;
    bundles: JobResult;
    e2e: JobResult;
    verify: JobResult;
    /** The gate's exit code, or null when it stays silent (a dispatch has no PR). */
    gate: number | null;
  };
}
const chains: Chain[] = [
  {
    label: "web candidate",
    event: "pull_request",
    headRef: WEB_RELEASE_BRANCH,
    want: {
      scope: "web",
      testsDesktop: "skipped",
      bundles: "success",
      e2e: "skipped",
      verify: "success",
      gate: 0,
    },
  },
  {
    label: "api candidate",
    event: "pull_request",
    headRef: API_BRANCH,
    want: {
      scope: "api",
      testsDesktop: "skipped",
      bundles: "success",
      e2e: "skipped",
      verify: "success",
      gate: 0,
    },
  },
  {
    label: "desktop candidate",
    event: "pull_request",
    headRef: DESKTOP_BRANCH,
    want: {
      scope: "desktop",
      testsDesktop: "success",
      bundles: "skipped",
      e2e: "success",
      verify: "success",
      gate: 0,
    },
  },
  {
    label: "desktop candidate, docs only",
    event: "pull_request",
    headRef: DESKTOP_BRANCH,
    docsOnly: true,
    want: {
      scope: "desktop",
      testsDesktop: "success",
      bundles: "skipped",
      e2e: "skipped",
      verify: "success",
      gate: 0,
    },
  },
  {
    label: "web candidate, docs only",
    event: "pull_request",
    headRef: WEB_RELEASE_BRANCH,
    docsOnly: true,
    want: {
      scope: "web",
      testsDesktop: "skipped",
      bundles: "success",
      e2e: "skipped",
      verify: "success",
      gate: 0,
    },
  },
  {
    label: "manual dispatch",
    event: "workflow_dispatch",
    headRef: "",
    want: {
      scope: "all",
      testsDesktop: "success",
      bundles: "success",
      e2e: "success",
      verify: "success",
      gate: null,
    },
  },
  {
    label: "unknown component on a release-please branch",
    event: "pull_request",
    headRef: "release-please--branches--main--components--cli",
    want: {
      scope: "all",
      testsDesktop: "success",
      bundles: "success",
      e2e: "success",
      verify: "success",
      gate: 0,
    },
  },
  {
    label: "web candidate whose workspace tests fail",
    event: "pull_request",
    headRef: WEB_RELEASE_BRANCH,
    failing: { tests: "failure" },
    want: {
      scope: "web",
      testsDesktop: "skipped",
      bundles: "success",
      e2e: "skipped",
      verify: "failure",
      gate: 1,
    },
  },
  {
    label: "api candidate whose bundle fails",
    event: "pull_request",
    headRef: API_BRANCH,
    failing: { bundles: "failure" },
    want: {
      scope: "api",
      testsDesktop: "skipped",
      bundles: "failure",
      e2e: "skipped",
      verify: "failure",
      gate: 1,
    },
  },
  {
    label: "desktop candidate whose shard fails",
    event: "pull_request",
    headRef: DESKTOP_BRANCH,
    failing: { tests_desktop: "failure" },
    want: {
      scope: "desktop",
      testsDesktop: "failure",
      bundles: "skipped",
      e2e: "success",
      verify: "failure",
      gate: 1,
    },
  },
  {
    label: "desktop candidate whose E2E fails",
    event: "pull_request",
    headRef: DESKTOP_BRANCH,
    failing: { e2e_desktop: "failure" },
    want: {
      scope: "desktop",
      testsDesktop: "success",
      bundles: "skipped",
      e2e: "failure",
      verify: "success",
      gate: 1,
    },
  },
];
for (const c of chains) {
  const ctx =
    c.event === "workflow_dispatch"
      ? { ...dispatchEvent }
      : pullRequestEvent({ action: "ready_for_review", headRef: c.headRef });
  const outputs = classifyFor(ctx, c.docsOnly ?? false);
  const changes = { result: "success" as JobResult, outputs };
  const partResult = (id: keyof typeof exprs): JobResult =>
    c.failing?.[id] ??
    (evaluate(exprs[id], { ...ctx, needs: { changes } }) ? "success" : "skipped");
  const parts = {
    lint: partResult("lint"),
    types: partResult("types"),
    tests: partResult("tests"),
    tests_desktop: partResult("tests_desktop"),
    bundles: partResult("bundles"),
    docs: partResult("docs"),
  };
  const verifyRuns = evaluate(exprs.verify, {
    ...ctx,
    needs: {
      changes,
      lint: { result: parts.lint },
      types: { result: parts.types },
      tests: { result: parts.tests },
      tests_desktop: { result: parts.tests_desktop },
      bundles: { result: parts.bundles },
      docs: { result: parts.docs },
    },
  });
  let verify: JobResult = "skipped";
  if (verifyRuns) {
    verify =
      runScript(collect, {
        LINT: parts.lint,
        TYPES: parts.types,
        TESTS: parts.tests,
        TESTS_DESKTOP: parts.tests_desktop,
        BUNDLES: parts.bundles,
        DOCS: parts.docs,
        DESKTOP: outputs.desktop!,
        WORKERS: outputs.workers!,
      }).code === 0
        ? "success"
        : "failure";
  }
  const e2eEligible = evaluate(exprs.e2e, { ...ctx, needs: { changes } });
  const e2e: JobResult = e2eEligible ? (c.failing?.e2e_desktop ?? "success") : "skipped";
  const gateNeeds = { changes, verify: { result: verify }, e2e_desktop: { result: e2e } };
  const gateReports = evaluate(exprs.gate, { ...ctx, needs: gateNeeds });
  let gateCode: number | null = null;
  if (gateReports) {
    gateCode = runScript(decide, {
      IS_DRAFT: "false",
      VERIFY: verify,
      E2E: e2e,
      CHANGES: "success",
      DOCS_ONLY: outputs.docs_only!,
      E2E_REQUIRED: outputs.e2e!,
      RELEASE: outputs.release!,
      SCOPE: outputs.scope!,
      SHA: "1bd8b2a",
    }).code;
  }
  console.log(
    `  ${c.label.padEnd(48)} scope=${outputs.scope!.padEnd(8)} shards=${parts.tests_desktop.padEnd(8)} bundles=${parts.bundles.padEnd(8)} e2e=${e2e.padEnd(8)} verify=${verify.padEnd(8)} gate=${gateCode === null ? "silent" : `exit ${gateCode}`}`,
  );
  const got = {
    scope: outputs.scope,
    testsDesktop: parts.tests_desktop,
    bundles: parts.bundles,
    e2e,
    verify,
    gate: gateCode,
  };
  for (const key of Object.keys(c.want) as Array<keyof Chain["want"]>) {
    ok(
      got[key] === c.want[key],
      `chain '${c.label}': ${key} expected ${c.want[key]}, got ${got[key]}`,
    );
  }
  // A failing part is never lost on the way: if one failed, the gate must not pass.
  if (Object.values(c.failing ?? {}).includes("failure")) {
    ok(gateCode !== 0, `chain '${c.label}': a failing part must never let the gate pass`);
  }
}
// The scope's own message, for the one case a reader will see: not a desktop release.
{
  const r = runScript(decide, {
    IS_DRAFT: "false",
    VERIFY: "success",
    E2E: "skipped",
    CHANGES: "success",
    DOCS_ONLY: "false",
    E2E_REQUIRED: "false",
    RELEASE: "true",
    SCOPE: "web",
    SHA: "1bd8b2a",
  });
  ok(
    r.code === 0 &&
      /Not a desktop release: the desktop end-to-end suite is not required\./.test(r.out),
    "the gate must say 'Not a desktop release' when a non-desktop candidate skips the E2E",
  );
}

ok(
  /previous_filename/.test(jobBlock("changes")),
  "the changed-file list must include the old path of a rename, or moving code into a .md reads as docs-only",
);
ok(
  !/^ {4}paths(-ignore)?:/m.test(source),
  "no workflow-level path filter: a skipped workflow never reports the required check (PR #173)",
);

// The transitional alias must mirror, never invent, a pass.
console.log("\nTransitional alias — 'Release candidate verified' mirrors 'Merge requirements'");
const mirror = stepScript("legacy-gate", "Mirror merge requirements for the existing branch rule");
for (const [gate, wantCode] of [
  ["success", 0],
  ["failure", 1],
  ["cancelled", 1],
  ["skipped", 1],
] as Array<[string, number]>) {
  let code = 0;
  try {
    execFileSync("bash", ["-c", mirror], {
      env: { ...process.env, GATE: gate },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    code = (e as { status?: number }).status ?? -1;
  }
  console.log(`  GATE=${gate.padEnd(10)} exit=${code}`);
  ok(code === wantCode, `alias with GATE=${gate} expected exit ${wantCode}, got ${code}`);
}

console.log("");
if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL  ${f}`);
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log("All workflow eligibility checks passed.");
