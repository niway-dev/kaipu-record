import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/render";
import { downloadUrls } from "@/lib/download";

import { GetStarted } from "./get-started";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const href = (name: RegExp) => screen.getByRole("link", { name }).getAttribute("href");

describe("GetStarted", () => {
  it("shows every download equally when the OS is unknown", () => {
    renderWithProviders(<GetStarted os="other" />);
    expect(href(/Mac \(Apple Silicon\)/)).toBe(downloadUrls.macArm64);
    expect(href(/Mac \(Intel\)/)).toBe(downloadUrls.macX64);
    expect(href(/Windows \(beta\)/)).toBe(downloadUrls.windowsX64);
  });

  it("features the Mac installer on a Mac and offers the others as links", () => {
    renderWithProviders(<GetStarted os="mac" />);
    expect(href(/Download for Mac \(Apple Silicon\)/)).toBe(downloadUrls.macArm64);
    expect(href(/Mac \(Intel\)/)).toBe(downloadUrls.macX64);
    expect(href(/Windows \(beta\)/)).toBe(downloadUrls.windowsX64);
  });

  it("features the Windows installer on Windows", () => {
    renderWithProviders(<GetStarted os="windows" />);
    expect(href(/Download for Windows \(beta\)/)).toBe(downloadUrls.windowsX64);
    expect(screen.queryByRole("link", { name: "Download for Mac (Apple Silicon)" })).toBeNull();
    expect(href(/^Mac \(Apple Silicon\)$/)).toBe(downloadUrls.macArm64);
  });

  it("detects the OS from the browser after mount", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      maxTouchPoints: 0,
    });
    renderWithProviders(<GetStarted />);
    expect(href(/Download for Windows \(beta\)/)).toBe(downloadUrls.windowsX64);
  });
});
