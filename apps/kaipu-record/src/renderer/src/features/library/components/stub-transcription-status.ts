import { vi } from "vitest";

/**
 * Stubs `window.electronAPI.getTranscriptionStatus` with one default model in the given state,
 * for the Library card and row tests. Returns the spy; the caller restores `window.electronAPI`.
 */
const realElectronApi = window.electronAPI;
export function stubTranscriptionStatus(modelState: "ready" | "missing"): ReturnType<typeof vi.fn> {
  const getTranscriptionStatus = vi.fn(async () => ({
    availability: { status: "available" as const },
    defaultModelId: "m",
    models: [
      {
        id: "m",
        label: "Parakeet",
        languages: ["en"],
        sizeBytes: 1,
        location: "/m",
        license: { name: "l", attribution: "a", url: "u" },
        status: { state: modelState },
      },
    ],
    job: null,
  }));
  window.electronAPI = { ...realElectronApi, getTranscriptionStatus };
  return getTranscriptionStatus;
}
