import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_ID, getModel, listModels } from "./catalog";

const REQUIRED_FILES = ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"];

describe("speech model catalog", () => {
  it("lists the two Parakeet models", () => {
    expect(listModels().map((m) => m.id)).toEqual([
      "parakeet-tdt-0.6b-v3-int8",
      "parakeet-tdt-0.6b-v2-int8",
    ]);
  });

  it("has unique ids", () => {
    const ids = listModels().map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has a default model that exists", () => {
    expect(DEFAULT_MODEL_ID).toBe("parakeet-tdt-0.6b-v3-int8");
    expect(getModel(DEFAULT_MODEL_ID)?.id).toBe(DEFAULT_MODEL_ID);
  });

  it("returns undefined for an unknown id", () => {
    expect(getModel("nope")).toBeUndefined();
  });

  for (const model of listModels()) {
    describe(model.id, () => {
      it("has all four files", () => {
        expect(model.files.map((f) => f.name).toSorted()).toEqual([...REQUIRED_FILES].toSorted());
      });

      it("has a sizeBytes equal to the sum of its files", () => {
        expect(model.sizeBytes).toBe(model.files.reduce((sum, f) => sum + f.sizeBytes, 0));
      });

      it("has a lowercase 64-hex sha256 on every file", () => {
        for (const file of model.files) expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      });

      it("points every file at https and at the pinned revision", () => {
        expect(model.revision).toMatch(/^[0-9a-f]{40}$/);
        for (const file of model.files) {
          expect(file.url.startsWith("https://")).toBe(true);
          expect(file.url).toContain(model.revision);
          expect(file.url.endsWith(`/${file.name}`)).toBe(true);
        }
      });

      it("carries the CC-BY-4.0 attribution", () => {
        expect(model.license.name).toBe("CC-BY-4.0");
        expect(model.license.attribution).toContain("NVIDIA");
        expect(model.license.url.startsWith("https://")).toBe(true);
      });

      it("uses the transducer engine and has languages", () => {
        expect(model.engine).toBe("sherpa-onnx-transducer");
        expect(model.languages.length).toBeGreaterThan(0);
        expect(model.capabilities.wordTimestamps).toBe(true);
      });
    });
  }

  it("lists 25 languages for v3 and English only for v2", () => {
    expect(getModel("parakeet-tdt-0.6b-v3-int8")?.languages).toHaveLength(25);
    expect(getModel("parakeet-tdt-0.6b-v2-int8")?.languages).toEqual(["en"]);
  });
});
