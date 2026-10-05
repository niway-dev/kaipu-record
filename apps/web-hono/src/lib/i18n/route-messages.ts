import type { Namespace } from "@kaipu/i18n";

/**
 * Which part of the message catalog a route needs.
 *
 * The full catalogs are ~130 KB per locale and the landing uses ~9 KB of one,
 * so the server sends only the slices the matched route renders. A slice is a
 * whole top-level namespace, or `legal.links`: the legal namespace is the
 * biggest one (20-24 KB of policy text) and the marketing footer only needs its
 * link labels, so those ride separately.
 *
 * This module is pure data on purpose: it must not import the catalogs, because
 * the client bundle imports it.
 */
export type MessageSlice = Namespace | "legal.links";

const MARKETING_CHROME: readonly MessageSlice[] = ["landing", "roadmap", "settings", "legal.links"];
const APP_CHROME: readonly MessageSlice[] = ["header", "settings", "auth", "legal"];

/**
 * First match wins. `exact` rules match the whole pathname, the others match the
 * pathname or anything beneath it. A route with no rule gets no messages, which
 * is the safe default: its text falls back to the key, visibly, instead of
 * silently shipping a catalog.
 */
const ROUTE_SLICES: ReadonlyArray<{
  path: string;
  exact?: boolean;
  slices: readonly MessageSlice[];
}> = [
  { path: "/", exact: true, slices: [...MARKETING_CHROME, "record", "nav"] },
  { path: "/roadmap", slices: MARKETING_CHROME },
  { path: "/legal", slices: [...MARKETING_CHROME, "legal"] },
  { path: "/auth", slices: APP_CHROME },
  { path: "/recordings", slices: [...APP_CHROME, "recordings"] },
];

function normalizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/** The slices the route at `pathname` renders, without duplicates. */
export function slicesForPath(pathname: string): MessageSlice[] {
  const path = normalizePath(pathname);
  const rule = ROUTE_SLICES.find((r) =>
    r.exact ? path === r.path : path === r.path || path.startsWith(`${r.path}/`),
  );
  return rule ? [...new Set(rule.slices)] : [];
}

/**
 * Whether `have` already covers every slice in `need`. A full namespace covers
 * its own sub-slice (`legal` covers `legal.links`).
 */
export function coversSlices(have: Iterable<MessageSlice>, need: readonly MessageSlice[]): boolean {
  const owned = new Set(have);
  return need.every((slice) => {
    if (owned.has(slice)) return true;
    const [namespace] = slice.split(".");
    return owned.has(namespace as MessageSlice);
  });
}
