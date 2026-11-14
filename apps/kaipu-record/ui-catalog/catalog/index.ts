import type { AnyScreenCatalog, KnownVariable } from "../types";
import { cloud } from "./cloud";
import { editor } from "./editor";
import { editorCapture } from "./editor-capture";
import { editorImage } from "./editor-image";
import { editorNew } from "./editor-new";
import { editorVideo } from "./editor-video";
import { exportCatalog } from "./export";
import { exportNew } from "./export-new";
import { libraryCatalog } from "./library";
import { libraryDetail } from "./library-detail";
import { onboarding } from "./onboarding";
import { record } from "./record";
import { settingsApp } from "./settings-app";
import { settingsGeneral } from "./settings-general";
import { settingsPermissions } from "./settings-permissions";
import { settingsRecording } from "./settings-recording";
import { settingsRecordingQuality } from "./settings-recording-quality";
import { settingsScreenshots } from "./settings-screenshots";
import { settingsWorkspaces } from "./settings-workspaces";
import { shell } from "./shell";
import { shortcuts } from "./shortcuts";
import { signIn } from "./sign-in";
import { cameraBubble } from "./windows/camera-bubble";
import { captureOverlay } from "./windows/capture-overlay";
import { capturePanel } from "./windows/capture-panel";
import { captureToast } from "./windows/capture-toast";
import { controlBar } from "./windows/control-bar";
import { recordingReady } from "./windows/recording-ready";
import { recordingShade } from "./windows/recording-shade";

/**
 * Every screen's catalog. The runner walks these in profile order; the coverage test checks
 * them against the UI map. A new screen file is added here.
 */
export const CATALOGS: readonly AnyScreenCatalog[] = [
  record,
  libraryCatalog,
  libraryDetail,
  editorVideo,
  exportCatalog,
  exportNew,
  // The image editor opens saved screenshots and the video editor recordings, which stamps
  // them; the Editor home reads those stamps, so it comes after both.
  editorImage,
  editor,
  editorNew,
  editorCapture,
  shortcuts,
  cloud,
  signIn,
  settingsGeneral,
  settingsPermissions,
  settingsRecordingQuality,
  settingsRecording,
  settingsScreenshots,
  settingsApp,
  capturePanel,
  cameraBubble,
  recordingReady,
  controlBar,
  recordingShade,
  onboarding,
  // After every default-profile screen: its last state dismisses the one-time workspaces hint.
  shell,
  // Creates a second workspace that stays registered for the rest of the run.
  settingsWorkspaces,
  // Last of the recording profile: a pick that ends badly can leave main refusing the next
  // pick and the next take, so nothing that needs a take comes after it.
  captureOverlay,
  captureToast,
];

/**
 * Crops whose pixels change between two runs on the same commit, each with the reason the
 * README prints. Only content the app itself makes live belongs here (a clock, a running
 * timer, the runner's screen): anything else that differs is a state the catalog did not
 * settle, and is fixed there. `--twice` does not report these crops.
 */
export const KNOWN_VARIABLE: readonly KnownVariable[] = [
  {
    areas: ["shell.workspaceMenu"],
    reason: "shows the workspace folder, a fresh temp folder on every launch",
  },
  {
    areas: ["libraryDetail.details", "library.videoRow", "library.list"],
    reason: "show absolute dates, which are the run's clock",
  },
  {
    areas: ["editorImage.reopenNotice"],
    states: ["editorImage/reopen-editable"],
    reason: "shows when the document was saved, which is the run's clock",
  },
  {
    areas: ["editor.continue", "editor.hero", "editorCapture.page"],
    reason: "show dates and the title a pasted image gets, which are the run's clock",
  },
  {
    areas: [
      "editorVideo.page",
      "editorVideo.transport",
      "editorVideo.preview",
      "editorVideo.timeline",
      "editorVideo.zoomLane",
      "editorVideo.privacyLane",
      "editorVideo.audioLane",
    ],
    states: ["editorVideo/playing"],
    reason:
      "the video is playing: the playhead and the frame are wherever 400 ms of playback got to",
  },
  {
    areas: [
      "record.page",
      "record.screenshotCard",
      "record.recordingCard",
      "record.setup",
      "record.mic",
      "record.camera",
      "record.sourcePicker",
    ],
    states: ["record/source-picker-*"],
    reason: "the picker draws live thumbnails of the runner's screens and windows",
  },
  {
    areas: [
      "record.page",
      "record.recordingIndicator",
      "capturePanel.root",
      "capturePanel.recordingIndicator",
    ],
    states: ["record/paused", "capturePanel/paused"],
    reason: "the pause timer reads however long the take ran before the pause landed",
  },
  {
    areas: ["library.page", "library.grid"],
    states: ["library/grid@min"],
    reason:
      "at the minimum width the tag and badge text on the cards is drawn about one pixel " +
      "differently in two launches (seen at 6x: same glyphs, shifted rows; 576 pixels over " +
      "delta 40 in the first twice runs). The cause was not proven: fractional card layout or " +
      "compositor rounding are both candidates. The same cards at the default width were " +
      "identical or noise, so the exemption stays on this one state.",
  },
  {
    areas: ["shell.exportCard"],
    states: ["shell/export-running"],
    reason: "the bar, its percentage and the time left are wherever the encode had reached",
  },
  {
    areas: ["controlBar.bar"],
    states: ["controlBar/*"],
    reason: "its microphone level meter follows the runner's live audio input during a take",
  },
  {
    areas: ["libraryDetail.page", "libraryDetail.preview"],
    states: ["libraryDetail/gif"],
    reason: "an animated GIF loops: the frame is wherever the loop reached",
  },
  {
    areas: ["libraryDetail.page", "libraryDetail.preview"],
    states: ["libraryDetail/saved-notice"],
    reason: "a real take: its title carries the clock and its preview is the runner's live screen",
  },
  {
    areas: ["captureToast.root", "captureToast.card"],
    states: ["captureToast/*"],
    reason: "the card holds a thumbnail of what was on the runner's screen at the capture",
  },
];
