import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useVaultDirectory } from "./use-vault-directory";

describe("useVaultDirectory", () => {
  it("loads the current directory on mount", async () => {
    window.electronAPI.getVaultDirectory = vi.fn(async () => ({
      path: "/Movies/Kaipu Record",
      isCustom: false,
    }));

    const { result } = renderHook(() => useVaultDirectory());
    await waitFor(() => expect(result.current.directory).not.toBeNull());
    expect(result.current.directory).toEqual({ path: "/Movies/Kaipu Record", isCustom: false });
  });

  it("updates the directory after the user picks a folder", async () => {
    window.electronAPI.getVaultDirectory = vi.fn(async () => ({
      path: "/default",
      isCustom: false,
    }));
    window.electronAPI.chooseVaultDirectory = vi.fn(async () => ({
      path: "/custom",
      isCustom: true,
    }));

    const { result } = renderHook(() => useVaultDirectory());
    await waitFor(() => expect(result.current.directory?.path).toBe("/default"));

    await act(async () => {
      await result.current.choose();
    });
    expect(result.current.directory).toEqual({ path: "/custom", isCustom: true });
  });

  it("keeps the current directory when the picker is cancelled", async () => {
    window.electronAPI.getVaultDirectory = vi.fn(async () => ({
      path: "/default",
      isCustom: false,
    }));
    window.electronAPI.chooseVaultDirectory = vi.fn(async () => null);

    const { result } = renderHook(() => useVaultDirectory());
    await waitFor(() => expect(result.current.directory?.path).toBe("/default"));

    await act(async () => {
      await result.current.choose();
    });
    expect(result.current.directory?.path).toBe("/default");
  });

  it("resets back to the default folder", async () => {
    window.electronAPI.getVaultDirectory = vi.fn(async () => ({ path: "/custom", isCustom: true }));
    window.electronAPI.resetVaultDirectory = vi.fn(async () => ({
      path: "/default",
      isCustom: false,
    }));

    const { result } = renderHook(() => useVaultDirectory());
    await waitFor(() => expect(result.current.directory?.isCustom).toBe(true));

    await act(async () => {
      await result.current.reset();
    });
    expect(result.current.directory).toEqual({ path: "/default", isCustom: false });
  });
});
