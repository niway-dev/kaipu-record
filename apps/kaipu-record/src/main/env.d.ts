interface ImportMetaEnv {
  readonly MAIN_VITE_POSTHOG_KEY?: string;
  readonly MAIN_VITE_POSTHOG_HOST?: string;
  readonly MAIN_VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
