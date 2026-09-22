import { describe, expect, it } from "vitest";
import { initialScene } from "../scene";
import { addRedaction, removeRedaction, updateRedaction } from "./redaction-edits";

const RECT = { x: 0.1, y: 0.1, w: 0.2, h: 0.1 };

describe("redaction edits", () => {
  it("adds a blur with safe defaults", () => {
    const { scene, id } = addRedaction(initialScene(10), "blur", RECT, { start: 1, end: 6 });
    expect(scene.redactions).toEqual([
      { id, kind: "blur", start: 1, end: 6, rect: RECT, intensity: 70, style: "gaussian" },
    ]);
  });
  it("adds a plain cover", () => {
    const { scene } = addRedaction(initialScene(10), "cover", RECT, { start: 1, end: 6 });
    expect(scene.redactions[0]).toMatchObject({ kind: "cover", fill: "#18181b", label: "" });
  });
  it("never lets intensity drop below the minimum", () => {
    const { scene, id } = addRedaction(initialScene(10), "blur", RECT, { start: 1, end: 6 });
    const next = updateRedaction(scene, id, { intensity: 10 });
    expect(next.redactions[0]).toMatchObject({ intensity: 40 });
  });
  it("removes", () => {
    const { scene, id } = addRedaction(initialScene(10), "cover", RECT, { start: 1, end: 6 });
    expect(removeRedaction(scene, id).redactions).toEqual([]);
  });
});
