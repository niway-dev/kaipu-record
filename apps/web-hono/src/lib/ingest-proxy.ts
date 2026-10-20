/**
 * First-party reverse proxy for PostHog (https://posthog.com/docs/advanced/proxy). The browser talks
 * to `/ingest/*` on our own origin; this forwards to PostHog's ingestion hosts. Requests and
 * responses are stripped of cookies so the proxy can never set or relay one.
 */
export const POSTHOG_INGEST_HOST = "us.i.posthog.com";
export const POSTHOG_ASSETS_HOST = "us-assets.i.posthog.com";

const PREFIX = "/ingest";

type FetchFn = (request: Request) => Promise<Response>;

export async function proxyIngest(
  request: Request,
  fetchFn: FetchFn = (r) => fetch(r),
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const path = url.pathname.startsWith(PREFIX) ? url.pathname.slice(PREFIX.length) : url.pathname;
    const host = path.startsWith("/static/") ? POSTHOG_ASSETS_HOST : POSTHOG_INGEST_HOST;
    const target = new URL(`https://${host}${path}${url.search}`);

    const headers = new Headers(request.headers);
    headers.delete("cookie");
    headers.delete("host");
    // PostHog geolocates, and builds the cookieless visitor hash, from the client address.
    const clientIp = request.headers.get("cf-connecting-ip");
    if (clientIp) headers.set("x-forwarded-for", clientIp);

    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const upstream = await fetchFn(
      new Request(target, {
        method: request.method,
        headers,
        body: hasBody ? await request.arrayBuffer() : undefined,
        redirect: "manual",
      }),
    );

    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete("set-cookie");
    // `fetch` already decoded the body, so the original encoding and length no longer describe it.
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("[ingest-proxy] ERROR:", error instanceof Error ? error.message : error);
    return new Response("Bad Gateway", { status: 502 });
  }
}
