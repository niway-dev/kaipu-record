import type { BaseTokens } from "./types";

/** Theme-invariant tokens — identical in dark and light. */
export const base: BaseTokens = {
  "space-xs": "4px",
  "space-sm": "8px",
  "space-md": "12px",
  "space-lg": "16px",
  "space-xl": "24px",
  "space-2xl": "32px",
  "radius-sm": "4px",
  "radius-md": "5px",
  "radius-lg": "8px",
  "font-family":
    '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  "font-mono": '"Geist Mono", "SF Mono", "Fira Mono", "Cascadia Code", monospace',
  "font-size-xs": "11px",
  "font-size-sm": "12px",
  "font-size-base": "13px",
  "font-size-md": "14px",
  "font-size-lg": "16px",
  "font-size-xl": "20px",
  "font-weight-normal": "400",
  "font-weight-medium": "500",
  "font-weight-semibold": "600",
  "sidebar-width": "56px",
  "titlebar-height": "38px",
  transition: "150ms ease",
  "transition-slow": "250ms ease",
};
