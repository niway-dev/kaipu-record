import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useVersionGate } from "./use-version-gate";

const URL = "https://x.test/version-gate.json";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function stubFetch(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("useVersionGate", () => {
  it("is ok when no URL is set (fail-open / gate disabled)", () => {
    vi.stubEnv("VITE_VERSION_GATE_URL", "");
    const { result } = renderHook(() => useVersionGate());
    expect(result.current).toEqual({ kind: "ok" });
  });

  it("hard-blocks when the fetched minVersion is above the app version", async () => {
    vi.stubEnv("VITE_VERSION_GATE_URL", URL);
    window.electronAPI.getAppVersion = async () => "1.0.0";
    stubFetch({ minVersion: "2.0.0", latestVersion: "2.0.0" });
    const { result } = renderHook(() => useVersionGate());
    await waitFor(() => expect(result.current.kind).toBe("hard"));
  });

  it("does not re-fetch on focus within the throttle window", async () => {
    vi.stubEnv("VITE_VERSION_GATE_URL", URL);
    window.electronAPI.getAppVersion = async () => "1.0.0";
    const fetchFn = stubFetch({ minVersion: "1.0.0", latestVersion: "1.0.0" });
    renderHook(() => useVersionGate());
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
