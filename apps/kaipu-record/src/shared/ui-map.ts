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
      // The two entry cards: the whole card opens the selector. The Screenshot card has no
      // "window": Capture window is switched off (`ENABLED_CAPTURE_MODES`).
      screenshotCard: {
        states: ["frame", "screen"],
        gatedBy: [{ setting: "screenshotMode" }],
      },
      recordingCard: {
        states: ["frame", "window", "screen"],
        gatedBy: [{ setting: "recordingMode" }],
      },
      instantLine: { states: ["default"] },
      // Recording setup: the heading, its hint, and the Mic, Audio and Camera tiles below it.
      setup: { states: ["default"] },
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
      // imageHover: the pointer over a screenshot shows the copy button in its corner.
      preview: { states: ["video", "image", "imageHover", "gif", "unavailable"] },
      actions: { states: ["recording", "screenshot", "gif", "cloudOnly"] },
      tabs: { states: ["destinations", "versions", "details", "captures"] },
      // VersionsList: the original alone; with its edited project; with the copies made from
      // it; a copy viewed on its own page (the Viewing pill sits on that row); a copy being
      // made; a copy whose original was deleted.
      versions: {
        states: ["original", "edited", "withCopies", "copy", "running", "sourceDeleted"],
      },
      itemDetails: { states: ["recording", "screenshot", "gif"] },
      // The frame captures taken from this video in the editor (NIW2-764), under the tab's
      // content; only a video with at least one capture has it.
      captures: { states: ["list"] },
      // A capture's own page: the line naming the video it came from, linking to that moment.
      captureSource: { states: ["linked"] },
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
  // The Screenshots page merged into Capture (`record`): the old route only redirects.
  screenshots: { kind: "route", route: ROUTES.screenshots, redirect: true },
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
      // The Captures panel (NIW2-764): this video's frame captures, in the right column in
      // place of the inspector. `empty` has none yet; `list` shows them, newest first.
      // hover: the veil with Go to over a capture's image; duplicate: Capture frame (top bar)
      // at a moment already captured outlines the saved one; confirmDelete: the confirmation
      // dialog a capture's Delete button opens.
      capturesPanel: { states: ["empty", "list", "hover", "duplicate", "confirmDelete"] },
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
      // `waveform` and `waveformMuted` (hatched blocks over dimmed bars) need the
      // `audio-waveform` flag (NIW2-775); the other states are the lane without it.
      audioLane: { states: ["empty", "mutedRanges", "allMuted", "waveform", "waveformMuted"] },
      exportSheet: { states: ["open"], gatedBy: [{ setting: "exportQuality" }] },
    },
  },
  editorImage: {
    kind: "route",
    route: ROUTES.editorImage,
    areas: {
      page: { states: ["saved"] },
      // B1 (default), B2 (a tool's tooltip) and B3 (below 1000 px: the folded toolbar).
      toolbar: { states: ["default", "saved", "tooltip", "compact"] },
      tools: { states: ["select", "annotate", "crop", "step"] },
      // The compact toolbar's Draw and "..." menus and the button that opens the right panel
      // as a sheet (mock B3).
      drawMenu: { states: ["closed", "open"] },
      moreMenu: { states: ["closed", "open"] },
      panelToggle: { states: ["closed", "open"] },
      canvas: {
        states: [
          "default",
          "crop",
          "annotate",
          "step",
          "steps",
          "stepSelected",
          "stepSizes",
          "redacted",
          // The crop applied (NIW2-759): the crop tool left, the stage showing only the cropped part.
          "cropped",
        ],
      },
      canvasView: {
        states: [
          "default",
          "contentOutside",
          "zoomedOut",
          "exportFrame",
          "light",
          "twoImages",
          "justAdded",
          "beautified",
          "offContent",
          // The export frame applied (NIW2-759): the tool left, the stage showing only the frame.
          "exportFrameApplied",
        ],
        gatedBy: [{ flag: "image-canvas" }],
      },
      // The "Cropped" chip (NIW2-759): above the top-left corner of a cropped image (the crop,
      // or the export frame in canvas mode) while the crop tool is not active, shown while the
      // pointer is over the image. Click it, double-click the image or press X to edit the crop.
      cropChip: { states: ["shown"] },
      // The canvas chrome (NIW2-711): the box Copy and Save export, the card the export frame
      // tool opens, and the notice that says where the content went when it is off stage.
      exportBox: { states: ["labeled", "quiet"], gatedBy: [{ flag: "image-canvas" }] },
      exportFrameCard: { states: ["open"], gatedBy: [{ flag: "image-canvas" }] },
      offContentNotice: { states: ["shown"], gatedBy: [{ flag: "image-canvas" }] },
      addImage: { states: ["closed", "open"], gatedBy: [{ flag: "image-canvas" }] },
      // The Library picker (mock E2): the list with the newest selected, the list narrowed by
      // the search field, a search that matches nothing, and a Library with nothing to add.
      libraryPicker: {
        states: ["open", "filtered", "noMatch", "empty"],
        gatedBy: [{ flag: "image-canvas" }],
      },
      redactionStyle: {
        states: ["blur", "solid"],
        gatedBy: [{ flag: "image-canvas" }],
      },
      redactionLock: { states: ["shown"], gatedBy: [{ flag: "image-canvas" }] },
      redactionNotice: { states: ["shown"], gatedBy: [{ flag: "image-canvas" }] },
      // Inspect mode (NIW2-699): the toolbar button, the floating bar and the loupe chip.
      inspectToggle: { states: ["off", "on"], gatedBy: [{ flag: "image-inspect" }] },
      // In the side panel's Tool tab (NIW2-723): it was a toolbar row, or a floating card where
      // the row had no room.
      inspectBar: {
        states: ["hex", "asCaptured"],
        gatedBy: [{ flag: "image-inspect" }],
      },
      inspectHud: { states: ["reading"], gatedBy: [{ flag: "image-inspect" }] },
      // The readout while the pointer is off the image (NIW2-712).
      inspectEmpty: { states: ["shown"], gatedBy: [{ flag: "image-inspect" }] },
      // The pill at the foot of the canvas (mock C11) and the one that replaces it after a copy (C4).
      inspectMode: { states: ["collapsed", "legend"], gatedBy: [{ flag: "image-inspect" }] },
      inspectCopied: { states: ["shown"], gatedBy: [{ flag: "image-inspect" }] },
      // The side panel's tab strip: Tool, Beautify and, where Inspect exists, Colors (NIW2-714,
      // NIW2-723). Beautify is selected on open, Tool once a tool is picked or something is
      // selected, Colors while its panel is open.
      panelTabs: { states: ["tool", "beautify", "colors"] },
      // The Tool tab's body (NIW2-723): the active tool's options, which used to float over
      // the stage or sit in the toolbar. `empty` is "No tool selected"; `stroke` is Pen, Box
      // and Arrow (colour, stroke); `size` is Text and Step (colour, size); `stepSelected` adds
      // the renumbering delete line; `redact` is Blur / Solid (canvas mode); `crop` is the
      // export frame card, or the classic Crop / Reset row; `selectText` is the recognition
      // status and its actions (`image-text`); `selection` is a selected annotation with only
      // Delete to offer (an added image); `inspect` is the Inspect controls (`image-inspect`).
      toolPanel: {
        states: [
          "empty",
          "stroke",
          "size",
          "stepSelected",
          "redact",
          "crop",
          "selectText",
          "selection",
          "inspect",
        ],
      },
      // The colors panel (NIW2-704), the Colors tab of the side panel (NIW2-714): the list
      // (`list` is grouped, the default; `grouped` is the same list with a box of
      // near-identical values; `flat` has Group off), one color highlighted, after a copy,
      // a photograph, while it counts, and when the image could not be read.
      inspectColors: {
        states: ["list", "flat", "grouped", "located", "copied", "photo", "counting", "error"],
        gatedBy: [{ flag: "image-inspect" }],
      },
      // The ruler (NIW2-702): its row in the Inspect bar, the run drawn under the cursor, and
      // a run pinned as a `measure` annotation.
      inspectRuler: {
        states: ["off", "horizontal", "vertical"],
        gatedBy: [{ flag: "image-inspect" }],
      },
      inspectRun: { states: ["horizontal", "vertical"], gatedBy: [{ flag: "image-inspect" }] },
      measure: { states: ["pinned", "selected"], gatedBy: [{ flag: "image-inspect" }] },
      // The "Select text" tool (`image-text`, NIW2-705): the Tool tab's recognition
      // status, and the image with its recognized words while the tool is active.
      textStatus: {
        states: ["pending", "ready", "noText", "unavailable"],
        gatedBy: [{ flag: "image-text" }],
      },
      // `copied`: the selection stays after Copy text, with the toast "Text copied" and how many
      // lines (the toast lives in the app shell, so the shot shows it, not this area).
      textSelection: { states: ["hover", "selected", "copied"], gatedBy: [{ flag: "image-text" }] },
      // The quiet notice at the stage's bottom-left: `reading` while recognition is pending,
      // `unavailable` when it cannot run on this computer. Never an error dialog.
      textNotice: { states: ["reading", "unavailable"], gatedBy: [{ flag: "image-text" }] },
      // The pill on the stage when a saved shot is reopened in canvas mode: `editable` says
      // the document loaded (fades), `flat` that it could not be read (stays until dismissed).
      reopenNotice: { states: ["editable", "flat"], gatedBy: [{ flag: "image-canvas" }] },
      // The redact tool's text targets (NIW2-706, canvas mode): the image while its lines are
      // click targets (a line outlined under the pointer, then hidden), and the Tool tab's hint.
      textHide: {
        states: ["hover", "hidden"],
        gatedBy: [{ flag: "image-text" }, { flag: "image-canvas" }],
      },
      textHideHint: {
        states: ["pending", "ready"],
        gatedBy: [{ flag: "image-text" }, { flag: "image-canvas" }],
      },
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
      root: { states: ["idle", "recording"] },
      header: { states: ["default"] },
      // Idle only: a take replaces the two rows and the Instant line with the status box.
      entries: { states: ["default"] },
      // The three input tiles: toggles while idle, read-only mid-take.
      switches: {
        states: ["idle", "locked"],
        gatedBy: [
          { recordingSetting: "isMicrophoneEnabled" },
          { recordingSetting: "isSystemAudioEnabled" },
          { recordingSetting: "isCameraEnabled" },
        ],
      },
      recordingStatus: { states: ["recording", "paused", "starting"] },
      stopButton: { states: ["recording"] },
      footer: { states: ["default"] },
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
      // One toolbar docked to the work area replaces the action bar, the record widget, the
      // ratio bar and the hint pill (ADR 0056). Screen mode shows one per display.
      captureWidget: {
        states: ["screenshot", "record", "boxAtBottom", "screen", "keyToast", "counting"],
        gatedBy: [
          { recordingSetting: "isMicrophoneEnabled" },
          { recordingSetting: "isSystemAudioEnabled" },
          { recordingSetting: "isCameraEnabled" },
        ],
      },
      // The display badge of Screen mode: number, name, size.
      screenCard: { states: ["default", "highlighted"] },
      windowPicker: { states: ["noWindow", "hovered"] },
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
      root: { states: ["welcome", "permissions", "shortcuts", "done"] },
      welcomeStep: { states: ["default"] },
      demo: { states: ["record", "capture", "share", "editor", "workspaces"] },
      permissionsStep: {
        states: ["none", "all"],
        gatedBy: [
          { permission: "screen" },
          { permission: "microphone" },
          { permission: "camera" },
          { permission: "accessibility" },
        ],
      },
      shortcutsStep: { states: ["none", "someTried"] },
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
