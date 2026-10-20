/**
 * Reviews a pull request with Claude Code (`claude -p`) and posts the result as a GitHub review.
 *
 *   bun scripts/claude-review.ts review <pr> [paths…]   review it; after the first review, only
 *                                                       what changed since the last reviewed commit
 *   bun scripts/claude-review.ts comment <pr>           route the owner's @claude comment, read
 *                                                       from $REQUEST, to a review or an answer
 *
 * Decide before spending. Files nobody reviews (lockfiles, build output, generated code) are
 * dropped first; a pull request still above the size gate gets a review body saying how to scope
 * it, and Claude is never called. Below the gate, one `claude -p` call returns structured output
 * that lists the files it reviewed; a file it does not account for makes the review "partial",
 * on its first line.
 *
 * Findings become inline review comments on their lines, so the owner can answer each one in its
 * thread; a finding outside the diff goes in the review body. The review is advisory: it never
 * approves, requests changes or blocks a merge. On a re-review, Claude reads its open threads and
 * the owner's replies and answers in each thread. It never resolves one.
 *
 * What to look for beyond the defaults (correctness, security, the repository's CLAUDE.md or
 * AGENTS.md) comes from `.github/claude-review.md` when the repository has one.
 *
 * Claude only reads: no shell, no GitHub token, `/proc` denied. This script holds the tokens and
 * refuses to post text containing the API key. That is best-effort, not a sandbox: it relies on
 * the consumer repository's trust assumption (only the owner pushes), stated in its workflow.
 *
 * Needs GH_TOKEN, ANTHROPIC_API_KEY, GITHUB_REPOSITORY and `claude` on the PATH.
 * Design: niway-dev/pr-review-engine, docs/specs/2026-10-20-claude-p-review-kit-v1-design.md.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface PrFile {
  filename: string;
  additions: number;
  deletions: number;
  /** GitHub omits it for binary files and very large diffs. */
  patch?: string;
}

export interface Finding {
  path: string;
  /** A new-side line, or 0 for a finding about the whole file. */
  line: number;
  /** "should_fix": a correctness or security defect. "note": anything else worth reading. */
  severity: "should_fix" | "note";
  category: "correctness" | "security" | "rules" | "adr" | "other";
  title: string;
  body: string;
}

export interface ReviewOutput {
  files_reviewed: string[];
  files_skipped: { path: string; reason: string }[];
  findings: Finding[];
  thread_replies: { comment_id: number; status: "addressed" | "still_open"; reply: string }[];
  summary: string;
}

export interface InlineComment {
  path: string;
  line: number;
  side: "RIGHT";
  body: string;
}

export interface Review {
  body: string;
  comments: InlineComment[];
}

export type Command = { kind: "review"; paths: string[] } | { kind: "answer" };

export const DEFAULT_EXCLUDE = [
  "**/bun.lock",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",
  "**/*.lock",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/*.min.js",
  "**/*.map",
  "**/*.snap",
  "**/*.generated.*",
  "**/worker-configuration.d.ts",
];

const MARKER = /<!-- claude-review sha=([A-Za-z0-9]+) -->/;
const KEY_SHAPE = /sk-ant-[a-z0-9]+-[A-Za-z0-9_-]{20,}/;
const short = (sha: string) => sha.slice(0, 7);
const label = (f: Finding) =>
  `**${f.severity === "should_fix" ? "Should fix" : "Note"} (${f.category}): ${f.title}**`;
const at = (f: { path: string; line: number }) => (f.line > 0 ? `${f.path}:${f.line}` : f.path);

export function parseCommand(body: string): Command | null {
  // Only the rest of the first line: "@claude review\n\nthanks" asks for a review, not a path.
  const match = body.match(/@claude\b(.*)/);
  if (!match) return null;
  const words = match[1].trim().split(/\s+/).filter(Boolean);
  if (words[0]?.toLowerCase() === "review") return { kind: "review", paths: words.slice(1) };
  return { kind: "answer" };
}

const underPath = (name: string, path: string) =>
  name === path || name.startsWith(path.endsWith("/") ? path : `${path}/`);

/** Words after `@claude review` that name no changed file ("again", "please") are not paths. */
export function resolveScope(words: string[], filenames: string[]) {
  const paths = words.filter((w) => filenames.some((f) => underPath(f, w)));
  return { paths, ignored: words.filter((w) => !paths.includes(w)) };
}

export function filterFiles(files: PrFile[], exclude: string[], scope: string[]) {
  const globs = exclude.map((pattern) => new Bun.Glob(pattern));
  const inScope = (name: string) => scope.length === 0 || scope.some((p) => underPath(name, p));
  const kept: PrFile[] = [];
  const dropped: PrFile[] = [];
  for (const f of files) {
    if (!inScope(f.filename)) continue;
    (globs.some((g) => g.match(f.filename)) ? dropped : kept).push(f);
  }
  return { kept, dropped };
}

export function gateCheck(files: PrFile[], limits: { maxLines: number; maxFiles: number }) {
  const byDirMap = new Map<string, number>();
  let lines = 0;
  for (const f of files) {
    const size = f.additions + f.deletions;
    lines += size;
    const dir = f.filename.includes("/") ? f.filename.split("/")[0] : "(root)";
    byDirMap.set(dir, (byDirMap.get(dir) ?? 0) + size);
  }
  const byDir = [...byDirMap].sort((a, b) => b[1] - a[1]);
  const ok = lines <= limits.maxLines && files.length <= limits.maxFiles;
  return { ok, lines, files: files.length, byDir };
}

/** The new-side line numbers a review comment can target: added and context lines. */
export function commentableLines(patch: string): Set<number> {
  const lines = new Set<number>();
  let next = 0;
  for (const row of patch.split("\n")) {
    const hunk = row.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      next = Number(hunk[1]);
    } else if (row.startsWith("+") || row.startsWith(" ")) {
      lines.add(next++);
    }
  }
  return lines;
}

/**
 * The diff Claude reads, with each line's number in the file at the head commit on the left
 * (blank for removed lines), so the `line` it reports is one GitHub can anchor a thread to.
 */
export function annotateDiff(files: PrFile[]) {
  const out: string[] = [];
  for (const f of files) {
    out.push(`### ${f.filename}`);
    if (!f.patch) {
      out.push("(no diff from GitHub: binary or too large; read the file itself)");
      continue;
    }
    let next = 0;
    for (const row of f.patch.split("\n")) {
      const hunk = row.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunk) {
        next = Number(hunk[1]);
        out.push(row);
      } else if (row.startsWith("+") || row.startsWith(" ")) {
        out.push(`${String(next++).padStart(5)} ${row}`);
      } else {
        out.push(`      ${row}`);
      }
    }
  }
  return out.join("\n");
}

export const marker = (sha: string) => `<!-- claude-review sha=${sha} -->`;

export const readMarker = (body: string) => body.match(MARKER)?.[1] ?? null;

export function coverageGaps(expected: string[], reviewed: string[], skipped: string[]) {
  const accounted = new Set([...reviewed, ...skipped]);
  return expected.filter((f) => !accounted.has(f));
}

export function buildReview(input: {
  output: ReviewOutput;
  files: PrFile[];
  headSha: string;
  since: string | null;
  /** Limited to `@claude review <paths>`. */
  scoped: boolean;
  costUsd: number;
}): Review {
  const { output, files, headSha, since, scoped, costUsd } = input;
  const commentable = new Map(files.map((f) => [f.filename, commentableLines(f.patch ?? "")]));
  const comments: InlineComment[] = [];
  const outsideDiff: Finding[] = [];
  for (const f of output.findings) {
    if (commentable.get(f.path)?.has(f.line)) {
      comments.push({
        path: f.path,
        line: f.line,
        side: "RIGHT",
        body: `${label(f)}\n\n${f.body}`,
      });
    } else outsideDiff.push(f);
  }

  const expected = files.map((f) => f.filename);
  const reviewed = new Set(output.files_reviewed);
  const notReviewed = expected.filter((f) => !reviewed.has(f));
  const reasons = new Map(output.files_skipped.map((s) => [s.path, s.reason]));
  const scope = since ? `changes since \`${short(since)}\`` : "the whole pull request";
  const parts: string[] = [];
  if (notReviewed.length > 0) {
    const list = notReviewed.map((f) => `\`${f}\`${reasons.has(f) ? ` (${reasons.get(f)})` : ""}`);
    parts.push(
      `⚠️ **Partial review**: Claude reviewed ${expected.length - notReviewed.length} of ${expected.length} files of ${scope}, at \`${short(headSha)}\`. Not reviewed: ${list.join(", ")}. Ask \`@claude review <paths>\` for the rest.`,
    );
  } else {
    parts.push(
      `**Claude review** of ${scope}, at \`${short(headSha)}\`: all ${expected.length} files reviewed.`,
    );
  }
  const fixes = output.findings.filter((f) => f.severity === "should_fix").length;
  parts.push(
    `${output.findings.length} finding(s), ${fixes} to fix; ${comments.length} on their lines. Reply in a comment's thread to answer it.`,
  );
  if (outsideDiff.length > 0) {
    parts.push(
      "### Outside the diff",
      ...outsideDiff.map((f) => `- ${label(f)} (\`${at(f)}\`): ${f.body}`),
    );
  }
  parts.push("### Summary", output.summary);
  parts.push(`<sub>Claude Sonnet 5.5 · $${costUsd.toFixed(2)}</sub>`);
  // The next `@claude review` starts from this commit, so only a review that covered everything
  // may move it; a scoped or partial one would leave the rest never reviewed.
  if (!scoped && notReviewed.length === 0) parts.push(marker(headSha));
  return { body: parts.join("\n\n"), comments };
}

/** For a review GitHub refused (422): every inline finding moves to the body. */
export function moveCommentsToBody(review: Review): Review {
  if (review.comments.length === 0) return review;
  const moved = review.comments.map(
    (c) => `- \`${c.path}:${c.line}\`: ${c.body.replace(/\n\n/, " ")}`,
  );
  const section = `### On their lines (GitHub refused them inline)\n\n${moved.join("\n")}`;
  const summary = review.body.indexOf("\n\n### Summary");
  const body =
    summary === -1
      ? `${review.body}\n\n${section}`
      : `${review.body.slice(0, summary)}\n\n${section}${review.body.slice(summary)}`;
  return { body, comments: [] };
}

export function leaksKey(texts: string[], key: string) {
  return texts.some((t) => (key !== "" && t.includes(key)) || KEY_SHAPE.test(t));
}

// ---------------------------------------------------------------------------------------------
// GitHub and Claude: everything below talks to the network and is exercised by the workflow.

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["files_reviewed", "files_skipped", "findings", "thread_replies", "summary"],
  properties: {
    files_reviewed: { type: "array", items: { type: "string" } },
    files_skipped: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "reason"],
        properties: { path: { type: "string" }, reason: { type: "string" } },
      },
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "line", "severity", "category", "title", "body"],
        properties: {
          path: { type: "string" },
          line: { type: "integer", minimum: 0 },
          severity: { enum: ["should_fix", "note"] },
          category: { enum: ["correctness", "security", "rules", "adr", "other"] },
          title: { type: "string" },
          body: { type: "string" },
        },
      },
    },
    thread_replies: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["comment_id", "status", "reply"],
        properties: {
          comment_id: { type: "integer" },
          status: { enum: ["addressed", "still_open"] },
          reply: { type: "string" },
        },
      },
    },
    summary: { type: "string" },
  },
};

const RULES = `Severity "should_fix" is only for:
1. A correctness bug: name the input or state that fails and what happens.
2. A security problem: credentials, user data, or a trust boundary the change weakens.
Everything else is a "note": a violation of the repository's CLAUDE.md or AGENTS.md rules, a
change that contradicts an accepted decision record without superseding it, and anything else
worth the author's time. Skip praise, style a formatter would catch, and speculation you cannot
tie to the diff. Write in English.`;

/** The repository's own review focus, appended to the rules when it exists. */
function repoFocus() {
  const path = ".github/claude-review.md";
  return existsSync(path)
    ? `\n\nThis repository's review focus (${path}):\n\n${readFileSync(path, "utf8")}`
    : "";
}

function env(name: string, fallback?: string) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
}

function gh(args: string[], input?: string) {
  const run = spawnSync("gh", args, { input, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (run.status !== 0) throw new Error(`gh ${args.slice(0, 3).join(" ")} failed: ${run.stderr}`);
  return run.stdout;
}

const jsonLines = <T>(text: string) =>
  text
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);

// `gh --jq` prints string results raw, like `jq -r`: `@json` of an object prints the object's
// JSON, and `@json` of a string prints the quoted string. One JSON value per line either way.
export function listFiles(repo: string, pr: number): PrFile[] {
  const jq = ".[] | {filename, additions, deletions, patch} | @json";
  return jsonLines<PrFile>(
    gh(["api", "--paginate", `repos/${repo}/pulls/${pr}/files`, "--jq", jq]),
  );
}

export function lastReviewedSha(repo: string, pr: number) {
  const jq = '.[] | select(.user.login == "github-actions[bot]") | .body | @json';
  const bodies = jsonLines<string>(
    gh(["api", "--paginate", `repos/${repo}/pulls/${pr}/reviews`, "--jq", jq]),
  );
  return (
    bodies
      .map(readMarker)
      .filter((s): s is string => s !== null)
      .at(-1) ?? null
  );
}

export function compareFiles(repo: string, base: string, head: string) {
  const jq = "{status, files: [.files[] | {filename, additions, deletions, patch}]}";
  return JSON.parse(gh(["api", `repos/${repo}/compare/${base}...${head}`, "--jq", jq])) as {
    status: string;
    files: PrFile[];
  };
}

export interface RawThread {
  isResolved: boolean;
  path: string;
  line: number | null;
  comments: {
    nodes: {
      databaseId: number;
      author: { login: string } | null;
      authorAssociation: string;
      body: string;
    }[];
  };
}

const TRUSTED = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

/**
 * The kit's own unresolved threads, with the replies Claude may read. On a public repository
 * anyone can reply in a thread, so only replies by people with access reach the model: anything
 * else is untrusted text in Claude's context.
 */
export function openBotThreads(threads: RawThread[]) {
  return threads
    .filter((t) => !t.isResolved && t.comments.nodes[0]?.author?.login === "github-actions")
    .map((t) => ({
      comment_id: t.comments.nodes[0].databaseId,
      path: t.path,
      line: t.line,
      finding: t.comments.nodes[0].body,
      replies: t.comments.nodes
        .slice(1)
        .filter((c) => TRUSTED.has(c.authorAssociation))
        .map((c) => ({ author: c.author?.login ?? "ghost", body: c.body })),
    }));
}

export function openThreads(repo: string, pr: number) {
  const [owner, name] = repo.split("/");
  const query = `query($owner: String!, $name: String!, $pr: Int!) {
    repository(owner: $owner, name: $name) { pullRequest(number: $pr) {
      reviewThreads(first: 100) { nodes { isResolved path line
        comments(first: 30) { nodes { databaseId author { login } authorAssociation body } } } } } } }`;
  const raw = gh([
    "api",
    "graphql",
    "-f",
    `query=${query}`,
    "-F",
    `owner=${owner}`,
    "-F",
    `name=${name}`,
    "-F",
    `pr=${pr}`,
  ]);
  return openBotThreads(JSON.parse(raw).data.repository.pullRequest.reviewThreads.nodes);
}

function postReview(repo: string, pr: number, headSha: string, review: Review) {
  const send = (r: Review) =>
    gh(
      ["api", "-X", "POST", `repos/${repo}/pulls/${pr}/reviews`, "--input", "-"],
      JSON.stringify({ commit_id: headSha, event: "COMMENT", body: r.body, comments: r.comments }),
    );
  try {
    send(review);
  } catch (error) {
    if (review.comments.length === 0) throw error;
    console.error(`GitHub refused the inline comments; posting them in the body. ${error}`);
    send(moveCommentsToBody(review));
  }
}

function runClaude(prompt: string, dir: string, schema?: object) {
  const childEnv = { ...process.env };
  delete childEnv.GH_TOKEN;
  delete childEnv.GITHUB_TOKEN;
  const args = [
    "-p",
    prompt,
    "--model",
    env("CLAUDE_REVIEW_MODEL", "claude-sonnet-5-5"),
    "--max-budget-usd",
    env("CLAUDE_REVIEW_BUDGET_USD", "1"),
    "--add-dir",
    dir,
    "--allowedTools",
    "Read,Glob,Grep",
    "--disallowedTools",
    "Bash,Read(//proc/**),Grep(//proc/**),Glob(//proc/**)",
    "--output-format",
    "json",
    ...(schema ? ["--json-schema", JSON.stringify(schema)] : []),
  ];
  const run = spawnSync("claude", args, {
    env: childEnv,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.error || !run.stdout) {
    throw new Error(`claude did not run (status ${run.status}): ${run.error ?? run.stderr}`);
  }
  const result = JSON.parse(run.stdout) as {
    is_error: boolean;
    subtype: string;
    num_turns: number;
    total_cost_usd: number;
    duration_ms: number;
    result?: string;
    structured_output?: ReviewOutput;
  };
  const { is_error, subtype, num_turns, total_cost_usd, duration_ms } = result;
  console.log(JSON.stringify({ is_error, subtype, num_turns, total_cost_usd, duration_ms }));
  return result;
}

function refuseLeak(texts: string[]) {
  if (leaksKey(texts, process.env.ANTHROPIC_API_KEY ?? "")) {
    throw new Error("The output contains something shaped like an Anthropic key; not posting it.");
  }
}

function review(repo: string, pr: number, words: string[]) {
  const meta = JSON.parse(
    gh(["pr", "view", String(pr), "-R", repo, "--json", "headRefOid,title,body,author"]),
  );
  const headSha: string = meta.headRefOid;
  const bodyOnly = (body: string) => postReview(repo, pr, headSha, { body, comments: [] });

  const prFiles = listFiles(repo, pr);
  const { paths, ignored } = resolveScope(
    words,
    prFiles.map((f) => f.filename),
  );
  if (ignored.length > 0)
    console.log(`Not paths in this pull request, ignored: ${ignored.join(" ")}`);
  const last = lastReviewedSha(repo, pr);
  if (last === headSha && paths.length === 0) {
    bodyOnly(
      `Already reviewed at \`${short(headSha)}\`. Push changes, or ask \`@claude review <paths>\`.`,
    );
    return;
  }
  let since: string | null = null;
  let files = prFiles;
  if (last && paths.length === 0) {
    const cmp = compareFiles(repo, last, headSha);
    if (cmp.status === "ahead") {
      since = last;
      files = cmp.files;
    } else {
      console.log(
        `The last reviewed commit ${short(last)} is not behind the head (${cmp.status}); full review.`,
      );
    }
  }

  const extra = (process.env.CLAUDE_REVIEW_EXCLUDE ?? "").split(",").filter(Boolean);
  const { kept, dropped } = filterFiles(files, [...DEFAULT_EXCLUDE, ...extra], paths);
  if (kept.length === 0) {
    bodyOnly(
      `Nothing to review at \`${short(headSha)}\`: the ${dropped.length} changed file(s) are all lockfiles, build output or generated, or outside the requested paths.`,
    );
    return;
  }
  const limits = {
    maxLines: Number(env("CLAUDE_REVIEW_MAX_LINES", "3000")),
    maxFiles: Number(env("CLAUDE_REVIEW_MAX_FILES", "60")),
  };
  const gate = gateCheck(kept, limits);
  if (!gate.ok) {
    const dirs = gate.byDir.map(([d, n]) => `- \`${d}\`: ${n} lines`).join("\n");
    bodyOnly(
      `**Too large to review in one pass**: ${gate.lines} changed lines in ${gate.files} files after filtering (limits: ${limits.maxLines} lines, ${limits.maxFiles} files). Nothing was spent.\n\nBy top-level directory:\n\n${dirs}\n\nSplit the pull request, or review part of it: \`@claude review <path> [path…]\`.`,
    );
    return;
  }

  const dir = mkdtempSync(join(tmpdir(), "claude-review-"));
  writeFileSync(
    join(dir, "pr.json"),
    JSON.stringify({ title: meta.title, body: meta.body, author: meta.author?.login }, null, 2),
  );
  writeFileSync(join(dir, "review.diff"), annotateDiff(kept));
  const threads = last ? openThreads(repo, pr) : [];
  writeFileSync(join(dir, "threads.json"), JSON.stringify(threads, null, 2));

  const list = kept.map((f) => `- ${f.filename} +${f.additions} −${f.deletions}`).join("\n");
  const prompt = `You are reviewing pull request #${pr} in ${repo}, checked out at its head commit ${headSha}.
Read CLAUDE.md first: it holds this repository's rules, and the ADRs in docs/adr/ hold its decisions.

The pull request's title, body and author are in ${dir}/pr.json. The diff to review is in
${dir}/review.diff and covers ${since ? `only the changes since commit ${since}, the last reviewed one` : "the whole pull request"}.
It contains exactly these files${paths.length ? `, limited to ${paths.join(", ")}` : ""}:
${list}
${dropped.length} more changed file(s) (lockfiles, build output, generated) were left out on purpose.

Each diff line starts with its line number in the file at the head commit (blank for removed
lines). Use that number as a finding's \`line\`, never a position in review.diff.

Review every listed file. Read a changed file in full when a finding needs its surroundings; read
other files only to confirm a finding. Put in files_reviewed only the files you actually reviewed;
put any listed file you did not review in files_skipped with the reason.
${
  threads.length
    ? `
Open review threads from earlier rounds, with the owner's replies, are in ${dir}/threads.json. For
each one, decide whether the current code addresses it and add a thread_replies entry with a short
reply to the owner. Do not repeat a finding that already has an open thread.
`
    : ""
}
${RULES}${repoFocus()}`;

  const result = runClaude(prompt, dir, SCHEMA);
  if (result.is_error || !result.structured_output) {
    if (/budget/i.test(result.subtype)) {
      bodyOnly(
        `**Claude ran out of its $${env("CLAUDE_REVIEW_BUDGET_USD", "1")} budget** after ${result.num_turns} turns, before finishing: nothing here was reviewed reliably. Review part of it: \`@claude review <path> [path…]\`.`,
      );
      return;
    }
    throw new Error(`Claude did not return a review (${result.subtype}).`);
  }
  const built = buildReview({
    output: result.structured_output,
    files: kept,
    headSha,
    since,
    scoped: paths.length > 0,
    costUsd: result.total_cost_usd,
  });
  // Only threads the script handed over: an id the model made up would reply elsewhere.
  const known = new Set(threads.map((t) => t.comment_id));
  const replies = result.structured_output.thread_replies.filter((r) => known.has(r.comment_id));
  refuseLeak([built.body, ...built.comments.map((c) => c.body), ...replies.map((r) => r.reply)]);
  postReview(repo, pr, headSha, built);
  for (const r of replies) {
    const label = r.status === "addressed" ? "Looks addressed" : "Still open";
    gh([
      "api",
      "-X",
      "POST",
      `repos/${repo}/pulls/${pr}/comments/${r.comment_id}/replies`,
      "-f",
      `body=**${label}** at \`${short(headSha)}\`: ${r.reply}`,
    ]);
  }
}

function answer(repo: string, pr: number, question: string) {
  const dir = mkdtempSync(join(tmpdir(), "claude-answer-"));
  writeFileSync(
    join(dir, "pr.json"),
    gh(["pr", "view", String(pr), "-R", repo, "--json", "title,body,files"]),
  );
  writeFileSync(join(dir, "pr.diff"), gh(["pr", "diff", String(pr), "-R", repo]));
  const prompt = `This is pull request #${pr} in ${repo}, checked out at its head. Its title, body and file
list are in ${dir}/pr.json and its diff in ${dir}/pr.diff. Read CLAUDE.md first.

The repository owner asked on the pull request:

<request>
${question}
</request>

Answer it. Your final message is posted verbatim as the comment, so it holds the answer and
nothing else. Write in English.`;
  const result = runClaude(prompt, dir);
  if (result.is_error || !result.result)
    throw new Error(`Claude did not answer (${result.subtype}).`);
  const body = `${result.result}\n\n<sub>Claude Sonnet 5.5 · $${result.total_cost_usd.toFixed(2)}</sub>`;
  refuseLeak([body]);
  gh(["pr", "comment", String(pr), "-R", repo, "--body-file", "-"], body);
}

if (import.meta.main) {
  env("ANTHROPIC_API_KEY");
  env("GH_TOKEN");
  const repo = env("GITHUB_REPOSITORY");
  const [mode, prArg, ...rest] = process.argv.slice(2);
  const pr = Number(prArg);
  if (!Number.isInteger(pr) || pr <= 0)
    throw new Error("usage: claude-review.ts review|comment <pr> [paths…]");
  if (mode === "review") review(repo, pr, rest);
  else if (mode === "comment") {
    const request = env("REQUEST");
    const command = parseCommand(request);
    if (command?.kind === "review") review(repo, pr, command.paths);
    else if (command) answer(repo, pr, request);
  } else throw new Error("usage: claude-review.ts review|comment <pr> [paths…]");
}
