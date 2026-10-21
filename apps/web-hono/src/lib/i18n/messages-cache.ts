import type { Locale } from "@kaipu/i18n";

import { mergeMessages, type MessageTree } from "./pick-messages";
import { coversSlices, type MessageSlice } from "./route-messages";

interface Loaded {
  locale: Locale;
  slices: Set<MessageSlice>;
  messages: MessageTree;
}

/**
 * What this tab already holds, so a client-side navigation only asks the server
 * for slices it has not seen. Browser-only: a module-level value on the server
 * would be shared between requests, so every function here is a no-op there.
 */
let loaded: Loaded | null = null;

const isBrowser = () => typeof window !== "undefined";

/** The cached locale and messages, if they already cover everything in `need`. */
export function readCovering(need: readonly MessageSlice[]) {
  if (!isBrowser() || !loaded || !coversSlices(loaded.slices, need)) return null;
  return { locale: loaded.locale, messages: loaded.messages };
}

/** Fold a server response (or the SSR payload) into the cache and return the union. */
export function remember(
  locale: Locale,
  slices: readonly MessageSlice[],
  messages: MessageTree,
): MessageTree {
  if (!isBrowser()) return messages;
  const previous = loaded?.locale === locale ? loaded : null;
  loaded = {
    locale,
    slices: new Set([...(previous?.slices ?? []), ...slices]),
    messages: previous ? mergeMessages(previous.messages, messages) : messages,
  };
  return loaded.messages;
}

/** Forget everything, e.g. when the locale changes and the cache is for the old one. */
export function forget() {
  loaded = null;
}
