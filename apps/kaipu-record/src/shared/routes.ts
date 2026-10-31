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
  /** Export a copy of a recording for where it is going; `?to=` preselects a destination. */
  export: "/export/:assetId",
  /** Export with no recording yet: drop or pick a video, from Kaipu or from outside. */
  exportNew: "/export",
  /** Legacy (Prepare, NIW2-578), redirects to `export` keeping the query. */
  prepare: "/prepare/:assetId",
  /** Legacy (Prepare with no recording, NIW2-587), redirects to `exportNew` keeping the query. */
  prepareNew: "/prepare",
  screenshots: "/screenshots",
  /** The Editor workspace: recent items when nothing is open. */
  editor: "/editor",
  editorVideo: "/editor/video/:assetId",
  editorImage: "/editor/image/:assetId",
  /** An empty editor waiting for an image pasted from the clipboard. */
  editorNew: "/editor/new",
  /** A fresh capture that is not in the vault yet; its image travels in router state. */
  editorCapture: "/editor/capture",
  /** Legacy, redirects to `editorImage`/`editorCapture`. */
  screenshotEditor: "/screenshot-editor",
  /** Legacy, redirects to `editorVideo`. */
  videoEditor: "/video-editor",
  shortcuts: "/shortcuts",
  cloud: "/cloud",
  settings: "/settings",
  signIn: "/sign-in",
} as const;

export type RouteName = keyof typeof ROUTES;
export type RoutePath = (typeof ROUTES)[RouteName];
