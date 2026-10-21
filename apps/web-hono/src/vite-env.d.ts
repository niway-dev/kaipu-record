/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_PUBLIC_DOWNLOAD_URL?: string;
  /** PostHog project key for the cookieless website analytics. Empty or missing turns analytics off. */
  readonly VITE_POSTHOG_KEY?: string;
  /** PostHog ingestion host (e.g. https://us.i.posthog.com); used to derive the app host. */
  readonly VITE_POSTHOG_HOST?: string;
  /** "true" turns on the account deletion UI (needs the NIW2-214 routes on the API). */
  readonly VITE_ACCOUNT_DELETION_ENABLED?: string;
  /** "true" swaps the account page's deletion client for the in-memory mock (local dev). */
  readonly VITE_ACCOUNT_USE_MOCKS?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
