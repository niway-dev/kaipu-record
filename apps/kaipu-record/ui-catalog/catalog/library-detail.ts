import { ASSETS } from "../fixtures/seed-vault";
import { catalog, type Step } from "../types";
import { nc } from "./not-capturable";

const detail = (assetId: string) => ({ navigate: `/library/${assetId}` }) as const;
/** Clicks a tab of the item panel by its English name ("Versions", "Details"). */
const tab = (name: string): Step => ({
  click: { area: "libraryDetail.tabs", part: { role: "tab", name } },
});
/** Opens the ••• menu in the header's actions. */
const moreActions: Step = {
  click: { area: "libraryDetail.actions", part: { role: "button", name: "More actions" } },
};

/** An item's page (`#/library/:assetId`), opened on the seeded items by their fixed ids. */
export const libraryDetail = catalog(
  "libraryDetail",
  {
    recording: {
      profile: "default",
      how: "Open “Walkthrough 1”, a recording with copies made from it: the Versions tab leads.",
      steps: [detail(ASSETS.walkthrough)],
      demonstrates: [
        "libraryDetail.page:recording",
        "libraryDetail.header:recording",
        "libraryDetail.details:recording",
        "libraryDetail.preview:video",
        "libraryDetail.actions:recording",
        "libraryDetail.tabs:versions",
        "libraryDetail.versions:withCopies",
      ],
      ready: { video: "paused-at-start" },
    },
    "recording-no-copies": {
      profile: "default",
      how: "Open “Onboarding flow”, a recording with no copies yet: “Where is it going?” leads.",
      steps: [detail(ASSETS.onboardingFlow)],
      demonstrates: ["libraryDetail.tabs:destinations", "libraryDetail.destinations:ready"],
      ready: { video: "paused-at-start" },
    },
    "versions-original": {
      profile: "default",
      how: "Open “Onboarding flow” and click the Versions tab: only the original, no copy yet.",
      steps: [detail(ASSETS.onboardingFlow), tab("Versions")],
      demonstrates: ["libraryDetail.tabs:versions", "libraryDetail.versions:original"],
      ready: { video: "paused-at-start" },
    },
    "versions-edited": {
      profile: "default",
      how: "Open “Team notes” and click the Versions tab: the original and its saved edit session.",
      steps: [detail(ASSETS.teamNotes), tab("Versions")],
      demonstrates: ["libraryDetail.versions:edited"],
      ready: { video: "paused-at-start" },
    },
    edited: {
      profile: "default",
      how: "Open “Team notes”, whose saved edit session (a zoom, a muted range) was never exported.",
      steps: [detail(ASSETS.teamNotes)],
      demonstrates: ["libraryDetail.details:edited"],
      ready: { video: "paused-at-start" },
    },
    screenshot: {
      profile: "default",
      how: "Open “Settings page”, a saved screenshot.",
      steps: [detail(ASSETS.settingsShot)],
      demonstrates: [
        "libraryDetail.page:screenshot",
        "libraryDetail.header:screenshot",
        "libraryDetail.preview:image",
        "libraryDetail.actions:screenshot",
      ],
    },
    "screenshot-hover": {
      profile: "default",
      how: "Open “Settings page” and rest the pointer on the image: the copy button shows in its top-right corner.",
      steps: [detail(ASSETS.settingsShot), { hover: { area: "libraryDetail.preview" } }],
      demonstrates: ["libraryDetail.preview:imageHover"],
      keepPointer: true,
    },
    "details-screenshot": {
      profile: "default",
      how: "Open “Settings page” and click the Details tab.",
      steps: [detail(ASSETS.settingsShot), tab("Details")],
      demonstrates: ["libraryDetail.tabs:details", "libraryDetail.itemDetails:screenshot"],
    },
    gif: {
      profile: "default",
      how: "Open “Loop preview”, a GIF made from “Walkthrough 1 (light)”.",
      steps: [detail(ASSETS.loopGif)],
      demonstrates: [
        "libraryDetail.page:gif",
        "libraryDetail.header:gif",
        "libraryDetail.preview:gif",
        "libraryDetail.actions:gif",
        "libraryDetail.details:copy",
      ],
    },
    "details-gif": {
      profile: "default",
      how: "Open “Loop preview” and click the Details tab.",
      steps: [detail(ASSETS.loopGif), tab("Details")],
      demonstrates: ["libraryDetail.itemDetails:gif"],
    },
    "details-recording": {
      profile: "default",
      how: "Open “Walkthrough 1” and click the Details tab: the file's facts.",
      steps: [detail(ASSETS.walkthrough), tab("Details")],
      demonstrates: ["libraryDetail.tabs:details", "libraryDetail.itemDetails:recording"],
      ready: { video: "paused-at-start" },
    },
    "light-copy": {
      profile: "default",
      how: "Open “Walkthrough 1 (light)”, a copy of “Walkthrough 1” that has a GIF made from it.",
      steps: [detail(ASSETS.lightCopy)],
      demonstrates: ["libraryDetail.versions:copy", "libraryDetail.tabs:versions"],
      ready: { video: "paused-at-start" },
    },
    "menu-open": {
      profile: "default",
      how: "Open “Walkthrough 1” and click the ••• button (More actions).",
      steps: [detail(ASSETS.walkthrough), moreActions],
      demonstrates: ["libraryDetail.itemMenu:open"],
      ready: { area: "libraryDetail.itemMenu" },
      after: [{ press: "Escape", on: "main" }],
    },
    "saved-notice": {
      profile: "recording",
      embedsScreen: true,
      how: "Record a 3 s take of the first display and stop it: the app opens the new recording's page.",
      steps: [
        { action: "selectFirstScreen" },
        { action: "startTake" },
        { waitMs: 3_000 },
        { action: "stopTake" },
        { show: "main" },
        { waitFor: { area: "libraryDetail.savedNotice" }, timeoutMs: 20_000 },
      ],
      demonstrates: ["libraryDetail.savedNotice:shown"],
    },
  },
  {
    notCapturable: {
      "libraryDetail.missing:notFound": nc(
        "needsSetup",
        "drawn for one frame at most: a missing item re-lists once, then the page falls back to the Library (use-missing-recording-recovery.ts)",
      ),
      "libraryDetail.page:loading": nc("transient", "a transient state before the item is listed"),
      "libraryDetail.details:stale": nc(
        "needsSetup",
        "needs an export of an edit that was edited again afterwards",
      ),
      "libraryDetail.preview:unavailable": nc(
        "needsApi",
        "needs a cloud-only item; the catalog runs offline",
      ),
      "libraryDetail.header:cloudOnly": nc(
        "needsApi",
        "needs a cloud-only item; the catalog runs offline",
      ),
      "libraryDetail.actions:cloudOnly": nc(
        "needsApi",
        "needs a cloud-only item; the catalog runs offline",
      ),
      "libraryDetail.versions:running": nc(
        "transient",
        "a transient state while a copy is exported",
      ),
      "libraryDetail.versions:sourceDeleted": nc(
        "needsSetup",
        "needs a copy whose original was deleted; the seeded vault keeps every original",
      ),
      "libraryDetail.destinations:heavy": nc(
        "needsSetup",
        "needs a recording over 25 MB; the catalog's takes are seconds long",
      ),
      "libraryDetail.postRecordingCard:fresh": nc(
        "needsSetup",
        "shown only after a take heavier than 10 MB; the catalog's takes are seconds long",
      ),
    },
    oneSided: {
      "libraryDetail.postRecordingCard": "with the setting off, no card is drawn",
    },
  },
);
