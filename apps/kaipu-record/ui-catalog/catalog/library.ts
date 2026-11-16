import { catalog, type Part, type Step } from "../types";
import { nc } from "./not-capturable";

const library: Step = { navigate: "/library" };
const listView: Step = {
  click: { area: "library.toolbar", part: { role: "button", name: "List view" } },
};
const gridView: Step = {
  click: { area: "library.toolbar", part: { role: "button", name: "Gallery view" } },
};

const transcribeOn = { flag: "transcription", side: "on" } as const;

/**
 * The Transcribe action of a card (`library.videoCardTranscribe`) or a row
 * (`library.videoRowTranscribe`). It is drawn once the speech model status is read, so a state
 * waits for it. An idle or needs-model button shows only while the card or row is hovered.
 */
const control = (kind: "Card" | "Row") => {
  const area = `library.video${kind}Transcribe` as const;
  const button: Part = { role: "button", name: "Transcribe", exact: true };
  return {
    area,
    present: { waitFor: { area } } satisfies Step,
    hover: { hover: { area } } satisfies Step,
    click: { click: { area, part: button } } satisfies Step,
    running: {
      waitFor: { area, part: { text: "Transcribing 3/12" } },
    } satisfies Step,
    /** Cancels the pinned job and waits for the progress to go, so the next state starts idle. */
    cancel: [
      { click: { area, part: { role: "button", name: "Cancel transcription", exact: true } } },
      { waitFor: { area, part: { role: "status" }, state: "hidden" } },
    ] satisfies Step[],
  };
};
const card = control("Card");
const row = control("Row");
const dialog = "library.transcribeModelDialog" as const;
/** Closes the speech model offer with its own button. */
const closeOffer: Step = {
  click: { area: dialog, part: { role: "button", name: "Not now", exact: true } },
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
      gates: [
        { account: "cloud", side: "signed-out" },
        { flag: "transcription", side: "off" },
      ],
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
    "card-transcribe-needs-model": {
      profile: "transcription-missing",
      how: "With the flag forced on and the speech model pinned as not installed, rest the pointer on the first recording's card: its Transcribe button shows. A click opens the download offer.",
      steps: [library, card.present, card.hover],
      demonstrates: ["library.videoCardTranscribe:needsModel"],
      gates: [transcribeOn],
      keepPointer: true,
    },
    "card-transcribe-ready": {
      profile: "transcription-ready",
      how: "With the flag forced on and the speech model pinned as installed, rest the pointer on the first recording's card: its Transcribe button shows.",
      steps: [library, card.present, card.hover],
      demonstrates: ["library.videoCardTranscribe:ready"],
      gates: [transcribeOn],
      keepPointer: true,
    },
    "card-transcribe-running": {
      profile: "transcription-job-running",
      how: "With a job pinned at 3 of 12 parts (no engine runs), click Transcribe on the first recording's card: the card shows “Transcribing 3/12” and a Cancel button. The state cancels the job afterwards.",
      steps: [library, card.present, card.click, card.running],
      demonstrates: ["library.videoCardTranscribe:running"],
      crops: { "library.videoCardTranscribe": { hasText: "Transcribing" } },
      gates: [transcribeOn],
      after: card.cancel,
    },
    "card-transcribe-done": {
      profile: "transcription-transcripts",
      how: "With transcripts beside four recordings, “Walkthrough 1” and “Release demo” show the Transcribed badge.",
      steps: [library, { waitFor: { area: card.area, part: { text: "Transcribed" } } }],
      demonstrates: ["library.videoCardTranscribe:done"],
      crops: { "library.videoCardTranscribe": { hasText: "Transcribed" } },
      gates: [transcribeOn],
    },
    "row-transcribe-needs-model": {
      profile: "transcription-missing",
      how: "With the speech model pinned as not installed, switch to the list and rest the pointer on the first recording's row: its Transcribe button shows.",
      steps: [library, listView, row.present, row.hover],
      demonstrates: ["library.videoRowTranscribe:needsModel"],
      gates: [transcribeOn],
      keepPointer: true,
      after: [gridView],
    },
    "row-transcribe-ready": {
      profile: "transcription-ready",
      how: "With the speech model pinned as installed, switch to the list and rest the pointer on the first recording's row: its Transcribe button shows.",
      steps: [library, listView, row.present, row.hover],
      demonstrates: ["library.videoRowTranscribe:ready"],
      gates: [transcribeOn],
      keepPointer: true,
      after: [gridView],
    },
    "row-transcribe-running": {
      profile: "transcription-job-running",
      how: "With a job pinned at 3 of 12 parts (no engine runs), switch to the list and click Transcribe on the first recording's row: the row shows “Transcribing 3/12” and a Cancel button. The state cancels the job afterwards.",
      steps: [library, listView, row.present, row.click, row.running],
      demonstrates: ["library.videoRowTranscribe:running"],
      crops: { "library.videoRowTranscribe": { hasText: "Transcribing" } },
      gates: [transcribeOn],
      after: [...row.cancel, gridView],
    },
    "row-transcribe-done": {
      profile: "transcription-transcripts",
      how: "With transcripts beside four recordings, switch to the list: “Walkthrough 1” and “Release demo” show the Transcribed badge.",
      steps: [library, listView, { waitFor: { area: row.area, part: { text: "Transcribed" } } }],
      demonstrates: ["library.videoRowTranscribe:done"],
      crops: { "library.videoRowTranscribe": { hasText: "Transcribed" } },
      gates: [transcribeOn],
      after: [gridView],
    },
    "transcribe-model-dialog": {
      profile: "transcription-missing",
      how: "With the speech model pinned as not installed, click Transcribe on the first recording's card: the dialog offers the download. The state closes it with Not now.",
      steps: [library, card.present, card.click],
      demonstrates: ["library.transcribeModelDialog:open"],
      ready: { area: dialog },
      gates: [transcribeOn],
      after: [closeOffer, { waitFor: { area: dialog, state: "hidden" } }],
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
