import type { MessageSlice } from "./route-messages";

/** JSON-shaped, so a server function can return it (it has to be serializable). */
export type MessageValue = string | number | boolean | null | MessageValue[] | MessageTree;
export interface MessageTree {
  [key: string]: MessageValue;
}

function isTree(value: unknown): value is MessageTree {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The `legal.links` slice: the navigation label and each document's title, which
 * is all the footer links render. Derived from the catalog rather than listed, so
 * a new legal document shows up without touching this file.
 */
function legalLinks(legal: MessageTree): MessageTree {
  const links: MessageTree = {};
  for (const [key, value] of Object.entries(legal)) {
    if (key === "navigation") links[key] = value;
    else if (isTree(value) && typeof value.title === "string") links[key] = { title: value.title };
  }
  return links;
}

/** Copy only the requested slices out of a full catalog. */
export function pickMessages(catalog: MessageTree, slices: readonly MessageSlice[]): MessageTree {
  const picked: MessageTree = {};
  for (const slice of slices) {
    if (slice !== "legal.links" && slice in catalog) picked[slice] = catalog[slice];
  }
  // A full `legal` already includes the links, so the slice never overwrites it.
  if (slices.includes("legal.links") && !("legal" in picked) && isTree(catalog.legal)) {
    picked.legal = legalLinks(catalog.legal);
  }
  return picked;
}

/** Deep-merge `next` into `base`, returning a new tree; `next` wins on leaves. */
export function mergeMessages(base: MessageTree, next: MessageTree): MessageTree {
  const merged: MessageTree = { ...base };
  for (const [key, value] of Object.entries(next)) {
    const existing = merged[key];
    merged[key] = isTree(existing) && isTree(value) ? mergeMessages(existing, value) : value;
  }
  return merged;
}
