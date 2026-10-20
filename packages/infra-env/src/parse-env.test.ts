import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseEnv } from "./parse-env";
import { commaSeparatedList } from "./transforms";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PUBLIC_URL: z.url(),
  ORIGINS: commaSeparatedList,
});

describe("parseEnv", () => {
  it("returns the parsed values, transforms included", () => {
    const env = parseEnv(schema, {
      DATABASE_URL: "postgres://local",
      PUBLIC_URL: "http://localhost:3001",
      ORIGINS: "a,b",
    });

    expect(env.ORIGINS).toEqual(["a", "b"]);
  });

  it("names every invalid variable and points to bun env:pull", () => {
    expect(() => parseEnv(schema, { ORIGINS: "a" })).toThrow(
      /DATABASE_URL[\s\S]*PUBLIC_URL[\s\S]*bun env:pull/,
    );
  });

  it("never echoes a value into the error", () => {
    const leaked = "not a url but a secret: hunter2";

    expect(() => parseEnv(schema, { DATABASE_URL: "x", PUBLIC_URL: leaked, ORIGINS: "a" })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("hunter2") }),
    );
  });
});
