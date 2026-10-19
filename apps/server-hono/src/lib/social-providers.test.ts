import { serverEnvSchema } from "@kaipu/infra-env";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildSocialProviders,
  getSocialProviders,
  resetSocialProvidersWarning,
} from "./social-providers";

// Illustrative placeholders, not real credentials.
const ID = "test-client-id";
const SECRET = "test-client-secret";

describe("buildSocialProviders", () => {
  it("returns {} when neither Google variable is set", () => {
    expect(buildSocialProviders({})).toEqual({});
  });

  it("returns {} when only the client id is set", () => {
    expect(buildSocialProviders({ GOOGLE_CLIENT_ID: ID })).toEqual({});
  });

  it("returns {} when only the client secret is set", () => {
    expect(buildSocialProviders({ GOOGLE_CLIENT_SECRET: SECRET })).toEqual({});
  });

  it("treats empty strings as missing", () => {
    expect(buildSocialProviders({ GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: SECRET })).toEqual(
      {},
    );
  });

  it("returns the google block with select_account when both are set", () => {
    expect(buildSocialProviders({ GOOGLE_CLIENT_ID: ID, GOOGLE_CLIENT_SECRET: SECRET })).toEqual({
      google: {
        clientId: ID,
        clientSecret: SECRET,
        prompt: "select_account",
        disableIdTokenSignIn: true,
      },
    });
  });
});

describe("getSocialProviders warning", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetSocialProvidersWarning();
  });

  it("warns once per isolate when Google is not configured", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    getSocialProviders({});
    getSocialProviders({ GOOGLE_CLIENT_ID: ID });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("does not warn when Google is configured", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    getSocialProviders({ GOOGLE_CLIENT_ID: ID, GOOGLE_CLIENT_SECRET: SECRET });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("serverEnvSchema auth variables", () => {
  const base = {
    DATABASE_URL: "postgres://example",
    CORS_ORIGIN: "http://localhost:3001",
    BETTER_AUTH_SECRET: "x",
  };

  it("accepts the config without any Google or BETTER_AUTH_URL value", () => {
    const parsed = serverEnvSchema.parse(base);
    expect(parsed.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(parsed.GOOGLE_CLIENT_SECRET).toBeUndefined();
    expect(parsed.BETTER_AUTH_URL).toBeUndefined();
  });

  it("accepts the Google values and the web origin", () => {
    const parsed = serverEnvSchema.parse({
      ...base,
      GOOGLE_CLIENT_ID: ID,
      GOOGLE_CLIENT_SECRET: SECRET,
      BETTER_AUTH_URL: "http://localhost:3001",
    });
    expect(parsed.GOOGLE_CLIENT_ID).toBe(ID);
    expect(parsed.BETTER_AUTH_URL).toBe("http://localhost:3001");
  });

  it("rejects BETTER_AUTH_URL that is not a URL", () => {
    expect(() => serverEnvSchema.parse({ ...base, BETTER_AUTH_URL: "kaipu.app" })).toThrow();
  });

  it("rejects BETTER_AUTH_URL with a trailing slash", () => {
    expect(() =>
      serverEnvSchema.parse({ ...base, BETTER_AUTH_URL: "https://kaipu.app/" }),
    ).toThrow();
  });
});
