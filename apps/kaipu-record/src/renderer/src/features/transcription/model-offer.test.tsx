import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  TranscriptionAvailability,
  TranscriptionModelInfo,
} from "@shared/types/transcription";
import type { ModelDownloadFailure } from "./use-transcription-status";
import { ModelOffer } from "./model-offer";

const AVAILABLE: TranscriptionAvailability = { status: "available" };

function model(status: TranscriptionModelInfo["status"]): TranscriptionModelInfo {
  return {
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
    status,
  };
}

function setup(
  status: TranscriptionModelInfo["status"],
  over: {
    availability?: TranscriptionAvailability;
    failure?: ModelDownloadFailure;
    model?: TranscriptionModelInfo | null;
  } = {},
) {
  const callbacks = { onDownload: vi.fn(), onCancel: vi.fn(), onRemove: vi.fn() };
  render(
    <ModelOffer
      model={over.model === undefined ? model(status) : over.model}
      availability={over.availability ?? AVAILABLE}
      failure={over.failure}
      {...callbacks}
    />,
  );
  return callbacks;
}

describe("ModelOffer", () => {
  describe("missing", () => {
    it("shows the model, its size, where it installs and the license credit", () => {
      setup({ state: "missing" });

      const offer = screen.getByTestId("model-offer");
      expect(offer).toHaveAttribute("data-state", "missing");
      expect(within(offer).getByText("Parakeet TDT 0.6B v3")).toBeInTheDocument();
      expect(within(offer).getByText("640 MB")).toBeInTheDocument();
      expect(
        within(offer).getByText("/Users/me/Library/Application Support/Kaipu/models/parakeet"),
      ).toBeInTheDocument();
      expect(
        within(offer).getByText("Parakeet TDT 0.6B v3 by NVIDIA, licensed CC-BY-4.0."),
      ).toBeInTheDocument();
      const link = within(offer).getByRole("link", { name: /CC-BY-4\.0/ });
      expect(link).toHaveAttribute("href", "https://creativecommons.org/licenses/by/4.0/");
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    });

    it("says the download happens once and recognition then runs offline", () => {
      setup({ state: "missing" });

      expect(screen.getByTestId("model-offer-note")).toHaveTextContent(/once/i);
      expect(screen.getByTestId("model-offer-note")).toHaveTextContent(/offline/i);
    });

    it("downloads when Download is pressed", () => {
      const { onDownload } = setup({ state: "missing" });

      fireEvent.click(screen.getByRole("button", { name: "Download" }));

      expect(onDownload).toHaveBeenCalledOnce();
    });
  });

  describe("downloading", () => {
    it("shows a progress bar with received and total, and the percent", () => {
      setup({ state: "downloading", receivedBytes: 160_000_000, totalBytes: 640_000_000 });

      expect(screen.getByTestId("model-offer")).toHaveAttribute("data-state", "downloading");
      const bar = screen.getByRole("progressbar");
      expect(bar).toHaveAttribute("aria-valuenow", "25");
      expect(bar).toHaveAttribute("aria-valuemin", "0");
      expect(bar).toHaveAttribute("aria-valuemax", "100");
      expect(screen.getByText("160 MB of 640 MB")).toBeInTheDocument();
      expect(screen.getByText("25%")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
    });

    it("reads 0% before the total is known", () => {
      setup({ state: "downloading", receivedBytes: 0, totalBytes: 0 });

      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    });

    it("cancels when Cancel is pressed", () => {
      const { onCancel } = setup({
        state: "downloading",
        receivedBytes: 1,
        totalBytes: 640_000_000,
      });

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(onCancel).toHaveBeenCalledOnce();
    });
  });

  describe("ready", () => {
    it("shows it as installed with its size and location", () => {
      setup({ state: "ready" });

      const offer = screen.getByTestId("model-offer");
      expect(offer).toHaveAttribute("data-state", "ready");
      expect(within(offer).getByText("Installed")).toBeInTheDocument();
      expect(within(offer).getByText("640 MB")).toBeInTheDocument();
      expect(within(offer).getByText(/Application Support\/Kaipu\/models/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
    });

    it("asks to confirm before removing, and removes only on the confirm", () => {
      const { onRemove } = setup({ state: "ready" });

      fireEvent.click(screen.getByRole("button", { name: "Remove" }));
      expect(onRemove).not.toHaveBeenCalled();
      expect(screen.getByTestId("model-offer-confirm")).toHaveTextContent("640 MB");

      fireEvent.click(screen.getByRole("button", { name: "Remove model" }));
      expect(onRemove).toHaveBeenCalledOnce();
    });

    it("keeps the model when the confirm is dismissed", () => {
      const { onRemove } = setup({ state: "ready" });

      fireEvent.click(screen.getByRole("button", { name: "Remove" }));
      fireEvent.click(screen.getByRole("button", { name: "Keep" }));

      expect(onRemove).not.toHaveBeenCalled();
      expect(screen.queryByTestId("model-offer-confirm")).toBeNull();
      expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
    });
  });

  describe("failed", () => {
    it.each<[ModelDownloadFailure, RegExp]>([
      ["network", /interrupted/i],
      ["hash-mismatch", /corrupt/i],
      ["size-mismatch", /corrupt/i],
      ["insufficient-disk-space", /not enough free disk space/i],
      ["engine-failed-to-start", /downloaded but does not start on this Mac/i],
      ["busy", /already running/i],
      ["unknown", /could not be downloaded/i],
    ])("explains a %s failure", (failure, message) => {
      setup({ state: "failed", reason: "raw message from main" }, { failure });

      expect(screen.getByTestId("model-offer")).toHaveAttribute("data-state", "failed");
      expect(screen.getByRole("alert")).toHaveTextContent(message);
    });

    it("explains an engine failure as main reports it, and offers to try again", () => {
      const { onDownload } = setup(
        { state: "failed", reason: "The downloaded speech engine did not pass its version check." },
        { failure: "engine-failed-to-start" },
      );

      expect(screen.getByRole("alert")).toHaveTextContent(
        "The speech engine downloaded but does not start on this Mac. Try again; if it keeps failing, this Mac may not support it yet.",
      );
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(onDownload).toHaveBeenCalledOnce();
    });

    it("names the space to free when the disk is full", () => {
      setup({ state: "failed", reason: "x" }, { failure: "insufficient-disk-space" });

      expect(screen.getByRole("alert")).toHaveTextContent("640 MB");
    });

    it("falls back to a generic message when only main's failed status is known", () => {
      setup({ state: "failed", reason: "raw message from main" });

      expect(screen.getByRole("alert")).toHaveTextContent(/could not be downloaded/i);
      expect(screen.getByRole("alert")).not.toHaveTextContent("raw message from main");
    });

    it("retries when Try again is pressed", () => {
      const { onDownload } = setup({ state: "failed", reason: "x" }, { failure: "network" });

      fireEvent.click(screen.getByRole("button", { name: "Try again" }));

      expect(onDownload).toHaveBeenCalledOnce();
    });
  });

  describe("unavailable", () => {
    it.each<[Extract<TranscriptionAvailability, { status: "unavailable" }>["reason"], RegExp]>([
      [
        "unsupported-platform",
        /Local transcription is not available on this Mac or this platform yet/,
      ],
      ["unreachable", /Local transcription is not responding\. Close and reopen Kaipu Record/],
    ])("explains %s and offers no download", (reason, message) => {
      setup({ state: "missing" }, { availability: { status: "unavailable", reason } });

      const offer = screen.getByTestId("model-offer");
      expect(offer).toHaveAttribute("data-state", "unavailable");
      expect(within(offer).getByText(message)).toBeInTheDocument();
      expect(screen.queryByRole("button")).toBeNull();
    });

    it("still renders when there is no catalog entry to describe", () => {
      setup(
        { state: "missing" },
        {
          model: null,
          availability: { status: "unavailable", reason: "unsupported-platform" },
        },
      );

      expect(screen.getByTestId("model-offer")).toHaveAttribute("data-state", "unavailable");
    });

    it("wins over the model's own state", () => {
      setup(
        { state: "ready" },
        { availability: { status: "unavailable", reason: "unsupported-platform" } },
      );

      expect(screen.getByTestId("model-offer")).toHaveAttribute("data-state", "unavailable");
    });
  });

  it("puts the catalog area on its root when it is given one", () => {
    render(
      <ModelOffer
        model={model({ state: "missing" })}
        availability={AVAILABLE}
        onDownload={vi.fn()}
        onCancel={vi.fn()}
        onRemove={vi.fn()}
        ui={{ "data-ui-area": "settingsTranscription.model" }}
      />,
    );

    expect(screen.getByTestId("model-offer")).toHaveAttribute(
      "data-ui-area",
      "settingsTranscription.model",
    );
  });
});
