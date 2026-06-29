import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useAppVersion } from "./use-app-version";

describe("useAppVersion", () => {
  it("reads the version from the main process", async () => {
    window.electronAPI.getAppVersion = async () => "0.1.0";
    const { result } = renderHook(() => useAppVersion());
    await waitFor(() => expect(result.current).toBe("0.1.0"));
  });
});
