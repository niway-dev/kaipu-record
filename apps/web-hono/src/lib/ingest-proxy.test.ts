import { describe, expect, it, vi } from "vitest";

import { proxyIngest } from "./ingest-proxy";

function upstreamOk(body = "{}") {
  return vi.fn(
    async (_request: Request) =>
      new Response(body, {
        status: 200,
        headers: { "set-cookie": "ph=1; Path=/", "content-encoding": "gzip", "x-keep": "yes" },
      }),
  );
}

describe("proxyIngest", () => {
  it("forwards events to the ingestion host, keeping method, query and body", async () => {
    const fetchFn = upstreamOk();
    const request = new Request("https://kaipu.app/ingest/e/?ip=1&ver=1.2", {
      method: "POST",
      body: '{"event":"x"}',
      headers: { "content-type": "application/json" },
    });
    await proxyIngest(request, fetchFn);
    const sent = fetchFn.mock.calls[0]![0];
    expect(sent.url).toBe("https://us.i.posthog.com/e/?ip=1&ver=1.2");
    expect(sent.method).toBe("POST");
    expect(sent.headers.get("content-type")).toBe("application/json");
    expect(await sent.text()).toBe('{"event":"x"}');
  });

  it("sends /ingest/static/* to the assets host", async () => {
    const fetchFn = upstreamOk();
    await proxyIngest(new Request("https://kaipu.app/ingest/static/array.js"), fetchFn);
    expect(fetchFn.mock.calls[0]![0].url).toBe("https://us-assets.i.posthog.com/static/array.js");
  });

  it("strips cookies from the request and passes the client address on", async () => {
    const fetchFn = upstreamOk();
    await proxyIngest(
      new Request("https://kaipu.app/ingest/decide", {
        headers: { cookie: "session=secret", "cf-connecting-ip": "203.0.113.7" },
      }),
      fetchFn,
    );
    const sent = fetchFn.mock.calls[0]![0];
    expect(sent.headers.get("cookie")).toBeNull();
    expect(sent.headers.get("x-forwarded-for")).toBe("203.0.113.7");
  });

  it("drops set-cookie and stale encoding headers from the response", async () => {
    const response = await proxyIngest(
      new Request("https://kaipu.app/ingest/e/", { method: "POST", body: "{}" }),
      upstreamOk("ok"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("x-keep")).toBe("yes");
    expect(await response.text()).toBe("ok");
  });

  it("answers 502 when PostHog cannot be reached", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await proxyIngest(
      new Request("https://kaipu.app/ingest/e/", { method: "POST", body: "{}" }),
      async () => {
        throw new Error("down");
      },
    );
    expect(response.status).toBe(502);
    error.mockRestore();
  });
});
