import { vi } from "vitest";

/**
 * Harness for the real-SDK tests. Runs the real posthog-js (no mock) against a recording network, because the guarantee is
 * about what leaves the app: with the preference off, PostHog asks for flags and sends no
 * event or crash report (NIW2-849).
 */

export interface Sent {
  url: string;
  body: string;
}

export function installNetwork(): Sent[] {
  const sent: Sent[] = [];
  const respond = (url: string): Response =>
    new Response(
      url.includes("/flags/")
        ? JSON.stringify({ featureFlags: { "image-canvas": true }, flags: {} })
        : "{}",
      { status: 200 },
    );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      sent.push({ url, body: typeof init?.body === "string" ? init.body : "" });
      return respond(url);
    }),
  );
  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  let pendingUrl = "";
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, _m: string, url: string | URL) {
    pendingUrl = String(url);
    return open.apply(this, [_m, "http://localhost:1/blocked"] as never);
  } as never;
  XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
    sent.push({ url: pendingUrl, body: typeof body === "string" ? body : "" });
    return undefined as never;
  } as never;
  restore = () => {
    XMLHttpRequest.prototype.open = open;
    XMLHttpRequest.prototype.send = send;
  };
  return sent;
}

let restore = (): void => {};

export const restoreNetwork = (): void => restore();

export async function loadClient(): Promise<typeof import("./analytics-client")> {
  vi.resetModules();
  return import("./analytics-client");
}

/**
 * jsdom's user agent looks like a bot, and PostHog drops bot events: without this the
 * "nothing was sent" assertions below could never fail.
 */
export async function allowJsdomUserAgent(): Promise<void> {
  const { default: posthog } = await import("posthog-js");
  posthog.set_config({ opt_out_useragent_filter: true });
}

/**
 * Waits past PostHog's 3 s queue timer, so an event that was going to be sent has been. A
 * shorter wait would make the "nothing was sent" assertions pass for the wrong reason (a faked
 * clock does not flush its queue).
 */
export const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 3500));

/** PostHog compresses request bodies as base64 JSON in `data=`; this reads one back. */
export function decode(sent: Sent): string {
  const raw = sent.body || sent.url;
  const data = new URLSearchParams(raw.replace(/^.*?\?/, "")).get("data") ?? raw;
  try {
    return atob(decodeURIComponent(data));
  } catch {
    return raw;
  }
}
export const isCapture = (s: Sent): boolean => /\/(e|batch|capture|i\/v0\/e)\/?(\?|$)/.test(s.url);
export const isFlags = (s: Sent): boolean => s.url.includes("/flags/");

/** What a test needs before it starts: a key, a host, no stored consent, a seeded remote config. */
export function prepareRealSdk(): void {
  vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
  vi.stubEnv("VITE_POSTHOG_HOST", "https://us.i.posthog.com");
  localStorage.clear();
  // PostHog reads its remote config from here when present, instead of loading a script from
  // its servers; the flags request follows the config either way.
  (window as unknown as Record<string, unknown>)._POSTHOG_REMOTE_CONFIG = {
    phc_test: { config: { supportedCompression: [] }, siteApps: [] },
  };
}

export function cleanUpRealSdk(): void {
  restoreNetwork();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
}

/** Each real-SDK test waits out PostHog's 3 s queue timer. */
export const SLOW = 15_000;
