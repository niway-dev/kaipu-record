// src/shared/types/auth.ts

import type { Entitlements } from "../entitlements";

export type AuthStatus =
  | { kind: "signed-out" }
  | {
      kind: "signed-in";
      userId: string;
      email: string;
      name: string;
      entitlements: Entitlements;
      /** When this machine last sent a verification email for this account. Persisted with
       *  the session, because the UI that offers the resend is remounted on every visit to
       *  the cloud screen — component state cannot remember that the mail already went out. */
      verificationEmailSentAt?: number;
    }
  /** A token is stored but its last verification attempt couldn't reach the server (offline,
   *  timeout) — distinct from `signed-out` so a network blip never silently drops the session.
   *  Carries the last entitlements the server reported, so being offline keeps the plan the
   *  user had rather than downgrading them. */
  | {
      kind: "unknown";
      lastKnownUserId?: string;
      lastKnownEmail?: string;
      entitlements?: Entitlements;
      /** Same field as `signed-in`: it is read from disk, so being offline does not lose it. */
      verificationEmailSentAt?: number;
    };

/** Which web screen the browser sign-in lands on. Both end in the same hand-off back to the app. */
export type BrowserSignInIntent = "sign-in" | "sign-up";

/** What a failed browser sign-in reports to the renderer. */
export type AuthError =
  /** The sign-in link or pasted code does not belong to a sign-in this app started (PKCE state
   *  mismatch, the app was restarted in between, or the user pressed Cancel). */
  | { kind: "state-mismatch" }
  /** The code is malformed, expired (they live about five minutes) or was already used. */
  | { kind: "invalid-code" }
  /** The API's per-address rate limit on the code exchange: the code may still be valid. */
  | { kind: "throttled" }
  | { kind: "network" }
  /** The web address of Kaipu is not configured in this build, so there is nowhere to send the user. */
  | { kind: "not-configured" }
  | { kind: "unknown"; message: string };
