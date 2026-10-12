import { serverEnvSchema } from "@kaipu/infra-env";
import { describe, expect, it } from "vitest";

const base = { DATABASE_URL: "postgres://x", CORS_ORIGIN: "https://kaipu.app" };

describe("serverEnvSchema BETTER_AUTH_SECRET", () => {
  it("rejects a secret shorter than 32 characters", () => {
    expect(serverEnvSchema.safeParse({ ...base, BETTER_AUTH_SECRET: "short" }).success).toBe(false);
  });

  it("accepts a secret of at least 32 characters", () => {
    expect(serverEnvSchema.safeParse({ ...base, BETTER_AUTH_SECRET: "x".repeat(32) }).success).toBe(
      true,
    );
  });
});
