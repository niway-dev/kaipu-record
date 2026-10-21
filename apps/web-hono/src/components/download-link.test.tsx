import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const track = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analytics")>()),
  track,
}));

import { downloadUrls } from "@/lib/download";
import { DownloadLink } from "./download-link";

afterEach(() => {
  cleanup();
  track.mockReset();
});

describe("DownloadLink", () => {
  it("reports platform and placement, and keeps the href so the browser still downloads", () => {
    render(
      <DownloadLink href={downloadUrls.windowsX64} placement="sticky">
        Windows
      </DownloadLink>,
    );
    const link = screen.getByRole("link", { name: "Windows" });
    expect(link.getAttribute("href")).toBe(downloadUrls.windowsX64);
    // The handler must not cancel the default action (the download). The document listener also
    // cancels it afterwards so jsdom does not try to navigate.
    let cancelledByHandler = true;
    const swallow = (event: Event) => {
      cancelledByHandler = event.defaultPrevented;
      event.preventDefault();
    };
    document.addEventListener("click", swallow);
    fireEvent.click(link);
    document.removeEventListener("click", swallow);
    expect(cancelledByHandler).toBe(false);
    expect(track).toHaveBeenCalledWith("download_clicked", {
      platform: "windows",
      placement: "sticky",
    });
  });

  it("stays quiet for a link that is not one of our installers", () => {
    render(
      <DownloadLink href="#download" placement="hero">
        Mail me
      </DownloadLink>,
    );
    const swallow = (event: Event) => event.preventDefault();
    document.addEventListener("click", swallow);
    fireEvent.click(screen.getByRole("link"));
    document.removeEventListener("click", swallow);
    expect(track).not.toHaveBeenCalled();
  });
});
