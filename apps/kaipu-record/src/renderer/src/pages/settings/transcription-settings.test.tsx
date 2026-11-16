import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import type { TranscriptionModelInfo, TranscriptionStatus } from "@shared/types/transcription";
import { TranscriptionSettingsPage } from "./settings-pages";

const flags = vi.hoisted(() => ({ transcription: true }) as Record<string, boolean>);
vi.mock("@renderer/features/analytics/use-flag", () => ({
  useFlag: (name: string) => flags[name] ?? false,
}));

const DEFAULT_ID = "parakeet-tdt-0.6b-v3-int8";

function model(
  id: string,
  label: string,
  status: TranscriptionModelInfo["status"],
): TranscriptionModelInfo {
  return {
    id,
    label,
    languages: ["en"],
    sizeBytes: 640_000_000,
    location: `/models/${id}`,
    license: { name: "CC-BY-4.0", attribution: "Credit", url: "https://example.test/license" },
    status,
  };
}

function statusOf(models: TranscriptionModelInfo[]): TranscriptionStatus {
  return {
    availability: { status: "available" },
    defaultModelId: DEFAULT_ID,
    models,
    job: null,
  };
}

const realApi = window.electronAPI;

function renderPage(status: TranscriptionStatus, api: Partial<typeof window.electronAPI> = {}) {
  window.electronAPI = { ...realApi, getTranscriptionStatus: async () => status, ...api };
  const router = createMemoryRouter(
    [
      { path: "/settings/general", element: <p>general page</p> },
      { path: "/settings/transcription", element: <TranscriptionSettingsPage /> },
    ],
    { initialEntries: ["/settings/transcription"] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  flags.transcription = true;
});

afterEach(() => {
  window.electronAPI = realApi;
});

describe("Transcription settings page", () => {
  it("offers the default model's download with its size and location", async () => {
    const download = vi.fn(async () => ({ status: "cancelled" as const }));
    renderPage(statusOf([model(DEFAULT_ID, "Parakeet v3", { state: "missing" })]), {
      downloadTranscriptionModel: download,
    });

    expect(await screen.findByRole("heading", { level: 1, name: /Transcription/ })).toBeVisible();
    const offer = await screen.findByTestId("model-offer");
    expect(within(offer).getByText("Parakeet v3")).toBeInTheDocument();
    expect(within(offer).getByText("640 MB")).toBeInTheDocument();

    fireEvent.click(within(offer).getByRole("button", { name: "Download" }));

    expect(download).toHaveBeenCalledWith(DEFAULT_ID);
  });

  it("puts the default model first and shows every other catalog model as its own row", async () => {
    renderPage(
      statusOf([
        model("other", "Other model", { state: "missing" }),
        model(DEFAULT_ID, "Parakeet v3", { state: "ready" }),
      ]),
    );

    const offers = await screen.findAllByTestId("model-offer");
    expect(offers.map((offer) => within(offer).getByRole("heading").textContent)).toEqual([
      "Parakeet v3",
      "Other model",
    ]);
  });

  it("cancels a running download", async () => {
    const cancel = vi.fn(async () => {});
    renderPage(
      statusOf([
        model(DEFAULT_ID, "Parakeet v3", {
          state: "downloading",
          receivedBytes: 64_000_000,
          totalBytes: 640_000_000,
        }),
      ]),
      { cancelTranscriptionModelDownload: cancel },
    );

    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(cancel).toHaveBeenCalledWith(DEFAULT_ID);
  });

  it("removes an installed model only after the confirm", async () => {
    const remove = vi.fn(async () => {});
    renderPage(statusOf([model(DEFAULT_ID, "Parakeet v3", { state: "ready" })]), {
      removeTranscriptionModel: remove,
    });

    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove model" }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith(DEFAULT_ID));
  });

  it("says why when the engine cannot run, even with no model listed", async () => {
    renderPage({
      availability: { status: "unavailable", reason: "unsupported-platform" },
      defaultModelId: DEFAULT_ID,
      models: [],
      job: null,
    });

    const offer = await screen.findByTestId("model-offer");
    expect(offer).toHaveAttribute("data-state", "unavailable");
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
  });

  it("sends the page back to General with the flag off", async () => {
    flags.transcription = false;
    const router = renderPage(statusOf([model(DEFAULT_ID, "Parakeet v3", { state: "missing" })]));

    expect(await screen.findByText("general page")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/settings/general");
    expect(screen.queryByTestId("model-offer")).toBeNull();
  });
});
