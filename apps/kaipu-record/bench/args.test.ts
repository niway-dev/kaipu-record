import { describe, expect, it } from "vitest";
import { parseAttachArgs } from "./args";

describe("parseAttachArgs", () => {
  it("has defaults", () => {
    const a = parseAttachArgs([], "/home/u");
    expect(a).toMatchObject({
      machine: "local",
      watch: "/home/u/Movies/Kaipu Record/.kaipu/tmp",
      duration: null,
    });
  });
  it("reads flags", () => {
    const a = parseAttachArgs(
      [
        "--machine",
        "owner-M5",
        "--watch-file",
        "/x/*.part",
        "--duration",
        "10",
        "--match",
        "/repo/",
        "--out",
        "/o",
        "--no-watch",
      ],
      "/h",
    );
    expect(a).toMatchObject({
      machine: "owner-M5",
      watch: null,
      duration: 10,
      match: "/repo/",
      out: "/o",
    });
  });
  it("accepts --flag=value and rejects unknown flags", () => {
    expect(parseAttachArgs(["--machine=a"], "/h")).toMatchObject({ machine: "a" });
    expect(parseAttachArgs(["--nope"], "/h")).toEqual({ error: "Unknown option --nope" });
  });
  it("rejects a bad duration and unsafe machine labels", () => {
    expect(parseAttachArgs(["--duration", "x"], "/h")).toHaveProperty("error");
    expect(parseAttachArgs(["--machine", "a/b"], "/h")).toHaveProperty("error");
  });
});
