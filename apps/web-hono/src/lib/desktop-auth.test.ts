import { describe, expect, it } from "vitest";

import {
  desktopAuthSearch,
  desktopCallbackUrl,
  desktopDonePath,
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

  it("builds the deep link the way ensureElectronRedirect does", () => {
    // electronProxyClient: `${scheme}:/${callbackPath}#token=${cookie value}`
    expect(desktopCallbackUrl("eyJpZCI6IngifQ")).toBe("kaipu://auth/callback#token=eyJpZCI6IngifQ");
  });
});
