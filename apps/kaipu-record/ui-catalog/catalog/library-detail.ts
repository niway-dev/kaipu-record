import { ASSETS } from "../fixtures/seed-vault";
import { catalog, type Part, type Step } from "../types";
import { nc } from "./not-capturable";

const detail = (assetId: string) => ({ navigate: `/library/${assetId}` }) as const;
/** Clicks a tab of the item panel by its English name ("Copies", "Details"). */
const tab = (name: string): Step => ({
  click: { area: "libraryDetail.tabs", part: { role: "tab", name } },
});
/** Opens the ••• menu in the header's actions. */
const moreActions: Step = {
  click: { area: "libraryDetail.actions", part: { role: "button", name: "More actions" } },
};

const transcribeOn = { flag: "transcription", side: "on" } as const;
/** The Transcribe action beside the header's other buttons, drawn once the model status is read. */
const transcribePresent: Step = { waitFor: { area: "libraryDetail.transcribe" } };
const transcribeClick: Step = {
  click: {
    area: "libraryDetail.transcribe",
    part: { role: "button", name: "Transcribe", exact: true },
  },
};
const dialog = "libraryDetail.transcribeModelDialog" as const;

/** The Transcript tab's panel (NIW2-870). The tab is clicked AFTER the page opens: it is the page's. */
const transcriptTab: Step = tab("Transcript");
const inTranscript = (part: Part): Step => ({
  waitFor: { area: "libraryDetail.transcriptPanel", part },
});
const transcriptButton = (name: string): Part => ({ role: "button", name, exact: true });

/** An item's page (`#/library/:assetId`), opened on the seeded items by their fixed ids. */
export const libraryDetail = catalog(
  "libraryDetail",
  {
    recording: {
      profile: "default",
      how: "Open “Walkthrough 1”, a recording with copies made from it: the Copies tab leads.",
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
      gates: [{ flag: "transcription", side: "off" }],
    },
    "transcribe-needs-model": {
      profile: "transcription-missing",
      how: "With the flag forced on and the speech model pinned as not installed, open “Walkthrough 1”: Transcribe sits in the header, and a click opens the download offer.",
      steps: [detail(ASSETS.walkthrough), transcribePresent],
      demonstrates: ["libraryDetail.transcribe:needsModel"],
      ready: { video: "paused-at-start" },
      gates: [transcribeOn],
    },
    "transcribe-ready": {
      profile: "transcription-ready",
      how: "With the flag forced on and the speech model pinned as installed, open “Walkthrough 1”: Transcribe sits in the header.",
      steps: [detail(ASSETS.walkthrough), transcribePresent],
      demonstrates: ["libraryDetail.transcribe:ready"],
      ready: { video: "paused-at-start" },
      gates: [transcribeOn],
    },
    "transcribe-running": {
      profile: "transcription-job-running",
      how: "With a job pinned at 3 of 12 parts (no engine runs), open “Walkthrough 1” and click Transcribe: the header shows “Transcribing 3/12” and a Cancel button. The state cancels the job afterwards.",
      steps: [
        detail(ASSETS.walkthrough),
        transcribePresent,
        transcribeClick,
        { waitFor: { area: "libraryDetail.transcribe", part: { text: "Transcribing 3/12" } } },
      ],
      demonstrates: ["libraryDetail.transcribe:running"],
      ready: { video: "paused-at-start" },
      gates: [transcribeOn],
      after: [
        {
          click: {
            area: "libraryDetail.transcribe",
            part: { role: "button", name: "Cancel transcription", exact: true },
          },
        },
        {
          waitFor: {
            area: "libraryDetail.transcribe",
            part: { role: "status" },
            state: "hidden",
          },
        },
      ],
    },
    "transcribe-done": {
      profile: "transcription-transcripts",
      how: "With a transcript beside “Walkthrough 1”, open it: the header shows the Transcribed badge.",
      steps: [
        detail(ASSETS.walkthrough),
        { waitFor: { area: "libraryDetail.transcribe", part: { text: "Transcribed" } } },
      ],
      demonstrates: ["libraryDetail.transcribe:done"],
      ready: { video: "paused-at-start" },
      gates: [transcribeOn],
    },
    "transcript-idle": {
      profile: "transcription-ready",
      how: "With the flag forced on and the speech model pinned as installed, open “Walkthrough 1”, which has no transcript, and click the Transcript tab: the panel offers Transcribe now.",
      steps: [
        detail(ASSETS.walkthrough),
        transcribePresent,
        transcriptTab,
        inTranscript(transcriptButton("Transcribe now")),
      ],
      demonstrates: ["libraryDetail.transcriptPanel:idle"],
      ready: { video: "paused-at-start" },
      gates: [transcribeOn],
    },
    "transcript-needs-model": {
      profile: "transcription-missing",
      how: "With the speech model pinned as not installed, open “Walkthrough 1” and click the Transcript tab: the panel explains the speech model and offers to download it.",
      steps: [
        detail(ASSETS.walkthrough),
        transcribePresent,
        transcriptTab,
        inTranscript(transcriptButton("Download the speech model")),
      ],
      demonstrates: ["libraryDetail.transcriptPanel:needsModel"],
      ready: { video: "paused-at-start" },
      gates: [transcribeOn],
    },
    "transcript-running": {
      profile: "transcription-job-running",
      how: "With a job pinned at 3 of 12 parts (no engine runs), open “Walkthrough 1”, click the Transcript tab and then Transcribe now: the panel shows the progress bar with Cancel, and the header says “Transcribing 3/12”. The state cancels the job afterwards.",
      steps: [
        detail(ASSETS.walkthrough),
        transcribePresent,
        transcriptTab,
        inTranscript(transcriptButton("Transcribe now")),
        {
          click: {
            area: "libraryDetail.transcriptPanel",
            part: transcriptButton("Transcribe now"),
          },
        },
        inTranscript({ role: "progressbar" }),
        inTranscript({ text: "3 of 12 parts" }),
        // The header and the tab read one job: both show it (spec failure 4).
        { waitFor: { area: "libraryDetail.transcribe", part: { text: "Transcribing 3/12" } } },
      ],
      demonstrates: ["libraryDetail.transcriptPanel:transcribing"],
      ready: { video: "paused-at-start" },
      gates: [transcribeOn],
      after: [
        { click: { area: "libraryDetail.transcriptPanel", part: transcriptButton("Cancel") } },
        inTranscript(transcriptButton("Transcribe now")),
      ],
    },
    "transcript-done": {
      profile: "transcription-transcripts",
      how: "With a transcript beside “Walkthrough 1”, open it and click the Transcript tab: the words show in two paragraphs with their times, and the tab is selected in the row.",
      steps: [detail(ASSETS.walkthrough), transcriptTab, inTranscript({ css: "[data-w]" })],
      demonstrates: ["libraryDetail.transcriptPanel:done", "libraryDetail.tabs:transcript"],
      ready: { video: "paused-at-start" },
      gates: [transcribeOn],
    },
    "transcript-stale": {
      profile: "transcription-transcripts",
      how: "With a transcript beside “Onboarding flow” that was written for an earlier version of the recording, open it and click the Transcript tab: a banner says the transcript is out of date over the old words.",
      steps: [
        detail(ASSETS.onboardingFlow),
        transcriptTab,
        inTranscript({ css: "[data-w]" }),
        inTranscript({ text: "This transcript is out of date" }),
      ],
      demonstrates: ["libraryDetail.transcriptPanel:stale"],
      ready: { video: "paused-at-start" },
      gates: [transcribeOn],
    },
    "transcript-stale-rerunning": {
      profile: "transcription-job-running-transcripts",
      how: "With a transcript beside “Onboarding flow” that was written for an earlier version of the recording and a job pinned at 3 of 12 parts (no engine runs), open it, click the Transcript tab and then Transcribe again: the out-of-date banner stays over the old words and now carries the progress bar with Cancel. The state cancels the job afterwards.",
      steps: [
        detail(ASSETS.onboardingFlow),
        transcriptTab,
        inTranscript({ css: "[data-w]" }),
        inTranscript(transcriptButton("Transcribe again")),
        {
          click: {
            area: "libraryDetail.transcriptPanel",
            part: transcriptButton("Transcribe again"),
          },
        },
        inTranscript({ role: "progressbar" }),
        inTranscript({ text: "3 of 12 parts" }),
        inTranscript({ text: "This transcript is out of date" }),
      ],
      demonstrates: ["libraryDetail.transcriptPanel:staleRerunning"],
      ready: { video: "paused-at-start" },
      gates: [transcribeOn],
      after: [
        { click: { area: "libraryDetail.transcriptPanel", part: transcriptButton("Cancel") } },
        inTranscript(transcriptButton("Transcribe again")),
      ],
    },
    "transcribe-model-dialog": {
      profile: "transcription-missing",
      how: "With the speech model pinned as not installed, open “Walkthrough 1” and click Transcribe: the dialog offers the download. The state closes it with Not now.",
      steps: [detail(ASSETS.walkthrough), transcribePresent, transcribeClick],
      demonstrates: ["libraryDetail.transcribeModelDialog:open"],
      ready: { area: dialog },
      gates: [transcribeOn],
      after: [
        { click: { area: dialog, part: { role: "button", name: "Not now", exact: true } } },
        { waitFor: { area: dialog, state: "hidden" } },
      ],
    },
    "recording-no-copies": {
      profile: "default",
      how: "Open “Onboarding flow”, a recording with no copies yet: the Export tab leads.",
      steps: [detail(ASSETS.onboardingFlow)],
      demonstrates: ["libraryDetail.tabs:destinations", "libraryDetail.destinations:ready"],
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
    captures: {
      profile: "default",
      how: "Open “Weekly sync” in the editor, press Capture frame, then open the recording's page and its Captures (1) tab: it lists the frame with its time and a Copy button.",
      steps: [
        { navigate: `/editor/video/${ASSETS.weeklySync}` },
        { waitFor: { video: true } },
        {
          click: {
            area: "editorVideo.toolRail",
            part: { role: "button", name: "Captures", exact: true },
          },
        },
        {
          click: {
            area: "editorVideo.capturesPanel",
            part: { role: "button", name: "Capture frame", exact: true },
          },
        },
        { waitFor: { area: "editorVideo.capturesPanel", part: { role: "button", name: "Go to" } } },
        detail(ASSETS.weeklySync),
        tab("Captures (1)"),
        { waitFor: { area: "libraryDetail.captures" } },
        // The image decodes after the section is drawn.
        { waitMs: 400 },
      ],
      demonstrates: ["libraryDetail.captures:list", "libraryDetail.tabs:captures"],
      ready: { video: "paused-at-start" },
      // The capture is a new file in the workspace: put the vault back for the next state.
      after: [{ action: "restoreVault" }],
    },
    "capture-source": {
      profile: "default",
      how: "Open “Weekly sync” in the editor, capture a frame from the Captures panel, then open the recording's page, its Captures (1) tab and the capture itself: its page says which video it came from and at what time.",
      steps: [
        { navigate: `/editor/video/${ASSETS.weeklySync}` },
        { waitFor: { video: true } },
        {
          click: {
            area: "editorVideo.toolRail",
            part: { role: "button", name: "Captures", exact: true },
          },
        },
        {
          click: {
            area: "editorVideo.capturesPanel",
            part: { role: "button", name: "Capture frame", exact: true },
          },
        },
        { waitFor: { area: "editorVideo.capturesPanel", part: { role: "button", name: "Go to" } } },
        detail(ASSETS.weeklySync),
        tab("Captures (1)"),
        { waitFor: { area: "libraryDetail.captures" } },
        {
          click: {
            area: "libraryDetail.captures",
            part: { role: "button", name: "Open the capture from", exact: false },
          },
        },
        { waitFor: { area: "libraryDetail.captureSource" } },
        { waitMs: 400 },
      ],
      demonstrates: ["libraryDetail.captureSource:linked"],
      // It ends on the capture's own page: an image, no <video> to wait for.
      ready: { area: "libraryDetail.captureSource" },
      // The capture is a new file in the workspace: put the vault back for the next state.
      after: [{ action: "restoreVault" }],
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
      "libraryDetail.preview:notDownloaded": nc(
        "needsSetup",
        "needs a file a sync provider offloaded (SF_DATALESS); the seeded vault is not synced",
      ),
      "libraryDetail.actions:notDownloaded": nc(
        "needsSetup",
        "needs a file a sync provider offloaded (SF_DATALESS); the seeded vault is not synced",
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
