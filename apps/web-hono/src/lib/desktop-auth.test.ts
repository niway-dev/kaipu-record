import { describe, expect, it } from "vitest";

import {
  authTabHrefs,
  desktopAuthSearch,
  desktopCallbackUrl,
  desktopDonePath,
  parseCheckEmail,
  parseDesktopAuthQuery,
} from "./desktop-auth";

const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const valid = { client_id: "kaipu-desktop", state: "Ab12Cd34Ef56Gh78", code_challenge: CHALLENGE };

describe("parseDesktopAuthQuery", () => {
  it("accepts the query the desktop app sends", () => {
    expect(parseDesktopAuthQuery(valid)).toEqual(valid);
  });

  it("drops unrelated search params", () => {
    expect(parseDesktopAuthQuery({ ...valid, redirect: "/dashboard" })).toEqual(valid);
  });

  it.each([
    ["missing client_id", { ...valid, client_id: undefined }],
    ["another client_id", { ...valid, client_id: "electron" }],
    ["missing state", { ...valid, state: undefined }],
    ["empty state", { ...valid, state: "" }],
    ["state with markup", { ...valid, state: "<script>" }],
    ["missing challenge", { ...valid, code_challenge: undefined }],
    ["short challenge", { ...valid, code_challenge: "abc" }],
    ["plain-method challenge", { ...valid, code_challenge: `${CHALLENGE}=` }],
  ])("rejects %s", (_label, search) => {
    expect(parseDesktopAuthQuery(search)).toBeNull();
  });
});

describe("desktop paths", () => {
  it("round-trips the query through the search string", () => {
    const params = Object.fromEntries(new URLSearchParams(desktopAuthSearch(valid)));
    expect(parseDesktopAuthQuery(params)).toEqual(valid);
  });

  it("lands on the done page with the same query", () => {
    expect(desktopDonePath(valid)).toBe(
      `/auth/desktop/done?client_id=kaipu-desktop&state=Ab12Cd34Ef56Gh78&code_challenge=${CHALLENGE}`,
    );
  });

  it("marks an email sign-up on the done page, and reads the flag back", () => {
    const path = desktopDonePath(valid, { checkEmail: true });
    expect(path).toBe(`${desktopDonePath(valid)}&check_email=1`);
    const params = Object.fromEntries(new URLSearchParams(path.split("?")[1]));
    expect(parseCheckEmail(params.check_email)).toBe(true);
    expect(parseDesktopAuthQuery(params)).toEqual(valid);
    expect(parseCheckEmail(undefined)).toBe(false);
    expect(parseCheckEmail("yes")).toBe(false);
  });

  it("keeps the redirect on the web tabs", () => {
    expect(authTabHrefs({ redirect: "/dashboard/settings" })).toEqual({
      signIn: "/auth/login?redirect=%2Fdashboard%2Fsettings",
      signUp: "/auth/signup?redirect=%2Fdashboard%2Fsettings",
    });
    expect(authTabHrefs({})).toEqual({ signIn: "/auth/login", signUp: "/auth/signup" });
  });

  it("keeps the app's query on the desktop tabs, which are one route", () => {
    const { signIn, signUp } = authTabHrefs({ desktop: valid, redirect: "/ignored" });
    expect(signIn).toBe(`/auth/desktop${desktopAuthSearch(valid)}`);
    expect(signUp).toBe(`/auth/desktop${desktopAuthSearch(valid)}&intent=sign-up`);
    const params = Object.fromEntries(new URLSearchParams(signUp.split("?")[1]));
    expect(parseDesktopAuthQuery(params)).toEqual(valid);
    expect(params.intent).toBe("sign-up");
  });

  it("builds the deep link the way ensureElectronRedirect does", () => {
    // electronProxyClient: `${scheme}:/${callbackPath}#token=${cookie value}`
    expect(desktopCallbackUrl("eyJpZCI6IngifQ")).toBe("kaipu://auth/callback#token=eyJpZCI6IngifQ");
  });
});
