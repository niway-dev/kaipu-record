/**
 * Every route in the app, in one place.
 *
 * The router, the sidebar and the window-size table all name these paths. As
 * string literals in three files they drift silently — a renamed route leaves a
 * dead sidebar link or a screen that quietly falls back to the default window.
 * Here a rename is a compile error in every reader.
 *
 * Lives in `shared` because the window-size table is read by main as well as the
 * renderer, and `src/shared` is the only directory both can import. It holds no
 * value imports from workspace packages, per the preload rule in CLAUDE.md.
 */
export const ROUTES = {
  record: "/",
  library: "/library",
  libraryDetail: "/library/:assetId",
  screenshots: "/screenshots",
  screenshotEditor: "/screenshot-editor",
  videoEditor: "/video-editor",
  shortcuts: "/shortcuts",
  cloud: "/cloud",
  settings: "/settings",
  signIn: "/sign-in",
  signUp: "/sign-up",
} as const;

export type RouteName = keyof typeof ROUTES;
export type RoutePath = (typeof ROUTES)[RouteName];
