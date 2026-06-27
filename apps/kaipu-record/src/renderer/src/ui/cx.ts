/** Join truthy class names. Keeps the primitives free of inline filter/join noise. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
