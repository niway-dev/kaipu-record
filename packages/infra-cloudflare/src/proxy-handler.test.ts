import { describe, expect, it, vi } from "vitest";
import { createProxyHandler } from "./proxy-handler";

function proxyWith(
  responseInit: ResponseInit & { body?: string } = {},
  options: { forwardedHeaders?: boolean } = {},
) {
  const fetchFn = vi.fn(async (_request: Request) => {
    const { body, ...init } = responseInit;
    return new Response(body ?? "ok", init);
  });
  const handler = createProxyHandler({
    backendUrl: "https://api.internal",
    fetchFn,
    ...options,
  });
  return { handler, fetchFn, forwarded: () => fetchFn.mock.calls[0]?.[0] as Request };
}

describe("createProxyHandler", () => {
  it("forwards path and query to the backend", async () => {
    const { handler, forwarded } = proxyWith();
    await handler(new Request("https://kaipu.app/api/v1/assets?limit=5"));
    expect(forwarded().url).toBe("https://api.internal/api/v1/assets?limit=5");
  });

  it("drops client-supplied address headers so only cf-connecting-ip reaches the API", async () => {
    const { handler, forwarded } = proxyWith();
    await handler(
      new Request("https://kaipu.app/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "x-forwarded-for": "1.2.3.4",
          "x-real-ip": "1.2.3.4",
          "cf-connecting-ip": "203.0.113.9",
        },
      }),
    );
    const headers = forwarded().headers;
    expect(headers.get("x-forwarded-for")).toBeNull();
    expect(headers.get("x-real-ip")).toBeNull();
    expect(headers.get("cf-connecting-ip")).toBe("203.0.113.9");
  });

  it("keeps the Origin, Sec-Fetch-Site and Cookie headers the CSRF check relies on", async () => {
    const { handler, forwarded } = proxyWith();
    await handler(
      new Request("https://kaipu.app/api/v1/assets", {
        method: "DELETE",
        headers: {
          origin: "https://kaipu.app",
          "sec-fetch-site": "same-origin",
          cookie: "better-auth.session_token=abc",
        },
      }),
    );
    const headers = forwarded().headers;
    expect(headers.get("origin")).toBe("https://kaipu.app");
    expect(headers.get("sec-fetch-site")).toBe("same-origin");
    expect(headers.get("cookie")).toBe("better-auth.session_token=abc");
    expect(forwarded().method).toBe("DELETE");
  });

  it("sets x-forwarded-host and x-forwarded-proto only when asked", async () => {
    const plain = proxyWith();
    await plain.handler(new Request("https://kaipu.app/api/v1/health"));
    expect(plain.forwarded().headers.get("x-forwarded-host")).toBeNull();

    const forwarding = proxyWith({}, { forwardedHeaders: true });
    await forwarding.handler(new Request("https://kaipu.app/api/auth/get-session"));
    expect(forwarding.forwarded().headers.get("x-forwarded-host")).toBe("kaipu.app");
    expect(forwarding.forwarded().headers.get("x-forwarded-proto")).toBe("https");
  });

  it("strips the bearer token header and the cookie domain from the response", async () => {
    const headers = new Headers({ "set-auth-token": "secret" });
    headers.append("set-cookie", "a=1; Domain=api.internal; Path=/; HttpOnly");
    headers.append("set-cookie", "b=2; Path=/");
    const { handler } = proxyWith({ headers });
    const response = await handler(new Request("https://kaipu.app/api/auth/sign-in/email"));
    expect(response.headers.get("set-auth-token")).toBeNull();
    expect(response.headers.getSetCookie()).toEqual(["a=1; Path=/; HttpOnly", "b=2; Path=/"]);
  });

  it("answers 500 when the backend fetch throws", async () => {
    const handler = createProxyHandler({
      backendUrl: "https://api.internal",
      fetchFn: async () => {
        throw new Error("binding down");
      },
    });
    const response = await handler(new Request("https://kaipu.app/api/v1/health"));
    expect(response.status).toBe(500);
  });
});
