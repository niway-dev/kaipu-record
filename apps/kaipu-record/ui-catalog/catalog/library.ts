import { catalog, type Step } from "../types";
import { nc } from "./not-capturable";

const library: Step = { navigate: "/library" };
const listView: Step = {
  click: { area: "library.toolbar", part: { role: "button", name: "List view" } },
};
const gridView: Step = {
  click: { area: "library.toolbar", part: { role: "button", name: "Gallery view" } },
};

/** The Library (`#/library`) over the demo workspace: six recordings, three screenshots, a GIF. */
export const libraryCatalog = catalog(
  "library",
  {
    grid: {
      profile: "default",
      steps: [library],
      demonstrates: [
        "library.page:items",
        "library.toolbar:default",
        "library.sortMenu:closed",
        "library.kindFilter:all",
        "library.storageFilter:all",
        "library.tagFilter:tags",
        "library.grid:items",
        "library.videoCard:recording",
      ],
      gates: [{ account: "cloud", side: "signed-out" }],
    },
    "grid@min": {
      profile: "default",
      window: "main-min",
      steps: [library],
      demonstrates: ["library.page:items", "library.grid:items"],
    },
    "card-screenshot": {
      profile: "default",
      steps: [library],
      demonstrates: ["library.videoCard:screenshot"],
      crops: { "library.videoCard": { hasText: "Settings page" } },
    },
    "card-webcam": {
      profile: "default",
      how: "Open the Library: “Release demo” has a webcam track, so its thumbnail is redrawn with the bubble once the app has composited it. The shot waits for that.",
      steps: [
        library,
        // The composite is written in the background; `done` is stamped once the vault has it.
        {
          waitFor: {
            area: "library.videoCard",
            part: { css: '[data-webcam-thumbnail="done"] img[src*="?v="]' },
          },
          timeoutMs: 30_000,
        },
        // Below the fold at the catalog's window size: a crop is clipped to the window.
        { scrollTo: { area: "library.videoCard", hasText: "Release demo" } },
      ],
      demonstrates: ["library.videoCard:webcam"],
      embedsScreen: true,
      crops: { "library.videoCard": { hasText: "Release demo" } },
    },
    "card-gif": {
      profile: "default",
      steps: [library, { scrollTo: { area: "library.videoCard", hasText: "Loop preview" } }],
      demonstrates: ["library.videoCard:gif"],
      crops: { "library.videoCard": { hasText: "Loop preview" } },
    },
    "sort-menu": {
      profile: "default",
      steps: [library, { click: { area: "library.sortMenu", part: { css: "button" } } }],
      demonstrates: ["library.sortMenu:open", "library.sortOptions:open"],
      after: [{ press: "Escape", on: "main" }],
    },
    recordings: {
      profile: "default",
      steps: [library, { click: { area: "library.kindFilter", part: { text: "Recordings (" } } }],
      demonstrates: ["library.kindFilter:recordings"],
    },
    screenshots: {
      profile: "default",
      steps: [library, { click: { area: "library.kindFilter", part: { text: "Screenshots (" } } }],
      demonstrates: ["library.kindFilter:screenshots"],
    },
    local: {
      profile: "default",
      steps: [library, { click: { area: "library.storageFilter", part: { text: "Local" } } }],
      demonstrates: ["library.storageFilter:local"],
      gates: [{ account: "cloud", side: "signed-out" }],
    },
    cloud: {
      profile: "default",
      how: "Pick the Cloud storage filter while signed out: nothing matches.",
      steps: [library, { click: { area: "library.storageFilter", part: { text: "Cloud" } } }],
      demonstrates: [
        "library.storageFilter:cloud",
        "library.page:noMatch",
        "library.emptyState:noMatch",
      ],
      gates: [{ account: "cloud", side: "signed-out" }],
    },
    list: {
      profile: "default",
      steps: [library, listView],
      demonstrates: ["library.list:items", "library.videoRow:recording"],
      crops: { "library.videoRow": { hasText: "Release demo" } },
      after: [gridView],
    },
    "row-screenshot": {
      profile: "default",
      steps: [library, listView],
      demonstrates: ["library.videoRow:screenshot"],
      crops: { "library.videoRow": { hasText: "Settings page" } },
      after: [gridView],
    },
    "tag-panel-item": {
      profile: "default",
      steps: [
        library,
        {
          click: {
            area: "library.videoCard",
            hasText: "Release demo",
            part: { role: "button", name: "Tags" },
          },
        },
      ],
      demonstrates: ["library.tagPanel:item", "library.videoCard:selected"],
      ready: { area: "library.tagPanel" },
      crops: { "library.videoCard": { hasText: "Release demo" } },
      after: [{ press: "Escape", on: "main" }],
    },
    "tag-panel-all": {
      profile: "default",
      steps: [
        library,
        { click: { area: "library.tagFilter", part: { role: "button", name: "Manage tags" } } },
      ],
      demonstrates: ["library.tagPanel:all"],
      ready: { area: "library.tagPanel" },
      after: [{ press: "Escape", on: "main" }],
    },
    "row-selected": {
      profile: "default",
      steps: [
        library,
        listView,
        {
          click: {
            area: "library.videoRow",
            hasText: "Release demo",
            part: { role: "button", name: "Tags" },
          },
        },
      ],
      demonstrates: ["library.videoRow:selected"],
      ready: { area: "library.tagPanel" },
      crops: { "library.videoRow": { hasText: "Release demo" } },
      after: [{ press: "Escape", on: "main" }, gridView],
    },
    selecting: {
      profile: "default",
      steps: [
        library,
        { click: { area: "library.page", part: { role: "button", name: "Select" } } },
        { click: { area: "library.videoCard", hasText: "Team notes", part: { role: "checkbox" } } },
      ],
      demonstrates: ["library.selectionBar:selecting"],
      after: [
        { click: { area: "library.page", part: { role: "button", name: "Done", exact: true } } },
      ],
    },
    "no-match": {
      profile: "default",
      steps: [library, { fill: { area: "library.toolbar", part: { css: "input" } }, value: "zzz" }],
      demonstrates: ["library.page:noMatch", "library.emptyState:noMatch"],
    },
    empty: {
      profile: "empty",
      steps: [library],
      demonstrates: ["library.page:empty", "library.emptyState:empty", "library.tagFilter:noTags"],
    },
    "reconcile-fixable": {
      profile: "reconcile-fixable",
      steps: [library],
      demonstrates: ["library.reconcileBanner:fixable"],
    },
    "reconcile-attention": {
      profile: "reconcile-attention",
      steps: [library],
      demonstrates: ["library.reconcileBanner:attention"],
    },
    "workspace-not-connected": {
      profile: "disconnected",
      steps: [library],
      demonstrates: ["library.workspaceNotice:notConnected"],
    },
    error: {
      profile: "default",
      how: "Make the workspace folder unreadable (`chmod 000`) and open the Library again: listing it fails, as with an unreachable drive.",
      steps: [
        { action: "lockVault" },
        { navigate: "/settings/general" },
        { navigate: "/library" },
        { waitFor: { area: "library.emptyState", part: { text: "Retry" } } },
      ],
      demonstrates: ["library.page:error", "library.emptyState:error"],
      ready: { area: "library.emptyState" },
      after: [{ action: "unlockVault" }],
    },
  },
  {
    notCapturable: {
      "library.page:loading": nc("transient", "a transient state while the vault is listed"),
      "library.emptyState:loading": nc("transient", "a transient state while the vault is listed"),
      "library.videoCard:cloudOnly": nc(
        "needsApi",
        "needs a cloud-only item; the catalog runs offline",
      ),
      "library.readyCopyCard:ready": nc(
        "needsSetup",
        "shown only right after an export makes a copy",
      ),
      "library.selectionBar:moving": nc(
        "transient",
        "a transient state while items move between workspaces",
      ),
    },
    oneSided: {
      "library.storageFilter":
        "the cloud side needs a signed-in cloud account; the catalog runs offline",
    },
  },
);
