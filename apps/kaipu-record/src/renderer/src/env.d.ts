/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * DEV-ONLY watermark override (`free` | `paid`). Read only under
   * `import.meta.env.DEV`; the branch is eliminated from production builds.
   * See `features/watermark/use-watermark.ts`.
   */
  readonly VITE_WATERMARK_FORCE?: string;
}
