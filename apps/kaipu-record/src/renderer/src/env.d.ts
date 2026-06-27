/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_POSTHOG_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
  readonly VITE_POSTHOG_PRODUCT?: string;
  readonly VITE_POSTHOG_SURFACE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
