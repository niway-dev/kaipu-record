import { describe, expect, it } from "vitest";
import { serverEnvSchema } from "./server";

const base = { DATABASE_URL: "postgres://local", CORS_ORIGIN: "a", BETTER_AUTH_SECRET: "s" };

describe("serverEnvSchema ADMIN_USER_IDS", () => {
  it("is valid when missing", () => {
    expect(serverEnvSchema.parse(base).ADMIN_USER_IDS).toBeUndefined();
  });

  it("is valid when empty", () => {
    expect(serverEnvSchema.parse({ ...base, ADMIN_USER_IDS: "" }).ADMIN_USER_IDS).toBe("");
  });

  it("keeps a comma-separated value as written", () => {
    expect(serverEnvSchema.parse({ ...base, ADMIN_USER_IDS: "u1, u2" }).ADMIN_USER_IDS).toBe(
      "u1, u2",
    );
  });
});
