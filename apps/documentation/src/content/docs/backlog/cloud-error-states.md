---
title: Cloud error states — what can fail and what the user sees
description: Every failure the desktop Cloud page and the cloud upload API can hit today, how each one is rendered (or not), the signed-out view, and the gaps to close.
---

# Cloud error states — what can fail and what the user sees

> **Status: 🔵 Proposed.** The server side (plan 01, Tasks 0–10) is on `main` and maps
> domain errors to HTTP errors. The desktop renders the capacity-card states listed below;
> it does **not** consume the upload errors yet (uploads are plan 03). This doc is the
> checklist for closing the gaps.

## 1. Cloud page — signed out

With no session the page still renders; local recording never needs an account.

```
Storage and cloud
Kaipu works locally. Cloud keeps a private copy and lets you share a link when you decide to.

SAVE MODE
 (●) Local only        Save files on this device. Do not upload files automatically.
 ( ) Manual upload     (disabled)
 ( ) Automatic upload  (disabled)
 Sign in to use cloud. Recording keeps working on this device.
 Creating an account does not turn on automatic upload. …

ACCOUNT AND CAPACITY
 ┌───────────────────────────────────────────────────────────────┐
 │ Your Kaipu account                                  [Sign in] │
 │ You can record, edit, and export without an account.          │
 └───────────────────────────────────────────────────────────────┘
```

- Cloud modes are disabled, with the reason (`modeSignInRequired`).
- If a cloud mode was saved before signing out it stays checked, and the note becomes
  `modeSignedOutSaved` ("Cloud modes wait until you sign in…"). Signing out never rewrites
  the preference.
- "Sign in" opens the full-window sign-in page and returns to `/cloud`; that page links to
  account creation.
- While the first auth status round-trip is pending the account card renders empty, so a
  signed-in user never sees a flash of the signed-out row.
- No request to `/me/storage` is made.

Source: `features/storage-cloud/storage-cloud-settings.tsx`, `upload-mode-picker.tsx`,
`features/auth/account-panel.tsx`.

## 2. Capacity card — `GET /api/v1/me/storage`

| Case                                              | Signal                  | What the user sees                                         | OK?                                         |
| ------------------------------------------------- | ----------------------- | ---------------------------------------------------------- | ------------------------------------------- |
| Signed out                                        | no token, no request    | Signed-out view (section 1)                                | ✅                                          |
| Stored token not verifiable (offline at start)    | auth status `unknown`   | Last known email + "couldn't verify"                       | ✅                                          |
| Session expired / invalid token                   | 401                     | "Sign in again"                                            | ✅                                          |
| Server without the endpoint (old deploy)          | 404                     | "Cloud storage isn't available yet"                        | ✅                                          |
| Email not verified                                | `cloudUploads: false`   | "Verify your email to use cloud" (#98)                     | ✅                                          |
| Uploads paused globally (`cloud_control`)         | `uploadsEnabled: false` | Usage bar + "uploads are paused"                           | ✅                                          |
| Offline, 15 s timeout, 5xx (Neon / Worker down)   | thrown generic error    | Stale figures with their age if cached, else generic error | ⚠️ offline and server failure look the same |
| Malformed body                                    | validation rejects      | Generic error                                              | ✅ never shows zeros                        |
| Worker misconfigured (`DATABASE_URL`, R2 binding) | 500                     | Generic error                                              | ⚠️ only visible in logs                     |

## 3. Upload API — `/api/v1/assets`

The server maps domain errors in `apps/server-hono/src/modules/cloud/errors.ts`:

| Domain error                  | HTTP | `data.kind`                       | Message the desktop should show              |
| ----------------------------- | ---- | --------------------------------- | -------------------------------------------- |
| `QuotaExceededError`          | 413  | `quota-exceeded` + `missingBytes` | "You need X MB more cloud space"             |
| `FileTooLargeError`           | 413  | `file-too-large` + `limitBytes`   | "This file is over the X limit"              |
| `UnsupportedContentTypeError` | 400  | —                                 | "This file type can't be uploaded"           |
| `TooManyPendingUploadsError`  | 429  | —                                 | "Too many uploads in progress"               |
| `UploadsDisabledError`        | 503  | —                                 | "Uploads are paused"                         |
| `CloudAccessDeniedError`      | 403  | — (see gap 1)                     | "Verify your email to use cloud"             |
| `UploadVerificationError`     | 409  | `verification-failed` + `reason`  | "The upload didn't match; retry"             |
| Asset missing / not the owner | 404  | —                                 | "No longer in the cloud"                     |
| Direct PUT to R2 fails        | R2   | not mapped                        | expired ticket, size mismatch, network, CORS |

The desktop today only lists assets (`main/cloud/catalog-client.ts`) and recognises 401;
everything else is a generic error.

## 4. Gaps to close

1. **403 with a reason.** Add `data: { kind: "email-unverified" }` to `CloudAccessDeniedError`
   (and to `/me/storage` when `cloudUploads` is false) so the client stops inferring the cause
   once more access conditions exist.
2. ~~**No way out of "unverified".**~~ Done: Better Auth now sends a real verification email
   via `@kaipu/infra-email` (Resend), with a 24-hour link handled by the web app
   (`/auth/email-verified`, with a resend form on an expired/invalid link) and a
   resend-verification action on the desktop's Cloud page. No manual/operator verification
   path was added, by design.
3. **Offline vs server failure.** Distinguish "you're offline" (retry when back) from "the
   server failed" in the capacity card.
4. ~~**Save mode for unverified accounts.**~~ Done: the picker takes a `cloudBlocker`
   (`signed-out` or `email-unverified`) and shows the verify-email reason under the modes.
5. **R2 PUT failures.** Map expired ticket, size mismatch and network errors when plan 03
   builds transfers.
6. **Upload error copy.** Implement section 3's messages in the desktop transfer flow
   (plan 03), switching on HTTP status + `data.kind`.
