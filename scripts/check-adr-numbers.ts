#!/usr/bin/env bun
/**
 * Fails when an ADR number is used twice: by two files on this branch, or by a file on this
 * branch and a different file on `origin/main`.
 *
 * Long-lived branches pick the next free number when they are written, and `main` can take
 * the same number before they land. The webcam stack held 0032/0033 in about 120 comments and
 * docs across twelve branches while `main` gave those numbers to the workspaces ADRs; the
 * renumbering took two cascade rounds. Run on every push (verify:local), this flags the
 * collision the day `main` takes the number, while it is one file to rename.
 *
 * Without an `origin/main` ref (a fresh clone with no fetch, CI checkouts) only the local
 * duplicate check runs.
 *
 * Run: bun scripts/check-adr-numbers.ts
 */

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

const DIR = "apps/documentation/src/content/docs/architecture/decisions";
const ADR = /^(\d{4})-(.+)\.mdx?$/;

function byNumber(names: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const name of names) {
    const match = ADR.exec(name);
    if (!match) continue;
    map.set(match[1], [...(map.get(match[1]) ?? []), match[2]]);
  }
  return map;
}

function mainNames(): string[] | null {
  try {
    const out = execFileSync("git", ["ls-tree", "--name-only", "origin/main", `${DIR}/`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out
      .split("\n")
      .filter(Boolean)
      .map((path) => path.slice(path.lastIndexOf("/") + 1));
  } catch {
    return null;
  }
}

const local = byNumber(readdirSync(DIR));
const problems: string[] = [];

for (const [number, slugs] of local) {
  if (slugs.length > 1) problems.push(`ADR ${number} is used by ${slugs.join(" and ")}`);
}

const onMain = mainNames();
if (onMain) {
  const main = byNumber(onMain);
  const taken = new Set([...local.keys(), ...main.keys()]);
  let next = Math.max(...[...taken].map(Number)) + 1;
  for (const [number, slugs] of local) {
    const mainSlugs = main.get(number);
    if (!mainSlugs) continue;
    for (const slug of slugs) {
      if (mainSlugs.includes(slug)) continue;
      const free = String(next++).padStart(4, "0");
      problems.push(
        `ADR ${number} (${slug}) is taken on origin/main by ${mainSlugs.join(", ")}; renumber it, e.g. to ${free}`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error("ADR numbers collide:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
