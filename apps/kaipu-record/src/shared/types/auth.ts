// src/shared/types/auth.ts

import type { Entitlements } from "../entitlements";

export type AuthStatus =
  | { kind: "signed-out" }
  | { kind: "signed-in"; email: string; name: string; entitlements: Entitlements }
  /** A token is stored but its last verification attempt couldn't reach the server (offline,
   *  timeout) — distinct from `signed-out` so a network blip never silently drops the session.
   *  Carries the last entitlements the server reported, so being offline keeps the plan the
   *  user had rather than downgrading them. */
  | { kind: "unknown"; lastKnownEmail?: string; entitlements?: Entitlements };

export interface AuthCredentials {
  email: string;
  password: string;
}

export interface SignUpInput extends AuthCredentials {
  name: string;
}

/** What a failed sign-in/sign-up/session-check reports to the renderer. */
export type AuthError =
  | { kind: "invalid-credentials" }
  | { kind: "email-taken" }
  | { kind: "password-too-short" }
  | { kind: "network" }
  | { kind: "unknown"; message: string };
