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

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

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
/** A release candidate that must NOT pay for a macOS runner. */
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

function needsContext(expect: Expectation, override: Partial<Record<string, JobResult>> = {}) {
  const verify: JobResult = override.verify ?? (expect.verify ? "success" : "skipped");
  const e2e: JobResult = override.e2e_desktop ?? (expect.e2e ? "success" : "skipped");
  const gate: JobResult = override.gate ?? (expect.gate ? "success" : "skipped");
  // The parallel parts `verify` collects. They share its eligibility, so by default they
  // ran exactly when it did.
  const part = (id: string): { result: JobResult } => ({
    result: override[id] ?? (expect.verify ? "success" : "skipped"),
  });
  return {
    lint: part("lint"),
    types: part("types"),
    tests: part("tests"),
    bundles: part("bundles"),
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
}> = [
  {
    n: 1,
    title: "Ordinary PR targeting main",
    ctx: pullRequestEvent({ action: "opened" }),
    eventType: "opened",
    // ADR 0010: every pull request is verified in Actions, not only release candidates.
    expect: { verify: true, e2e: true, gate: true, legacy: true, cancel: false },
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
    // It used to skip macOS to save minutes billed at ten; on a public repository they are
    // free, so every candidate runs the desktop suite (ADR 0010).
    title: "Ready WEB release candidate (now runs macOS too)",
    ctx: pullRequestEvent({ action: "ready_for_review", headRef: WEB_RELEASE_BRANCH }),
    eventType: "ready_for_review",
    expect: { verify: true, e2e: true, gate: true, legacy: true, cancel: false },
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
    title: "Ordinary PR, desktop E2E failed",
    ctx: pullRequestEvent({ action: "synchronize" }),
    eventType: "synchronize",
    results: { e2e_desktop: "failure" },
    // A real verdict: it must be reported, so the red E2E blocks the merge.
    expect: { verify: true, e2e: true, gate: true, legacy: true, cancel: false },
  },
  {
    n: 21,
    title: "Ordinary PR superseded while its tests ran",
    ctx: pullRequestEvent({ action: "synchronize" }),
    eventType: "synchronize",
    // A part cancelled by a newer revision: `verify` must not run, so it cannot turn the
    // cancellation into a failure that lands on a commit this run knows nothing about.
    results: { tests: "cancelled" },
    expect: { verify: false, e2e: true, gate: false, legacy: false, cancel: false },
  },
  {
    n: 22,
    title: "Ordinary PR whose lint failed",
    ctx: pullRequestEvent({ action: "synchronize" }),
    eventType: "synchronize",
    // A real verdict: `verify` runs (always()), fails, and the gate reports it.
    results: { lint: "failure", verify: "failure" },
    expect: { verify: true, e2e: true, gate: true, legacy: true, cancel: false },
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
  verify: ifExpression("verify"),
  e2e: ifExpression("e2e_desktop"),
  gate: ifExpression("gate"),
  legacy: ifExpression("legacy-gate"),
  cancel: ifExpression("cancel-superseded"),
};

console.log(`Workflow: ${WORKFLOW}`);
console.log(`Trigger types: ${triggerTypes().join(", ")}\n`);
console.log(
  "  #  scenario                                        verify  e2e   gate  legacy  cancel",
);
console.log(
  "  -  ----------------------------------------------  ------  ----  ----  ------  ------",
);

for (const s of scenarios) {
  const ctx = { ...s.ctx, needs: needsContext(s.expect, s.results) };
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
  const ctx = { ...s.ctx, needs: needsContext(s.expect, s.results) };
  const verified = ["success", "failure"].includes(
    (needsContext(s.expect, s.results).verify.result as string) ?? "",
  );
  const e2eOk = ["success", "failure"].includes(
    (needsContext(s.expect, s.results).e2e_desktop.result as string) ?? "",
  );
  // ADR 0010: one rule for every pull request — report iff both checks reached a verdict.
  const mustReport = verified && e2eOk;
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
// [isDraft, verify, e2e, expected exit, label]
const decideCases: Array<[string, string, string, number, string]> = [
  // The row that would have caught the 0.8.1 green button.
  ["true", "skipped", "skipped", 1, "draft: nothing verified"],
  ["false", "success", "success", 0, "verify + E2E green"],
  // This row is the one that would have stopped desktop 0.8.0 before the tag existed.
  ["false", "success", "failure", 1, "E2E failed"],
  ["false", "success", "cancelled", 1, "E2E superseded"],
  ["false", "success", "skipped", 1, "E2E never ran — no longer a pass for anything"],
  ["false", "failure", "success", 1, "verify failed"],
  ["false", "failure", "skipped", 1, "verify failed, E2E never ran"],
];
for (const [isDraft, verify, e2e, wantCode, label] of decideCases) {
  let code = 0;
  let out = "";
  try {
    out = execFileSync("bash", ["-c", decide], {
      env: {
        ...process.env,
        IS_DRAFT: isDraft,
        VERIFY: verify,
        E2E: e2e,
        SHA: "1bd8b2a",
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    code = err.status ?? -1;
    out = err.stdout ?? "";
  }
  console.log(
    `  draft=${isDraft.padEnd(5)} verify=${verify.padEnd(9)} e2e=${e2e.padEnd(9)} exit=${code}  ${label}`,
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
