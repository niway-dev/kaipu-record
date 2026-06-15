import { describe, expect, it } from "vitest";
import type { PermissionStatus } from "@shared/types";
import { requiredPermissionsMet } from "./permissions";

const status = (over: Partial<PermissionStatus>): PermissionStatus => ({
  screen: false,
  microphone: false,
  camera: false,
  ...over,
});

describe("requiredPermissionsMet", () => {
  it("is false when nothing is granted", () => {
    expect(requiredPermissionsMet(status({}))).toBe(false);
  });

  it("is false when only one required permission is granted", () => {
    expect(requiredPermissionsMet(status({ screen: true }))).toBe(false);
    expect(requiredPermissionsMet(status({ microphone: true }))).toBe(false);
  });

  it("ignores the optional camera permission", () => {
    expect(requiredPermissionsMet(status({ camera: true }))).toBe(false);
  });

  it("is true once screen and microphone are granted", () => {
    expect(requiredPermissionsMet(status({ screen: true, microphone: true }))).toBe(true);
  });
});
