import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchVersionGateConfig } from "./fetch-version-gate-config";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(impl: () => Promise<Response>): void {
  vi.stubGlobal("fetch", vi.fn(impl));
}

describe("fetchVersionGateConfig", () => {
  it("returns a parsed config on 200 + valid JSON", async () => {
    stubFetch(
      async () =>
        new Response(JSON.stringify({ minVersion: "1.0.0", latestVersion: "1.2.0" }), {
          status: 200,
        }),
    );
    expect(await fetchVersionGateConfig("https://x.test/v.json")).toEqual({
      minVersion: "1.0.0",
      latestVersion: "1.2.0",
    });
  });

  it("returns null on a non-2xx response", async () => {
    stubFetch(async () => new Response("", { status: 500 }));
    expect(await fetchVersionGateConfig("https://x.test/v.json")).toBeNull();
  });

  it("returns null when fetch throws (offline)", async () => {
    stubFetch(async () => {
      throw new Error("offline");
    });
    expect(await fetchVersionGateConfig("https://x.test/v.json")).toBeNull();
  });

  it("returns null on malformed JSON", async () => {
    stubFetch(async () => new Response("{ not json", { status: 200 }));
    expect(await fetchVersionGateConfig("https://x.test/v.json")).toBeNull();
  });

  it("returns null on JSON that fails validation", async () => {
    stubFetch(async () => new Response(JSON.stringify({ minVersion: 1 }), { status: 200 }));
    expect(await fetchVersionGateConfig("https://x.test/v.json")).toBeNull();
  });
});
