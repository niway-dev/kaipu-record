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
  const m = block.match(/\n {4}if: >-\n([\s\S]*?)(?=\n {4}[a-z_-]+:|$)/);
  if (!m) throw new Error(`job '${id}' has no folded 'if:' block`);
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

const scenarios: Array<{
  n: number;
  title: string;
  ctx: Record<string, unknown>;
  eventType: string;
  expect: Expectation;
}> = [
  {
    n: 1,
    title: "Ordinary PR targeting main",
    ctx: pullRequestEvent({ action: "opened" }),
    eventType: "opened",
    expect: { verify: false, e2e: false, gate: true, legacy: true, cancel: false },
  },
  {
    n: 2,
    title: "Ordinary stacked PR retargeted to main",
    ctx: pullRequestEvent({ action: "edited", baseChangedFrom: "docs/settings-updates-spec" }),
    eventType: "edited",
    expect: { verify: false, e2e: false, gate: true, legacy: true, cancel: false },
  },
  {
    n: 3,
    title: "Release PR opened as draft",
    ctx: pullRequestEvent({ action: "opened", headRef: RELEASE_BRANCH, draft: true }),
    eventType: "opened",
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
    title: "Ready WEB release candidate (must not pay for macOS)",
    ctx: pullRequestEvent({ action: "ready_for_review", headRef: WEB_RELEASE_BRANCH }),
    eventType: "ready_for_review",
    expect: { verify: true, e2e: false, gate: true, legacy: true, cancel: false },
  },
  {
    n: 8,
    title: "Ready release PR title edited",
    ctx: pullRequestEvent({ action: "edited", headRef: RELEASE_BRANCH, titleChanged: true }),
    eventType: "edited",
    expect: { verify: false, e2e: false, gate: false, legacy: false, cancel: false },
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
    expect: { verify: false, e2e: false, gate: false, legacy: false, cancel: true },
  },
  {
    n: 10,
    title: "Merged release PR edited afterwards",
    ctx: pullRequestEvent({
      action: "edited",
      headRef: RELEASE_BRANCH,
      state: "closed",
      merged: true,
      baseChangedFrom: "main",
    }),
    eventType: "edited",
    expect: { verify: false, e2e: false, gate: false, legacy: false, cancel: false },
  },
  {
    n: 12,
    title: "Manual dispatch",
    ctx: dispatchEvent,
    eventType: "workflow_dispatch",
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
  const got = {
    verify: evaluate(exprs.verify, s.ctx),
    e2e: evaluate(exprs.e2e, s.ctx),
    gate: evaluate(exprs.gate, s.ctx),
    legacy: evaluate(exprs.legacy, s.ctx),
    cancel: evaluate(exprs.cancel, s.ctx),
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

// Scenario 7: label churn must not be a trigger at all.
console.log("\nScenario 7 — unrelated label added or removed");
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
const decide = stepScript("gate", "Check whether release verification permits merging");
const decideCases: Array<[string, string, string, string, number, string]> = [
  ["false", "false", "skipped", "skipped", 0, "ordinary PR: not applicable"],
  // A desktop candidate needs BOTH. This row is the one that would have stopped
  // desktop 0.8.0 before the tag existed instead of after it.
  ["true", "true", "success", "success", 0, "desktop candidate: verify + E2E green"],
  ["true", "true", "success", "failure", 1, "desktop candidate: E2E failed"],
  ["true", "true", "success", "cancelled", 1, "desktop candidate: E2E superseded"],
  ["true", "true", "success", "skipped", 1, "desktop candidate: E2E never ran"],
  ["true", "true", "failure", "skipped", 1, "desktop candidate: verify failed"],
  // A web candidate must PASS on a skipped E2E: it never starts one, by design.
  ["true", "false", "success", "skipped", 0, "web candidate: E2E not applicable"],
  ["true", "false", "failure", "skipped", 1, "web candidate: verify failed"],
];
for (const [isRelease, isDesktop, verify, e2e, wantCode, label] of decideCases) {
  let code = 0;
  let out = "";
  try {
    out = execFileSync("bash", ["-c", decide], {
      env: {
        ...process.env,
        IS_RELEASE: isRelease,
        IS_DESKTOP: isDesktop,
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
    `  release=${isRelease.padEnd(5)} desktop=${isDesktop.padEnd(5)} ` +
      `verify=${verify.padEnd(9)} e2e=${e2e.padEnd(9)} exit=${code}  ${label}`,
  );
  ok(
    code === wantCode,
    `Decide(release=${isRelease}, desktop=${isDesktop}, verify=${verify}, e2e=${e2e}) ` +
      `expected exit ${wantCode}, got ${code}`,
  );
  ok(
    !/verify.{0,3}label/i.test(out),
    `Decide must not mention the retired 'verify' label (release=${isRelease}, verify=${verify})`,
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
