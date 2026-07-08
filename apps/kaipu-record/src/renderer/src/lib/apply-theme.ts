import type { Theme } from "@shared/types";

/**
 * Reflect the persisted theme on <html> so the tokens' [data-theme="light"]
 * block (from @kaipu/tokens/css, reached by every window through base.css)
 * takes effect. Dark is the :root default and is represented as NO attribute,
 * keeping dark markup identical to pre-theming builds.
 */
export function applyTheme(theme: Theme): void {
  if (theme === "light") {
    document.documentElement.dataset.theme = "light";
  } else {
    delete document.documentElement.dataset.theme;
  }
}
