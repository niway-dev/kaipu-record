import { describe, expect, it } from "vitest";
import { FINALIZE_ELSEWHERE_MARKER, FINALIZE_KEPT_MARKER } from "@shared/types/ipc";
import { finalizeErrorKey } from "./finalize-error-message";

describe("finalizeErrorKey", () => {
  it("maps the kept marker", () => {
    expect(
      finalizeErrorKey(new Error(`Error invoking remote method: ${FINALIZE_KEPT_MARKER} x`)),
    ).toBe("record.errorSaveKept");
  });

  it("maps the elsewhere marker", () => {
    expect(finalizeErrorKey(new Error(`${FINALIZE_ELSEWHERE_MARKER} x`))).toBe(
      "record.errorSaveElsewhere",
    );
  });

  it("falls back for any other error", () => {
    expect(finalizeErrorKey(new Error("ENOSPC"))).toBe("record.errorSave");
    expect(finalizeErrorKey("string")).toBe("record.errorSave");
  });
});
