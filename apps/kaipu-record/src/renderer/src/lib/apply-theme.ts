import * as stylex from "@stylexjs/stylex";
import { lightTheme } from "@kaipu/tokens/kaipu.stylex";
import type { Theme } from "@shared/types";

/**
 * The class StyleX generates for `lightTheme`. The typed tokens carry literal
 * values with dark as the default, so the `[data-theme]` attribute below never
 * reaches them: without this class on <html>, every `@kaipu/ui` component stays
 * dark on a light window.
 */
const LIGHT_THEME_CLASSES = (stylex.props(lightTheme).className ?? "").split(" ").filter(Boolean);

/**
 * Reflect the persisted theme on <html>, through both mechanisms that coexist
 * while the migration runs: the tokens' [data-theme="light"] block (from
 * @kaipu/tokens/css, reached by every window through base.css) for the CSS
 * Modules, and the StyleX theme class for the shared components. Dark is the
 * :root default and is represented as NO attribute and NO class, keeping dark
 * markup identical to pre-theming builds.
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  const light = theme === "light";
  if (light) {
    root.dataset.theme = "light";
  } else {
    delete root.dataset.theme;
  }
  for (const name of LIGHT_THEME_CLASSES) root.classList.toggle(name, light);
}
