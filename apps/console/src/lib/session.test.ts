import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  headers: new Headers(),
  fetch: vi.fn(),
  config: { adminIds: "owner", apiUrl: "https://api.invalid", environment: "Test" },
  responseHeader: vi.fn(),
}));
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () => mocks.headers,
  setResponseHeader: mocks.responseHeader,
}));
vi.mock("./backend.server", () => ({ apiFetch: mocks.fetch, consoleConfig: () => mocks.config }));
import { requireConsoleAdmin } from "./session.server";
describe("console server authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.headers = new Headers();
    mocks.config.adminIds = "owner";
  });
  it("denies anonymous requests before calling the backend", async () => {
    expect(await requireConsoleAdmin()).toEqual({ status: "unauthorized" });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.responseHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
  });
  it("fails closed when no operator is configured", async () => {
    mocks.config.adminIds = "";
    mocks.headers.set("cookie", "session=test");
    expect(await requireConsoleAdmin()).toEqual({ status: "forbidden" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("rejects ordinary authenticated users", async () => {
    mocks.headers.set("cookie", "session=test");
    mocks.fetch.mockResolvedValue(Response.json({ user: { id: "someone-else" } }));
    expect(await requireConsoleAdmin()).toEqual({ status: "forbidden" });
  });
  it("requires a live session, even for a previously authorized browser", async () => {
    mocks.headers.set("cookie", "session=test");
    mocks.fetch.mockResolvedValue(Response.json(null));
    expect(await requireConsoleAdmin()).toEqual({ status: "unauthorized" });
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://api.invalid/api/auth/get-session?disableCookieCache=true",
      { headers: { cookie: "session=test" } },
    );
  });
  it("allows the configured user ID", async () => {
    mocks.headers.set("cookie", "session=test");
    mocks.fetch.mockResolvedValue(Response.json({ user: { id: "owner", name: "Owner" } }));
    expect(await requireConsoleAdmin()).toEqual({
      status: "authorized",
      name: "Owner",
      environment: "Test",
    });
  });
  it("does not turn a backend outage into successful authorization", async () => {
    mocks.headers.set("cookie", "session=test");
    mocks.fetch.mockResolvedValue(new Response(null, { status: 503 }));
    await expect(requireConsoleAdmin()).rejects.toThrow("Authentication service unavailable");
  });
});
