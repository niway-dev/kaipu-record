import type { PsRow } from "./parse-system";

export interface FoundProcess {
  pid: number;
  ppid: number;
  /** main, renderer, gpu, utility[:<sub type>], other Chromium type, or native:<exe>. */
  role: string;
}

const ELECTRON_MAIN = "/Electron.app/Contents/MacOS/Electron";

function chromiumType(command: string): string | null {
  return /(?:^|\s)--type=(\S+)/.exec(command)?.[1] ?? null;
}

/**
 * Executable name for a native helper. Cuts the command at the first flag or path
 * argument so no argument or file name can reach the role, then keeps a safe token.
 */
function exeBasename(command: string): string {
  const head = command.split(/ --| \//)[0]!.trim();
  const token = (head.split("/").pop() ?? "").split(/\s+/)[0] ?? "";
  const safe = token.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 40);
  return safe || "unknown";
}

/** The root with a trailing slash, so a sibling directory sharing the prefix does not match. */
export function rootMatch(root: string): string {
  return root.endsWith("/") ? root : `${root}/`;
}

/** Role from the arguments Chromium passes to its children. Never returns a command line. */
export function roleOf(command: string): string {
  const type = chromiumType(command);
  if (type === null) {
    return command.includes(ELECTRON_MAIN) ? "main" : `native:${exeBasename(command)}`;
  }
  if (type === "gpu-process") return "gpu";
  if (type === "utility") {
    const sub = /(?:^|\s)--utility-sub-type=(\S+)/.exec(command)?.[1];
    return sub ? `utility:${sub}` : "utility";
  }
  return type;
}

export interface DiscoverOptions {
  /** The main process command must contain this (the repo's node_modules path). */
  rootContains: string;
}

/**
 * The dev app: the Electron main binary (no `--type=`) under the repo, then every
 * descendant by parent PID. Roots come first, then descendants in PID order.
 */
export function discoverProcesses(table: PsRow[], opts: DiscoverOptions): FoundProcess[] {
  const roots = table.filter(
    (r) =>
      r.command.includes(ELECTRON_MAIN) &&
      r.command.includes("/node_modules/") &&
      r.command.includes(opts.rootContains) &&
      chromiumType(r.command) === null,
  );
  const byParent = new Map<number, PsRow[]>();
  for (const r of table) {
    const list = byParent.get(r.ppid) ?? [];
    list.push(r);
    byParent.set(r.ppid, list);
  }
  const out: FoundProcess[] = [];
  const seen = new Set<number>();
  const queue = [...roots];
  while (queue.length > 0) {
    const r = queue.shift()!;
    if (seen.has(r.pid)) continue;
    seen.add(r.pid);
    out.push({ pid: r.pid, ppid: r.ppid, role: roleOf(r.command) });
    queue.push(...(byParent.get(r.pid) ?? []));
  }
  return out.sort((a, b) => a.pid - b.pid);
}
