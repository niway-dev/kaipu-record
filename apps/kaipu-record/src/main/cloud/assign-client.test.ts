import { afterEach, describe, expect, it, vi } from "vitest";
import { assignAssetWorkspace } from "./assign-client";

const config = { serverUrl: "http://api.test" };

describe("assignAssetWorkspace", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("PUTs { workspaceId } with the bearer token and answers ok on 2xx", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await assignAssetWorkspace(config, "tok", "a1", "ws-1")).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://api.test/api/v1/assets/a1/workspace");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ workspaceId: "ws-1" });
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok");
  });

  it("sends null to unassign", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await assignAssetWorkspace(config, "tok", "a1", null);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ workspaceId: null });
  });

  it("a JSON NOT_FOUND is a missing asset; Hono's plain 404 and a 405 are a server without the route", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: "NOT_FOUND", message: "Asset not found" }), {
            status: 404,
          }),
      ),
    );
    expect(await assignAssetWorkspace(config, "t", "a", "w")).toBe("not-found");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("404 Not Found", { status: 404 })),
    );
    expect(await assignAssetWorkspace(config, "t", "a", "w")).toBe("unsupported");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 405 })),
    );
    expect(await assignAssetWorkspace(config, "t", "a", "w")).toBe("unsupported");
  });

  it("401 is unauthorized; 5xx and a network error are retried", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 401 })),
    );
    expect(await assignAssetWorkspace(config, "t", "a", "w")).toBe("unauthorized");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 503 })),
    );
    expect(await assignAssetWorkspace(config, "t", "a", "w")).toBe("retry");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    expect(await assignAssetWorkspace(config, "t", "a", "w")).toBe("retry");
  });
});
