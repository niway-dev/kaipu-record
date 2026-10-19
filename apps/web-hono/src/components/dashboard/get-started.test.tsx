import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/render";
import { downloadUrls } from "@/lib/download";
import { GetStarted, downloadsFor } from "./get-started";

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130.0 Safari/537.36";
const WINDOWS_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36";
const LINUX_UA = "Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function withUserAgent(userAgent: string) {
  vi.stubGlobal("navigator", { userAgent });
}

describe("downloadsFor", () => {
  it("puts the detected OS first and lists the rest", () => {
    expect(downloadsFor("mac").primary?.href).toBe(downloadUrls.macArm64);
    expect(downloadsFor("mac").others.map((d) => d.href)).toEqual([
      downloadUrls.macX64,
      downloadUrls.windowsX64,
    ]);
    expect(downloadsFor("windows").primary?.href).toBe(downloadUrls.windowsX64);
  });

  it("has no primary button when the OS is unknown, and lists every installer", () => {
    const { primary, others } = downloadsFor("other");
    expect(primary).toBeNull();
    expect(others.map((d) => d.href)).toEqual([
      downloadUrls.macArm64,
      downloadUrls.macX64,
      downloadUrls.windowsX64,
    ]);
  });
});

describe("GetStarted", () => {
  it("offers the macOS installer as the primary button on a Mac", async () => {
    withUserAgent(MAC_UA);
    renderWithProviders(<GetStarted />);
    const button = await screen.findByRole("link", { name: "Download for macOS" });
    expect(button.getAttribute("href")).toBe(downloadUrls.macArm64);
    expect(screen.getByRole("link", { name: "macOS (Intel)" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Windows (beta)" })).toBeTruthy();
  });

  it("offers the Windows installer as the primary button on Windows", async () => {
    withUserAgent(WINDOWS_UA);
    renderWithProviders(<GetStarted />);
    const button = await screen.findByRole("link", { name: "Download for Windows (beta)" });
    expect(button.getAttribute("href")).toBe(downloadUrls.windowsX64);
    expect(screen.getByRole("link", { name: "macOS (Apple silicon)" })).toBeTruthy();
  });

  it("falls back to plain links for both systems elsewhere", () => {
    withUserAgent(LINUX_UA);
    renderWithProviders(<GetStarted />);
    expect(screen.queryByRole("link", { name: /^Download for/ })).toBeNull();
    expect(screen.getByRole("link", { name: "macOS (Apple silicon)" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "macOS (Intel)" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Windows (beta)" })).toBeTruthy();
  });

  it("says how to upload from the desktop app", () => {
    withUserAgent(LINUX_UA);
    renderWithProviders(<GetStarted />);
    expect(screen.getByText(/choose manual or automatic upload/)).toBeTruthy();
  });
});
