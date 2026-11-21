/** Watch spec handling for the growing export file. Records sizes only, never names. */

export function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\?]/g, "\\$&").replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`);
}

/** `<dir>/<glob>` splits at the last `/`; a directory means every file in it. */
export function splitWatchSpec(
  spec: string,
  isDirectory: (path: string) => boolean,
): { dir: string; pattern: string } {
  if (spec.includes("*") || !isDirectory(spec)) {
    const i = spec.lastIndexOf("/");
    if (i < 0) return { dir: ".", pattern: spec };
    return { dir: spec.slice(0, i) || "/", pattern: spec.slice(i + 1) };
  }
  return { dir: spec, pattern: "*" };
}
