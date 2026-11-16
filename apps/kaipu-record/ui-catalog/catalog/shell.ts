import { ASSETS } from "../fixtures/seed-vault";
import { catalog, type Step } from "../types";
import { nc } from "./not-capturable";

/** Open “Walkthrough 1” in Export, pick a destination and press its Export button. */
const startExport = (destination: string, options: Step[] = []): Step[] => [
  { navigate: `/export/${ASSETS.walkthrough}` },
  { click: { area: "export.destinationRow", part: { role: "radio", name: destination } } },
  ...options,
  { click: { area: "export.stage", part: { role: "button", name: "Export for" } } },
];

/**
 * Chrome around every route: the title bar, the sidebar, the status bar, banners and the
 * app-wide dialogs. Shot over the Record page (`#/`) unless a step navigates; only shell
 * areas are cropped, so a Record area never lands in this screen's folder.
 */
export const shell = catalog(
  "shell",
  {
    home: {
      profile: "default",
      how: "Open the app: the one-time workspaces hint is still up.",
      demonstrates: [
        "shell.titleBar:withSwitcher",
        "shell.historyArrows:atStart",
        "shell.workspaceSwitcher:hint",
        "shell.sidebar:rest",
        "shell.statusBar:default",
      ],
    },
    "workspace-menu": {
      profile: "default",
      steps: [
        {
          click: { area: "shell.workspaceSwitcher", part: { role: "button", name: "Workspace:" } },
        },
      ],
      demonstrates: ["shell.workspaceMenu:open"],
      after: [{ press: "Escape", on: "main" }],
    },
    "workspace-dialog-new": {
      profile: "default",
      steps: [
        {
          click: { area: "shell.workspaceSwitcher", part: { role: "button", name: "Workspace:" } },
        },
        { click: { area: "shell.workspaceMenu", part: { text: "New workspace" } } },
      ],
      demonstrates: ["shell.workspaceDialog:new"],
      after: [{ press: "Escape", on: "main" }],
    },
    "workspace-dialog-edit": {
      profile: "default",
      steps: [
        { navigate: "/settings/workspaces" },
        { click: { area: "settingsWorkspaces.list", part: { role: "button", name: "Edit" } } },
      ],
      demonstrates: ["shell.workspaceDialog:edit"],
      after: [{ press: "Escape", on: "main" }],
    },
    // A real router navigation (a sidebar click, not a hash change) lights up Back.
    "history-back": {
      profile: "default",
      steps: [{ click: { area: "shell.sidebar", part: { role: "link", name: "Library" } } }],
      demonstrates: ["shell.historyArrows:canGoBack"],
    },
    "settings-nav": {
      profile: "default",
      steps: [{ navigate: "/settings/general" }],
      demonstrates: ["shell.settingsNav:default"],
    },
    "not-found": {
      profile: "default",
      steps: [{ navigate: "/no-such-page" }],
      demonstrates: ["shell.notFound:default"],
    },
    // Last in the profile: the hint is dismissed for good.
    "hint-dismissed": {
      profile: "default",
      steps: [{ call: "workspaces.dismissHint" }],
      demonstrates: ["shell.workspaceSwitcher:closed"],
    },
    "title-bar-onboarding": {
      profile: "onboarding",
      how: "First launch: the onboarding takeover hides the workspace switcher.",
      demonstrates: ["shell.titleBar:default"],
    },
    "not-connected": {
      profile: "disconnected",
      demonstrates: ["shell.workspaceSwitcher:notConnected"],
    },
    "reconcile-list": {
      profile: "reconcile-fixable",
      steps: [
        { navigate: "/library" },
        {
          click: {
            area: "library.reconcileBanner",
            part: { role: "button", name: "Check and fix" },
          },
        },
      ],
      demonstrates: ["shell.reconcileDialog:list"],
      after: [{ press: "Escape", on: "main" }],
    },
    "reconcile-report": {
      profile: "reconcile-fixable",
      how: "Open Check and fix from the Library banner and press Fix all: the mismatched file is renamed in the throwaway vault.",
      steps: [
        { navigate: "/library" },
        {
          click: {
            area: "library.reconcileBanner",
            part: { role: "button", name: "Check and fix" },
          },
        },
        { click: { area: "shell.reconcileDialog", part: { role: "button", name: "Fix all" } } },
        { waitFor: { area: "shell.reconcileDialog", part: { text: "Done." } } },
      ],
      demonstrates: ["shell.reconcileDialog:report"],
      // The Library scans once per session: after the files are back, a reload makes it look again.
      after: [
        { press: "Escape", on: "main" },
        { action: "restoreVault" },
        { action: "reloadMain" },
      ],
    },
    locked: {
      profile: "recording",
      how: "Start a take on the first display and show the main window again: switching is locked.",
      // The recording profile launches with the one-time workspaces hint up; it goes away on its
      // own at some point during a take, so a shot taken before that has it and the next does not.
      steps: [
        { call: "workspaces.dismissHint" },
        { action: "selectFirstScreen" },
        { action: "startTake" },
        { show: "main" },
      ],
      demonstrates: ["shell.workspaceSwitcher:locked"],
      after: [{ action: "stopTake" }],
    },
    "export-running": {
      profile: "exporting",
      how: "Pick YouTube at 4K in Export for “Walkthrough 1” and press Export: shot while the encode runs, then cancelled so nothing reaches the Library.",
      steps: [
        ...startExport("YouTube", [{ click: { area: "export.stage", part: { text: "4K" } } }]),
        { waitFor: { area: "shell.exportCard", part: { role: "progressbar" } } },
      ],
      stillOnScreen: { area: "shell.exportCard", part: { role: "progressbar" } },
      demonstrates: ["shell.exportCard:progress", "shell.sidebar:exportBadge"],
      ready: { area: "shell.exportCard" },
      after: [
        { click: { area: "shell.exportCard", part: { role: "button", name: "Cancel" } } },
        { waitFor: { area: "shell.exportCard", state: "hidden" } },
      ],
    },
    "export-ready": {
      profile: "exporting",
      how: "Pick Slack · Discord · Email in Export for “Walkthrough 1” and press Export: shot once the copy is done.",
      steps: [
        ...startExport("Slack"),
        {
          waitFor: { area: "shell.exportCard", part: { text: "Chat copy ready" } },
          timeoutMs: 60_000,
        },
      ],
      demonstrates: ["shell.exportCard:ready"],
      ready: { area: "shell.exportCard" },
      after: [
        {
          click: {
            area: "shell.exportCard",
            part: { role: "button", name: "Close", exact: true },
          },
        },
        { waitFor: { area: "shell.exportCard", state: "hidden" } },
        { action: "restoreVault" },
      ],
    },
    "export-error": {
      profile: "two-recordings",
      how: "Open “Missing recording” in the editor, press Export and confirm: its joined recording “Old standup” is not in the vault, so the export stops before it encodes anything and the card names the recording.",
      steps: [
        { navigate: `/editor/video/${ASSETS.joinedMissingDemo}` },
        { waitFor: { video: true } },
        {
          click: {
            area: "editorVideo.toolbar",
            part: { role: "button", name: "Export", exact: true },
          },
        },
        { click: { area: "editorVideo.exportSheet", part: { role: "button", name: "Export" } } },
        { waitFor: { area: "shell.exportCard", part: { text: "Old standup" } } },
      ],
      demonstrates: ["shell.exportCard:error"],
      ready: { area: "shell.exportCard" },
      after: [
        {
          click: {
            area: "shell.exportCard",
            part: { role: "button", name: "Close", exact: true },
          },
        },
        { waitFor: { area: "shell.exportCard", state: "hidden" } },
      ],
    },
  },
  {
    notCapturable: {
      "shell.updateBanner:ready": nc(
        "needsApi",
        "needs a downloaded update; an unpackaged build has no update feed",
      ),
      "shell.versionBanner:soft": nc(
        "needsApi",
        "the version gate reads the API; the catalog runs offline",
      ),
      "shell.versionOverlay:hard": nc(
        "needsApi",
        "the version gate reads the API; the catalog runs offline",
      ),
      "shell.reconcileDialog:scanning": nc(
        "transient",
        "a transient state while the folder is read",
      ),
      "shell.reconcileDialog:fixing": nc("transient", "a transient state while files are renamed"),
      "shell.routeError:default": nc(
        "inducedFailure",
        "drawn only when a page throws while rendering",
      ),
    },
  },
);
