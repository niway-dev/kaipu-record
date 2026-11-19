import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TranscriptionModelInfo } from "@shared/types/transcription";
import { TranscriptionStep } from "./transcription-step";

const MODEL: TranscriptionModelInfo = {
  id: "parakeet-tdt-0.6b-v3-int8",
  label: "Parakeet TDT 0.6B v3",
  languages: ["en", "es"],
  sizeBytes: 640_000_000,
  location: "/Users/me/Library/Application Support/Kaipu/models/parakeet",
  license: {
    name: "CC-BY-4.0",
    attribution: "Parakeet TDT 0.6B v3 by NVIDIA, licensed CC-BY-4.0.",
    url: "https://creativecommons.org/licenses/by/4.0/",
  },
  status: { state: "missing" },
};

function setup(onDownload: () => Promise<void> = () => Promise.resolve()) {
  const props = { onDownload: vi.fn(onDownload), onAdvance: vi.fn() };
  render(<TranscriptionStep model={MODEL} {...props} />);
  return props;
}

describe("TranscriptionStep", () => {
  it("says what it does and shows the model, its size, the install folder and the credit", () => {
    setup();
    expect(screen.getByRole("heading", { name: /turn recordings into text/i })).toBeInTheDocument();
    expect(screen.getByText(/on this mac/i, { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("Parakeet TDT 0.6B v3")).toBeInTheDocument();
    expect(screen.getByText("640 MB")).toBeInTheDocument();
    expect(screen.getByText(MODEL.location)).toBeInTheDocument();
    expect(screen.getByText(/licensed CC-BY-4.0/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /CC-BY-4.0/ })).toHaveAttribute(
      "href",
      MODEL.license.url,
    );
  });

  it("Download in background starts the download once and moves on", () => {
    const { onDownload, onAdvance } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Download in background" }));
    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it("does not wait for the download: a download that never ends still moves on", () => {
    const { onAdvance } = setup(() => new Promise<void>(() => {}));
    fireEvent.click(screen.getByRole("button", { name: "Download in background" }));
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it("shows nothing when the start of the download fails, and still moves on", async () => {
    const { onAdvance } = setup(() => Promise.reject(new Error("ipc down")));
    fireEvent.click(screen.getByRole("button", { name: "Download in background" }));
    await Promise.resolve();
    expect(onAdvance).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Not now moves on and never downloads", () => {
    const { onDownload, onAdvance } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(onAdvance).toHaveBeenCalledTimes(1);
    expect(onDownload).not.toHaveBeenCalled();
  });

  it("takes one choice per visit, so a second click does nothing", () => {
    const { onDownload, onAdvance } = setup();
    const button = screen.getByRole("button", { name: "Download in background" });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });
});
