import { FLAG_NAMES, type FlagName } from "./analytics";

/** Process argument main hands every renderer window; the preload reads it back. */
export const FLAG_OVERRIDES_ARG = "--kaipu-flag-overrides=";

export type FlagOverrides = Partial<Record<FlagName, boolean>>;

// `./analytics` is in `src/shared` and takes no value import from a workspace package, so the
// preload bundle can load it (CLAUDE.md preload rule).
const KNOWN_FLAG_NAMES: readonly string[] = FLAG_NAMES;

/**
 * Parse the `KAIPU_FLAG_OVERRIDES` value (a JSON object such as
 * `{"native-cursor-capture":true}`). A packaged build ignores it entirely. Unknown keys and
 * non-boolean values are dropped and reported in `rejected`; invalid JSON yields no overrides.
 */
export function parseFlagOverrides(
  raw: string | undefined,
  opts: { isPackaged: boolean },
): { overrides: FlagOverrides; rejected: string[] } {
  const overrides: FlagOverrides = {};
  const rejected: string[] = [];
  if (opts.isPackaged || raw === undefined || raw.trim() === "") return { overrides, rejected };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { overrides, rejected: ["<invalid JSON>"] };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { overrides, rejected: ["<not a JSON object>"] };
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (!KNOWN_FLAG_NAMES.includes(key)) rejected.push(`${key} (unknown flag)`);
    else if (typeof value !== "boolean") rejected.push(`${key} (not a boolean)`);
    else overrides[key as FlagName] = value;
  }
  return { overrides, rejected };
}

/**
 * One change to the live overrides (the Developer page toggle): pins `name` to `value`, or
 * clears it when `value` is `null`. Returns a new object. A packaged build, an unknown flag
 * and a value that is neither a boolean nor `null` change nothing (a packaged build also
 * returns no overrides at all, like `parseFlagOverrides`).
 */
export function applyFlagOverride(
  current: FlagOverrides,
  name: string,
  value: unknown,
  opts: { isPackaged: boolean },
): FlagOverrides {
  if (opts.isPackaged) return {};
  if (!KNOWN_FLAG_NAMES.includes(name)) return current;
  if (value !== null && typeof value !== "boolean") return current;
  const next = { ...current };
  if (value === null) delete next[name as FlagName];
  else next[name as FlagName] = value;
  return next;
}

/** The process argument that carries `overrides` to a renderer. */
export function flagOverridesArg(overrides: FlagOverrides): string {
  return `${FLAG_OVERRIDES_ARG}${JSON.stringify(overrides)}`;
}

/** Read the overrides back from `process.argv` (preload side); empty when absent or malformed. */
export function readFlagOverridesArg(argv: readonly string[]): FlagOverrides {
  const arg = argv.find((entry) => entry.startsWith(FLAG_OVERRIDES_ARG));
  if (!arg) return {};
  // Already validated in main; re-validate anyway so a hand-edited argv cannot inject junk.
  return parseFlagOverrides(arg.slice(FLAG_OVERRIDES_ARG.length), { isPackaged: false }).overrides;
}
