import { describe, expect, it, vi } from "vitest";

vi.mock("./analytics-client", () => ({ captureException: vi.fn() }));
vi.mock("@renderer/ui/toast-store", () => ({ showToast: vi.fn(() => "toast-1") }));

import { captureException } from "./analytics-client";
import { showToast } from "@renderer/ui/toast-store";
import { reportError } from "./report-error";

describe("reportError", () => {
  it("fires both channels: technical capture + human-readable toast", () => {
    const error = new Error("disk full");
    reportError("No pudimos guardar la grabación.", error, { context: { sessionId: "s1" } });

    expect(captureException).toHaveBeenCalledWith(error, { sessionId: "s1" });
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: "No pudimos guardar la grabación." }),
    );
    // The user-facing toast must NEVER carry the stack/technical payload.
    const toastArg = vi.mocked(showToast).mock.calls[0][0];
    expect(JSON.stringify(toastArg)).not.toContain("disk full");
  });

  it("adds a Reintentar action when a retry is provided", () => {
    const retry = vi.fn();
    reportError("Falló", new Error("x"), { retry });
    const toastArg = vi.mocked(showToast).mock.calls.at(-1)![0];
    expect(toastArg.action?.label).toBe("Reintentar");
    toastArg.action?.onClick();
    expect(retry).toHaveBeenCalled();
  });
});
