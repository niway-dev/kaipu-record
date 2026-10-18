import { describe, expect, it } from "vitest";
import { decideAfterCapture } from "./after-capture-policy";

describe("decideAfterCapture", () => {
  it.each([
    ["copy", "auto", "auto", { open: "quiet", save: true, copy: true }],
    ["copy", "auto", "manual", { open: "quiet", save: true, copy: true }],
    ["copy", "manual", "auto", { open: "quiet", save: false, copy: true }],
    ["copy", "manual", "manual", { open: "quiet", save: false, copy: true }],
    ["capture", "manual", "auto", { open: "editor" }],
    ["capture", "manual", "manual", { open: "editor" }],
    ["capture", "auto", "auto", { open: "quiet", save: true, copy: true }],
    ["capture", "auto", "manual", { open: "quiet", save: true, copy: false }],
  ] as const)("%s, save %s, copy %s", (action, save, copy, expected) => {
    expect(decideAfterCapture(action, save, copy)).toEqual(expected);
  });
});
