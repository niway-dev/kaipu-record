/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_PUBLIC_DOWNLOAD_URL?: string;
  /** "true" turns on the account deletion UI (needs the NIW2-214 routes on the API). */
  readonly VITE_ACCOUNT_DELETION_ENABLED?: string;
  /** "true" swaps the account page's deletion client for the in-memory mock (local dev). */
  readonly VITE_ACCOUNT_USE_MOCKS?: string;
  /** "true" shows "Continue with Google" (the API must have GOOGLE_CLIENT_ID/SECRET). NIW2-219. */
  readonly VITE_GOOGLE_AUTH_ENABLED?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
