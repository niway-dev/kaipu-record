import type { CSSProperties } from "react";

/**
 * Pass CSS custom properties through React's `style` prop.
 *
 * React renders `--kl-tint` correctly at runtime, but `CSSProperties` only
 * describes the standard properties, so TypeScript rejects the object. The
 * landing needs this constantly — a chapter hands its tint down as a variable
 * instead of shipping four near-identical classes — so the cast lives here,
 * once, rather than being scattered as `as any` at every call site.
 *
 * The input stays fully typed: only `--`-prefixed keys with string values are
 * accepted, so a typo like `kl-tint` (no dashes) is still a compile error.
 */
export function cssVars(vars: Record<`--${string}`, string>): CSSProperties {
  return vars as CSSProperties;
}
