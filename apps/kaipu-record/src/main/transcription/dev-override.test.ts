import { describe, expect, it } from "vitest";
import type { TranscriptionStatus } from "@shared/types/transcription";
import {
  applyTranscriptionOverride,
  parseTranscriptionOverride,
  resolveTranscriptionOverride,
} from "./dev-override";

describe("parseTranscriptionOverride", () => {
  it("reads the five states, with 42 percent as the default download", () => {
    expect(parseTranscriptionOverride("missing")).toEqual({ kind: "missing" });
    expect(parseTranscriptionOverride("ready")).toEqual({ kind: "ready" });
    expect(parseTranscriptionOverride("failed")).toEqual({ kind: "failed" });
    expect(parseTranscriptionOverride("unavailable")).toEqual({ kind: "unavailable" });
    expect(parseTranscriptionOverride("downloading")).toEqual({ kind: "downloading", percent: 42 });
  });

  it("reads downloading:<percent> from 1 to 99", () => {
    expect(parseTranscriptionOverride("downloading:1")).toEqual({
      kind: "downloading",
      percent: 1,
    });
    expect(parseTranscriptionOverride("downloading:70")).toEqual({
      kind: "downloading",
      percent: 70,
    });
    expect(parseTranscriptionOverride("downloading:99")).toEqual({
      kind: "downloading",
      percent: 99,
    });
  });

  it("ignores anything else", () => {
    for (const bad of [
      undefined,
      "",
      " ready",
      "Ready",
      "ready:1",
      "downloading:",
      "downloading:0",
      "downloading:100",
      "downloading:-5",
      "downloading:4.5",
      "downloading:abc",
      "downloading:123",
      "slow",
    ]) {
      expect(parseTranscriptionOverride(bad), String(bad)).toBeNull();
    }
  });
});

describe("resolveTranscriptionOverride", () => {
  it("honors the variable in an unpackaged build", () => {
    expect(resolveTranscriptionOverride("ready", { isPackaged: false })).toEqual({ kind: "ready" });
  });
  it("ignores it in a packaged app", () => {
    expect(resolveTranscriptionOverride("ready", { isPackaged: true })).toBeNull();
  });
  it("is no override for a bad value", () => {
    expect(resolveTranscriptionOverride("nope", { isPackaged: false })).toBeNull();
  });
});

const DEFAULT = {
  id: "default-model",
  label: "Real model label",
  languages: ["en", "es"],
  sizeBytes: 1000,
  location: "/real/models/default-model",
  license: { name: "CC-BY-4.0", attribution: "Credit", url: "https://example.test/license" },
  status: { state: "missing" as const },
};
const OTHER = {
  ...DEFAULT,
  id: "other-model",
  label: "Other",
  status: { state: "ready" as const },
};
const REAL: TranscriptionStatus = {
  availability: { status: "unavailable", reason: "engine-missing" },
  defaultModelId: "default-model",
  models: [DEFAULT, OTHER],
  job: null,
};

describe("applyTranscriptionOverride", () => {
  const modelOf = (status: TranscriptionStatus, id: string) =>
    status.models.find((m) => m.id === id)!;

  it("keeps the real catalog entry and touches only its status", () => {
    const out = applyTranscriptionOverride({ kind: "ready" }, REAL);
    const { status: _status, ...rest } = modelOf(out, "default-model");
    const { status: _real, ...realRest } = DEFAULT;
    expect(rest).toEqual(realRest);
    expect(modelOf(out, "other-model")).toEqual(OTHER);
    expect(out.defaultModelId).toBe("default-model");
    expect(out.job).toBeNull();
  });

  it("shows the engine available for every state but unavailable", () => {
    for (const kind of ["missing", "ready", "failed"] as const) {
      expect(applyTranscriptionOverride({ kind }, REAL).availability).toEqual({
        status: "available",
      });
    }
    expect(
      applyTranscriptionOverride({ kind: "downloading", percent: 42 }, REAL).availability,
    ).toEqual({ status: "available" });
  });

  it("maps each state to the model status", () => {
    const statusOf = (kind: Parameters<typeof applyTranscriptionOverride>[0]) =>
      modelOf(applyTranscriptionOverride(kind, REAL), "default-model").status;
    expect(statusOf({ kind: "missing" })).toEqual({ state: "missing" });
    expect(statusOf({ kind: "ready" })).toEqual({ state: "ready" });
    expect(statusOf({ kind: "failed" })).toEqual({ state: "failed", reason: expect.any(String) });
    expect(statusOf({ kind: "downloading", percent: 42 })).toEqual({
      state: "downloading",
      receivedBytes: 420,
      totalBytes: 1000,
    });
  });

  it("reports the engine unavailable on an unsupported platform", () => {
    const out = applyTranscriptionOverride({ kind: "unavailable" }, REAL);
    expect(out.availability).toEqual({ status: "unavailable", reason: "unsupported-platform" });
    expect(modelOf(out, "default-model").status).toEqual({ state: "missing" });
  });

  it("does not change the status it was given", () => {
    applyTranscriptionOverride({ kind: "ready" }, REAL);
    expect(DEFAULT.status).toEqual({ state: "missing" });
  });
});
