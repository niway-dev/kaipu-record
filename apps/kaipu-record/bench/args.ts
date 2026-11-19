export interface AttachArgs {
  /** Free-form label, never the real hostname. */
  machine: string;
  /** Watch spec (dir or glob) for the growing export file; null disables watching. */
  watch: string | null;
  /** Stop by itself after this many seconds (smoke tests); null = until Ctrl+C. */
  duration: number | null;
  /** Substring of the Electron main command; default is the git root of the cwd. */
  match: string | null;
  out: string | null;
  help: boolean;
}

export const USAGE = `bun run bench:attach [options]

Samples the dev app you already started with \`bun run dev\`. Never launches Electron.
Type a label and press Enter to add a phase mark. Ctrl+C writes the run folder.

  --machine <label>       series label, e.g. owner-M5 (default: local)
  --watch-file <glob|dir> growing export file; sizes only (default: ~/Movies/Kaipu Record/.kaipu/tmp)
  --no-watch              do not watch any file
  --match <substring>     Electron path must contain it (default: this repo's root)
  --out <dir>             run folder parent (default: apps/kaipu-record/bench/runs)
  --duration <seconds>    stop by itself
`;

export function parseAttachArgs(argv: string[], home: string): AttachArgs | { error: string } {
  const a: AttachArgs = {
    machine: "local",
    watch: `${home}/Movies/Kaipu Record/.kaipu/tmp`,
    duration: null,
    match: null,
    out: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    let flag = argv[i]!;
    let value: string | undefined;
    const eq = flag.indexOf("=");
    if (flag.startsWith("--") && eq > 0) {
      value = flag.slice(eq + 1);
      flag = flag.slice(0, eq);
    }
    const next = (): string | undefined => value ?? argv[++i];
    switch (flag) {
      case "--help":
      case "-h":
        a.help = true;
        break;
      case "--no-watch":
        a.watch = null;
        break;
      case "--machine": {
        const v = next();
        if (!v || !/^[A-Za-z0-9._-]+$/.test(v))
          return { error: "--machine needs letters, digits, . _ -" };
        a.machine = v;
        break;
      }
      case "--watch-file": {
        const v = next();
        if (!v) return { error: "--watch-file needs a value" };
        a.watch = v;
        break;
      }
      case "--match": {
        const v = next();
        if (!v) return { error: "--match needs a value" };
        a.match = v;
        break;
      }
      case "--out": {
        const v = next();
        if (!v) return { error: "--out needs a value" };
        a.out = v;
        break;
      }
      case "--duration": {
        const n = Number(next());
        if (!Number.isFinite(n) || n <= 0)
          return { error: "--duration needs a positive number of seconds" };
        a.duration = n;
        break;
      }
      default:
        return { error: `Unknown option ${flag}` };
    }
  }
  return a;
}
