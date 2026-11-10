import { ROUTES, type RoutePath } from "./routes";
import type { FlagName } from "./analytics";
import type { AppSettings } from "./types/ipc";

/**
 * The typed UI map: every screen of the desktop app, the named areas on it, and the states
 * each area can look like (ADR 0046). The UI state catalog walks it, and `ui-catalog/
 * coverage.test.ts` fails when a route, a window kind or an area is missing from it.
 *
 * An area is a zone a person would point at and name (`record.mic`, `library.sortMenu`). Its
 * root element carries `data-ui-area="<screen>.<area>"` through `uiArea()` in the renderer
 * (`lib/ui-area.ts`); the catalog crops by that attribute, never by visible text. `states`
 * lists the distinct looks, not every prop combination. `gatedBy` names what an area depends
 * on (a feature flag, a setting, a permission, the account); the catalog shoots both sides.
 *
 * A new UI feature adds its screens, areas and states here in the same PR, spreads
 * `uiArea("<AreaId>")` on each area root, and adds a catalog state per area.
 *
 * Literals only: `src/shared/**` is reachable from the preload bundle, which externalizes
 * workspace packages and cannot load their TypeScript at runtime. This file imports from
 * `./routes`, `./analytics` and `./types/ipc` (types only) and from nothing under `@kaipu/*`;
 * `ui-map.test.ts` pins that.
 */

/** The render targets that are floating windows, selected by the `?window=` query param. */
export const WINDOW_KINDS = [
  "capture-panel",
  "control-bar",
  "camera-bubble",
  "capture-overlay",
  "capture-toast",
  "recording-ready",
  "recording-shade",
] as const;
export type WindowKind = (typeof WINDOW_KINDS)[number];

/** What an area depends on. The catalog shoots an area on both sides of each gate. */
export type Gate =
  | { readonly flag: FlagName }
  | { readonly setting: keyof AppSettings }
  | {
      readonly recordingSetting: "isMicrophoneEnabled" | "isSystemAudioEnabled" | "isCameraEnabled";
    }
  | { readonly permission: "screen" | "microphone" | "camera" | "accessibility" }
  | { readonly account: "signed-out" | "signed-in" | "cloud" };

export interface AreaSpec {
  /** The distinct looks of the area; at least one. */
  readonly states: readonly [string, ...string[]];
  readonly gatedBy?: readonly [Gate, ...Gate[]];
}

type Areas = { readonly [area: string]: AreaSpec };

/** A route that renders a page, or a Settings child (`/settings/<child>`). */
type ScreenRoute = RoutePath | `/settings/${string}`;

export type ScreenSpec =
  /** A page the router renders. */
  | { readonly kind: "route"; readonly route: ScreenRoute; readonly areas: Areas }
  /** A route that only redirects: nothing to capture. */
  | { readonly kind: "route"; readonly route: ScreenRoute; readonly redirect: true }
  /** A route that exists but cannot be captured; the reason goes in the README. */
  | { readonly kind: "route"; readonly route: ScreenRoute; readonly notCapturable: string }
  /** A floating window, selected by a query string. */
  | {
      readonly kind: "window";
      readonly window: WindowKind;
      readonly query: `mode=${string}` | `window=${string}`;
      readonly areas: Areas;
    }
  /** Chrome that is on every route (title bar, sidebar, banners, dialogs). */
  | { readonly kind: "chrome"; readonly areas: Areas }
  /** A takeover drawn over the app. */
  | { readonly kind: "overlay"; readonly areas: Areas };

export const UI_MAP = {
  // ── Routes ────────────────────────────────────────────────────────────────
  record: {
    kind: "route",
    route: ROUTES.record,
    areas: {
      page: { states: ["idle", "recording", "paused"] },
      workspaceNotice: { states: ["notConnected"] },
      reconcileBanner: { states: ["fixable", "attention"] },
      startButton: { states: ["idle"] },
      modePicker: {
        states: ["frame", "window", "screen"],
        gatedBy: [{ setting: "recordingMode" }],
      },
      mic: {
        states: ["on", "off"],
        gatedBy: [{ recordingSetting: "isMicrophoneEnabled" }, { permission: "microphone" }],
      },
      micSettings: { states: ["open"], gatedBy: [{ recordingSetting: "isMicrophoneEnabled" }] },
      audio: {
        states: ["on", "off", "unavailable"],
        gatedBy: [{ recordingSetting: "isSystemAudioEnabled" }],
      },
      audioSettings: {
        states: ["open"],
        gatedBy: [{ recordingSetting: "isSystemAudioEnabled" }],
      },
      camera: {
        states: ["on", "off", "blocked"],
        gatedBy: [{ recordingSetting: "isCameraEnabled" }, { permission: "camera" }],
      },
      cameraSettings: { states: ["open"], gatedBy: [{ recordingSetting: "isCameraEnabled" }] },
      // Drawn only when the input is on and its permission is denied.
      micNotice: {
        states: ["denied"],
        gatedBy: [{ recordingSetting: "isMicrophoneEnabled" }, { permission: "microphone" }],
      },
      cameraNotice: {
        states: ["denied"],
        gatedBy: [{ recordingSetting: "isCameraEnabled" }, { permission: "camera" }],
      },
      sourcePicker: {
        states: ["loading", "screens", "windows", "empty", "noScreenAccess"],
        gatedBy: [{ permission: "screen" }],
      },
      countdown: { states: ["running"], gatedBy: [{ setting: "recordingCountdownSeconds" }] },
      recordingIndicator: { states: ["recording", "paused"] },
      recordingControls: { states: ["recording", "paused"] },
    },
  },
  library: {
    kind: "route",
    route: ROUTES.library,
    areas: {
      page: { states: ["items", "empty", "noMatch", "error", "loading"] },
      workspaceNotice: { states: ["notConnected"] },
      toolbar: { states: ["default"] },
      sortMenu: { states: ["closed", "open"] },
      /** The open list: positioned below the button, outside its box, so its own area. */
      sortOptions: { states: ["open"] },
      kindFilter: { states: ["all", "recordings", "screenshots"] },
      storageFilter: { states: ["all", "local", "cloud"], gatedBy: [{ account: "cloud" }] },
      tagFilter: { states: ["noTags", "tags"] },
      reconcileBanner: { states: ["fixable", "attention"] },
      grid: { states: ["items"] },
      list: { states: ["items"] },
      emptyState: { states: ["empty", "noMatch", "error", "loading"] },
      readyCopyCard: { states: ["ready"] },
      videoCard: { states: ["recording", "screenshot", "gif", "selected", "cloudOnly"] },
      videoRow: { states: ["recording", "screenshot", "selected"] },
      selectionBar: { states: ["selecting", "moving"] },
      tagPanel: { states: ["item", "all"] },
    },
  },
  libraryDetail: {
    kind: "route",
    route: ROUTES.libraryDetail,
    areas: {
      page: { states: ["recording", "screenshot", "gif", "loading"] },
      missing: { states: ["notFound"] },
      header: { states: ["recording", "screenshot", "gif", "cloudOnly"] },
      details: { states: ["recording", "edited", "stale", "copy"] },
      postRecordingCard: { states: ["fresh"], gatedBy: [{ setting: "showRecordingSavedCard" }] },
      savedNotice: { states: ["shown"] },
      preview: { states: ["video", "image", "gif", "unavailable"] },
      actions: { states: ["recording", "screenshot", "gif", "cloudOnly"] },
      tabs: { states: ["destinations", "versions", "details"] },
      // VersionsList: the original alone; with its edited project; with the copies made from
      // it; a copy viewed on its own page (the Viewing pill sits on that row); a copy being
      // made; a copy whose original was deleted.
      versions: {
        states: ["original", "edited", "withCopies", "copy", "running", "sourceDeleted"],
      },
      itemDetails: { states: ["recording", "screenshot", "gif"] },
      // DestinationsList: "heavy" adds the heavy-to-send line under the rows (over 25 MB).
      destinations: { states: ["ready", "heavy"] },
      // The ••• menu floats below its button, outside the actions box, so it is its own area.
      itemMenu: { states: ["open"] },
    },
  },
  export: {
    kind: "route",
    route: ROUTES.export,
    areas: {
      page: { states: ["ready", "loading", "notFound", "notExportable"] },
      header: { states: ["default"] },
      // Not gated by `exportQuality`: that setting only preselects a row in the editor's export
      // sheet; this page never reads it.
      stage: { states: ["nothingPicked", "destinationPicked"] },
      destinationRow: { states: ["default", "selected"] },
    },
  },
  exportNew: {
    kind: "route",
    route: ROUTES.exportNew,
    areas: {
      page: { states: ["empty", "dragging"] },
      header: { states: ["default"] },
      dropZone: { states: ["idle", "dragging", "importing"] },
      recentExports: { states: ["list"] },
    },
  },
  prepare: { kind: "route", route: ROUTES.prepare, redirect: true },
  prepareNew: { kind: "route", route: ROUTES.prepareNew, redirect: true },
  screenshots: {
    kind: "route",
    route: ROUTES.screenshots,
    areas: {
      page: { states: ["idle", "busyWhileRecording"] },
      captureButton: { states: ["idle", "disabled"] },
      // No "window": Capture window is switched off (`ENABLED_CAPTURE_MODES`), so the page has
      // only the Frame and Screen chips.
      modeChips: {
        states: ["frame", "screen"],
        gatedBy: [{ setting: "screenshotMode" }],
      },
      recent: { states: ["list"] },
    },
  },
  editor: {
    kind: "route",
    route: ROUTES.editor,
    areas: {
      page: { states: ["videos", "images"] },
      tabs: { states: ["videos", "images"] },
      startImage: { states: ["default", "clipboard"] },
      continue: { states: ["default", "showOlder"] },
      hero: { states: ["video", "image"] },
      emptyContinue: { states: ["videos", "images"] },
    },
  },
  editorNew: {
    kind: "route",
    route: ROUTES.editorNew,
    areas: {
      page: { states: ["waiting"] },
      pasteZone: { states: ["waiting", "empty"] },
    },
  },
  editorVideo: {
    kind: "route",
    route: ROUTES.editorVideo,
    areas: {
      page: { states: ["loaded"] },
      preview: { states: ["frame", "zoomSelected", "overlaySelected"] },
      cursor: { states: ["visible"], gatedBy: [{ flag: "native-cursor-capture" }] },
      cursorInspector: { states: ["open"], gatedBy: [{ flag: "native-cursor-capture" }] },
      webcam: { states: ["visible"] },
      transport: { states: ["paused", "playing", "withCounts", "speedChanged", "zoomed"] },
      toolRail: { states: ["default", "annotate", "privacy"] },
      toolFlyout: { states: ["audio"] },
      tracksPopover: { states: ["open"] },
      // The Timeline guide (NIW2-679): a dialog over the editor, one tab per lane.
      trackGuide: { states: ["clips", "zooms", "webcam"] },
      toolbar: { states: ["default", "saving", "saved"] },
      inspector: { states: ["detection", "zoom", "mute", "webcam", "annotation", "privacy"] },
      // The Background section at the top of the inspector with nothing selected (ADR 0051):
      // `default` is none with the sliders disabled, `set` is a preset with padding, corners, shadow.
      background: { states: ["default", "set"] },
      timeline: { states: ["default", "zoomed"] },
      zoomLane: { states: ["empty", "segments"] },
      webcamLane: { states: ["segments"] },
      privacyLane: { states: ["empty", "regions"] },
      audioLane: { states: ["empty", "mutedRanges", "allMuted"] },
      exportSheet: { states: ["open"], gatedBy: [{ setting: "exportQuality" }] },
    },
  },
  editorImage: {
    kind: "route",
    route: ROUTES.editorImage,
    areas: {
      page: { states: ["saved"] },
      toolbar: { states: ["default", "saved"] },
      tools: { states: ["select", "annotate", "crop"] },
      canvas: { states: ["default", "crop", "annotate"] },
      beautify: { states: ["default"] },
    },
  },
  editorCapture: {
    kind: "route",
    route: ROUTES.editorCapture,
    areas: {
      page: { states: ["fresh"] },
    },
  },
  screenshotEditor: { kind: "route", route: ROUTES.screenshotEditor, redirect: true },
  videoEditor: { kind: "route", route: ROUTES.videoEditor, redirect: true },
  shortcuts: {
    kind: "route",
    route: ROUTES.shortcuts,
    areas: {
      page: { states: ["default"] },
      list: { states: ["default", "conflict"] },
    },
  },
  cloud: {
    kind: "route",
    route: ROUTES.cloud,
    areas: {
      page: { states: ["signedOut", "signedIn", "loading"] },
      saveMode: { states: ["localOnly", "cloud"], gatedBy: [{ setting: "uploadMode" }] },
      account: {
        states: ["signedOut", "unknown", "signedIn"],
        gatedBy: [{ account: "signed-out" }, { account: "signed-in" }],
      },
      usage: { states: ["shown", "stale", "unavailable"], gatedBy: [{ account: "cloud" }] },
    },
  },
  signIn: {
    kind: "route",
    route: ROUTES.signIn,
    areas: {
      page: { states: ["browser", "waiting"] },
      card: { states: ["browser", "waiting"] },
      error: { states: ["invalidCode", "network"] },
      codeForm: { states: ["empty", "filled"] },
    },
  },
  settings: { kind: "route", route: ROUTES.settings, redirect: true },
  settingsGeneral: {
    kind: "route",
    route: "/settings/general",
    areas: {
      page: { states: ["default"] },
      language: { states: ["default"] },
      // Dark only: the light theme is out of the catalog's scope (spec, non-goals).
      theme: { states: ["dark"] },
      account: { states: ["default"] },
    },
  },
  settingsPermissions: {
    kind: "route",
    route: "/settings/permissions",
    areas: {
      page: { states: ["allGranted", "missing"] },
      permissions: {
        states: ["allGranted", "missing"],
        gatedBy: [{ permission: "screen" }, { permission: "microphone" }, { permission: "camera" }],
      },
      clickZoom: { states: ["granted", "notGranted"], gatedBy: [{ permission: "accessibility" }] },
    },
  },
  settingsRecordingQuality: {
    kind: "route",
    route: "/settings/recording-quality",
    areas: {
      page: { states: ["default", "overridden"] },
      recordingQuality: { states: ["default", "overridden"] },
      exportQuality: { states: ["default", "overridden"], gatedBy: [{ setting: "exportQuality" }] },
    },
  },
  settingsRecording: {
    kind: "route",
    route: "/settings/recording",
    areas: {
      page: { states: ["default"] },
      options: {
        states: ["default"],
        gatedBy: [
          { setting: "showBarInRecording" },
          { setting: "recordingCountdownSeconds" },
          { setting: "showBrandBadge" },
        ],
      },
    },
  },
  settingsScreenshots: {
    kind: "route",
    route: "/settings/screenshots",
    areas: {
      page: { states: ["default"] },
      options: {
        states: ["preview", "copy"],
        gatedBy: [{ setting: "screenshotAfterCapture" }, { setting: "screenshotCopy" }],
      },
    },
  },
  settingsWorkspaces: {
    kind: "route",
    route: "/settings/workspaces",
    areas: {
      page: { states: ["list"] },
      list: { states: ["one", "several", "notConnected"] },
    },
  },
  settingsApp: {
    kind: "route",
    route: "/settings/app",
    areas: {
      page: { states: ["default"] },
      app: { states: ["default"], gatedBy: [{ setting: "showInDock" }] },
      privacy: { states: ["default"] },
      updates: { states: ["idle", "available", "ready"] },
    },
  },
  settingsDeveloper: {
    kind: "route",
    route: "/settings/developer",
    notCapturable: "DEV-only page, absent from a production build",
  },

  // ── Floating windows ──────────────────────────────────────────────────────
  capturePanel: {
    kind: "window",
    window: "capture-panel",
    query: "mode=capture",
    areas: {
      root: { states: ["record", "recording", "capture"] },
      tabs: { states: ["record", "capture", "locked"] },
      startButton: { states: ["idle"] },
      modePicker: {
        states: ["frame", "window", "screen"],
        gatedBy: [{ setting: "recordingMode" }],
      },
      mic: {
        states: ["on", "off"],
        gatedBy: [{ recordingSetting: "isMicrophoneEnabled" }, { permission: "microphone" }],
      },
      micSettings: { states: ["open"], gatedBy: [{ recordingSetting: "isMicrophoneEnabled" }] },
      audio: { states: ["on", "off"], gatedBy: [{ recordingSetting: "isSystemAudioEnabled" }] },
      audioSettings: {
        states: ["open"],
        gatedBy: [{ recordingSetting: "isSystemAudioEnabled" }],
      },
      camera: {
        states: ["on", "off", "blocked"],
        gatedBy: [{ recordingSetting: "isCameraEnabled" }, { permission: "camera" }],
      },
      cameraSettings: { states: ["open"], gatedBy: [{ recordingSetting: "isCameraEnabled" }] },
      recordingIndicator: { states: ["recording", "paused"] },
      // No "busy": a take locks the panel on its Record tab, so the capture buttons are never
      // drawn mid-take (capture-panel.tsx keeps the prop for the day the lock lifts).
      captureButtons: { states: ["idle"], gatedBy: [{ setting: "screenshotMode" }] },
    },
  },
  controlBar: {
    kind: "window",
    window: "control-bar",
    query: "window=control-bar",
    areas: {
      bar: { states: ["starting", "recording", "paused", "saving"] },
      mode: { states: ["screen", "window", "frame"] },
      screenshot: { states: ["available"], gatedBy: [{ flag: "capture-while-recording" }] },
      inputs: { states: ["on", "off", "audioUnavailable"] },
    },
  },
  cameraBubble: {
    kind: "window",
    window: "camera-bubble",
    query: "window=camera-bubble",
    areas: {
      root: { states: ["circle", "square", "portrait"], gatedBy: [{ setting: "cameraBubble" }] },
      bubble: { states: ["live", "placeholder"] },
    },
  },
  captureOverlay: {
    kind: "window",
    window: "capture-overlay",
    query: "window=capture-overlay",
    areas: {
      frameBox: { states: ["screenshot", "record"] },
      // Only the capture intent draws it: opened to record, the Frame box draws the record
      // widget instead (frame-box.tsx), and Window has no overlay picker to record from.
      selectionToolbar: { states: ["capture"] },
      screenCard: { states: ["screenshot", "record", "highlighted"] },
      windowPicker: { states: ["noWindow", "hovered"] },
      ratioBar: { states: ["free", "ratio"] },
      recordWidget: {
        states: ["default"],
        gatedBy: [
          { recordingSetting: "isMicrophoneEnabled" },
          { recordingSetting: "isSystemAudioEnabled" },
          { recordingSetting: "isCameraEnabled" },
        ],
      },
      hintPill: { states: ["frame", "pick"] },
    },
  },
  captureToast: {
    kind: "window",
    window: "capture-toast",
    query: "window=capture-toast",
    areas: {
      root: { states: ["saved", "notSaved"] },
      card: {
        states: ["rest", "hover", "copied", "taken"],
        gatedBy: [
          { setting: "screenshotAfterCapture" },
          { setting: "screenshotCopy" },
          { flag: "capture-while-recording" },
        ],
      },
    },
  },
  recordingReady: {
    kind: "window",
    window: "recording-ready",
    query: "window=recording-ready",
    areas: {
      root: { states: ["default"] },
      card: {
        states: ["default", "hover", "cannotEdit"],
        gatedBy: [{ setting: "showRecordingSavedCard" }],
      },
    },
  },
  recordingShade: {
    kind: "window",
    window: "recording-shade",
    query: "window=recording-shade",
    areas: {
      countdown: {
        states: ["area", "fullDisplay"],
        gatedBy: [{ setting: "recordingCountdownSeconds" }],
      },
      areaBorder: { states: ["area"] },
      displayBorder: { states: ["fullDisplay"] },
    },
  },

  // ── Chrome and overlays ───────────────────────────────────────────────────
  shell: {
    kind: "chrome",
    areas: {
      titleBar: { states: ["default", "withSwitcher"] },
      historyArrows: { states: ["atStart", "canGoBack"] },
      workspaceSwitcher: { states: ["closed", "hint", "notConnected", "locked"] },
      workspaceMenu: { states: ["open"] },
      sidebar: { states: ["rest", "exportBadge"] },
      statusBar: { states: ["default"] },
      updateBanner: { states: ["ready"] },
      versionBanner: { states: ["soft"] },
      versionOverlay: { states: ["hard"] },
      exportCard: { states: ["progress", "error", "ready"] },
      reconcileDialog: { states: ["scanning", "list", "fixing", "report"] },
      workspaceDialog: { states: ["new", "edit"] },
      notFound: { states: ["default"] },
      routeError: { states: ["default"] },
      settingsNav: { states: ["default"] },
    },
  },
  onboarding: {
    kind: "overlay",
    areas: {
      root: { states: ["welcome", "permissions", "done"] },
      welcomeStep: { states: ["default"] },
      permissionsStep: {
        states: ["none", "all"],
        gatedBy: [
          { permission: "screen" },
          { permission: "microphone" },
          { permission: "camera" },
          { permission: "accessibility" },
        ],
      },
      doneStep: { states: ["default"] },
    },
  },
} as const satisfies Record<string, ScreenSpec>;

export type ScreenId = keyof typeof UI_MAP;

type AreasOf<S extends ScreenId> = (typeof UI_MAP)[S] extends { areas: infer A } ? A : never;

/** `<screen>.<area>`, e.g. `record.mic`. */
export type AreaId = {
  [S in ScreenId]: `${S}.${keyof AreasOf<S> & string}`;
}[ScreenId];

/** `<screen>.<area>:<state>`, e.g. `record.mic:panelOpen`. */
export type StateId = {
  [S in ScreenId]: {
    [A in keyof AreasOf<S> & string]: AreasOf<S>[A] extends { states: readonly (infer T)[] }
      ? `${S}.${A}:${T & string}`
      : never;
  }[keyof AreasOf<S> & string];
}[ScreenId];

const SCREENS: Readonly<Record<string, ScreenSpec>> = UI_MAP;

function areasOf(screen: ScreenSpec): Areas {
  return "areas" in screen ? screen.areas : {};
}

/** Every declared area id, in declaration order. */
export const ALL_AREA_IDS: readonly AreaId[] = Object.entries(SCREENS).flatMap(([id, screen]) =>
  Object.keys(areasOf(screen)).map((area) => `${id}.${area}` as AreaId),
);

function specOf(id: AreaId): AreaSpec {
  const dot = id.indexOf(".");
  const spec = areasOf(SCREENS[id.slice(0, dot)])[id.slice(dot + 1)];
  return spec;
}

/** The states an area can look like. */
export function areaStates(id: AreaId): readonly string[] {
  return specOf(id).states;
}

/** What an area depends on; empty when it depends on nothing. */
export function areaGates(id: AreaId): readonly Gate[] {
  return specOf(id).gatedBy ?? [];
}
