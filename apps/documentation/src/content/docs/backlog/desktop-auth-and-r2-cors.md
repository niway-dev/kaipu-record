---
title: Desktop authentication and R2 CORS
description: Define a secure Better Auth session design for Electron and exact CORS policy for Kaipu's Web and Desktop clients.
---

# Desktop authentication and R2 CORS

> **Status: 🔵 Proposed.** Blocking Desktop cloud-recordings integration.

## Context

Kaipu has two first-party clients:

- **Web** uses the same-origin `web-hono` proxy and HttpOnly cookies.
- **Desktop** needs its own authenticated API session and may issue browser/renderer requests to
  R2 presigned URLs.

The existing [Better Auth Electron workaround](../stack/better-auth-electron-bug) document does
not match the current dependencies or server implementation — `@better-auth/electron` is not even
an installed dependency anymore, and neither `lib/auth.ts` nor the `/api/auth/*` handler in
`server-hono` contain the header-rebuilding workaround it describes. It must not be treated as an
implemented design; update or archive it once this workstream lands the tested Desktop auth flow.

## Decisions this workstream must make

1. Choose the Desktop auth mechanism supported by the installed Better Auth version: cookie jar,
   token/session transport, or a verified Electron integration.
2. Decide which Desktop process performs auth, API calls, and R2 upload/download. The renderer may
   participate only through narrowly scoped APIs; session material must not be stored in
   `localStorage`.
3. Define session persistence, encrypted-at-rest storage where applicable, startup restore,
   refresh/expiry handling, sign-out, and remote revocation behaviour.
4. Configure R2 bucket CORS for exact Kaipu Web/Desktop origins and only required methods/headers.
   CORS is not authentication; presigned URLs remain bearer capabilities.
5. Define an end-to-end failure UX for expired upload URLs, offline state, and reauthentication.

## Acceptance criteria

- Desktop sign-up, sign-in, restart/session restore, expiry, sign-out, and revoked-session paths
  are integration-tested against the production-equivalent Worker.
- The renderer cannot read reusable session secrets unless the chosen protocol expressly requires
  it and that exposure is documented and reviewed.
- R2 CORS allows the real first-party origins and rejects an unlisted browser origin.
- The Desktop upload flow survives an expired URL by obtaining a legitimate replacement, never by
  exposing R2 API credentials.
- The obsolete Electron-auth documentation is replaced with the tested implementation.

## Related

- [Electron security hardening](./electron-security-hardening)
- [R2 upload integrity](./r2-upload-integrity)
- [Better Auth Electron workaround](../stack/better-auth-electron-bug) — stale, do not implement from it
