// Registers use-intl's compile-time type safety: keys/namespaces come from the
// es.json shape; locales are the supported union. Imported for its side effect
// from index.ts so every consumer of @kaipu/i18n inherits the augmentation.
import type es from "../messages/es.json";

declare module "use-intl" {
  interface AppConfig {
    Locale: "es" | "en";
    Messages: typeof es;
  }
}
