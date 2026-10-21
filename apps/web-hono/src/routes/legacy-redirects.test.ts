import { describe, expect, it } from "vitest";
import { isRedirect } from "@tanstack/react-router";

import { Route as AccountRoute } from "./account";
import { Route as RecordingsRoute } from "./recordings";
import { Route as LoginRoute } from "./auth/login";
import { Route as SignupRoute } from "./auth/signup";

type BeforeLoad = (ctx: never) => unknown;

async function thrown(beforeLoad: BeforeLoad | undefined, ctx: object) {
  try {
    await beforeLoad?.(ctx as never);
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("legacy paths", () => {
  it("/account redirects to the profile page", async () => {
    const error = await thrown(AccountRoute.options.beforeLoad as BeforeLoad, {});
    expect(isRedirect(error)).toBe(true);
    expect((error as { options: { to: string } }).options.to).toBe("/dashboard/profile");
  });

  it("/recordings redirects to the dashboard recordings page", async () => {
    const error = await thrown(RecordingsRoute.options.beforeLoad as BeforeLoad, {});
    expect(isRedirect(error)).toBe(true);
    expect((error as { options: { to: string } }).options.to).toBe("/dashboard/recordings");
  });
});

describe("already signed in on /auth/*", () => {
  const signedIn = { context: { isAuthenticated: true } };

  it("login goes to the dashboard, or to a valid redirect", async () => {
    const before = LoginRoute.options.beforeLoad as BeforeLoad;
    const plain = await thrown(before, { ...signedIn, search: {} });
    expect((plain as { options: { href: string } }).options.href).toBe("/dashboard");
    const custom = await thrown(before, {
      ...signedIn,
      search: { redirect: "/dashboard/settings" },
    });
    expect((custom as { options: { href: string } }).options.href).toBe("/dashboard/settings");
  });

  it("signup goes to the dashboard, and ignores an evil redirect", async () => {
    const before = SignupRoute.options.beforeLoad as BeforeLoad;
    const plain = await thrown(before, { ...signedIn, search: {} });
    expect((plain as { options: { href: string } }).options.href).toBe("/dashboard");
    const evil = await thrown(before, { ...signedIn, search: { redirect: "//evil.example" } });
    expect((evil as { options: { href: string } }).options.href).toBe("/dashboard");
  });

  it("a signed-out visitor stays on the page", async () => {
    const ctx = { context: { isAuthenticated: false }, search: {} };
    expect(await thrown(LoginRoute.options.beforeLoad as BeforeLoad, ctx)).toBeUndefined();
    expect(await thrown(SignupRoute.options.beforeLoad as BeforeLoad, ctx)).toBeUndefined();
  });
});
