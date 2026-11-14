import { ASSETS } from "../fixtures/seed-vault";
import { catalog, type Step } from "../types";
import { nc } from "./not-capturable";

const open = (assetId: string): Step => ({ navigate: `/editor/video/${assetId}` });
const loaded: Step = { waitFor: { video: true } };
const rail = (name: string): Step => ({
  click: { area: "editorVideo.toolRail", part: { role: "button", name, exact: true } },
});
/** A row of the tool flyout, which hangs from the body, outside the rail. */
const flyoutItem = (name: string): Step => ({
  click: {
    area: "editorVideo.toolFlyout",
    part: { role: "menuitemcheckbox", name, exact: true },
  },
});
/** An edit autosaves ~800 ms later; waiting for the chip keeps the next state's reset unblocked. */
const saved: Step = {
  waitFor: { area: "editorVideo.toolbar", part: { role: "button", name: "Saved", exact: true } },
};
const settings = (patch: Record<string, string>): Step => ({
  call: "updateSettings",
  args: [patch],
});
/** The `+` of the timeline zoom, on the transport bar. */
const zoomIn: Step = {
  click: {
    area: "editorVideo.transport",
    part: { role: "button", name: "Zoom in the timeline", exact: true },
  },
};
/** Capture frame, the camera in the top bar: it opens the Captures panel on the new capture. */
const captureFrameButton: Step = {
  click: {
    area: "editorVideo.toolbar",
    part: { role: "button", name: "Capture frame", exact: true },
  },
};
/**
 * A capture in the panel's list: the Go to button over its image is named "Go to <time>". The
 * shot waits for it to be in the DOM (it is invisible until hover), not for the image to
 * decode, which the next step covers.
 */
const captureListed: Step = {
  waitFor: { area: "editorVideo.capturesPanel", part: { role: "button", name: "Go to" } },
};
/** The waveform canvas in the Audio lane: it appears once the first peaks are decoded. */
const audioWaveformDrawn: Step = {
  waitFor: { area: "editorVideo.audioLane", part: { css: "[data-audio-waveform]" } },
};
const exportSheet: Step = {
  click: { area: "editorVideo.toolbar", part: { role: "button", name: "Export", exact: true } },
};

/**
 * The video editor (`#/editor/video/:assetId`) at 1440×900, plus the minimum-size shot and
 * both sides of the `native-cursor-capture` flag. “Team notes” carries a saved zoom, a muted
 * range, a box annotation and a blur, so every lane has something to select; “Release demo”
 * has a webcam track; “Walkthrough 1” has nothing, which is the editor's plain look.
 *
 * States that edit (hide the webcam, mute the recording) wait for the autosave chip to read
 * Saved, and use recordings no other screen opens for a look of its own.
 *
 * The flag does not change the editor itself: it changes what a take records. A take made
 * with it carries a native cursor track, and the editor draws an editable cursor over such a
 * recording. So the "on" side runs with the flag forced (profile `cursor-flag`, which proves
 * the override reaches the renderer: the manifest records `rendererFlags`) on the seeded
 * “Cursor demo”, which carries the track such a take writes; the "off" side opens a
 * recording made without it.
 */
export const editorVideo = catalog(
  "editorVideo",
  {
    "loaded@min": {
      profile: "default",
      window: "editor-min",
      how: "Open “Team notes” (a saved zoom and a muted range) in the editor at its minimum size.",
      steps: [open(ASSETS.teamNotes)],
      demonstrates: ["editorVideo.page:loaded"],
      ready: { video: true },
    },
    "cursor-off": {
      profile: "default",
      how: "Open “Walkthrough 1”, recorded without the flag: no cursor track, no cursor layer or Cursor tool.",
      steps: [open(ASSETS.walkthrough)],
      demonstrates: ["editorVideo.page:loaded"],
      ready: { video: true },
      gates: [{ flag: "native-cursor-capture", side: "off" }],
    },
    "cursor-on": {
      profile: "cursor-flag",
      how: "With the flag forced on, open “Cursor demo”, which carries a native cursor track: the editor draws the cursor.",
      steps: [open(ASSETS.cursorDemo)],
      demonstrates: ["editorVideo.cursor:visible"],
      ready: { video: true },
      gates: [{ flag: "native-cursor-capture", side: "on" }],
    },
    "cursor-inspector": {
      profile: "cursor-flag",
      steps: [
        open(ASSETS.cursorDemo),
        { waitFor: { video: true } },
        { click: { area: "editorVideo.toolRail", part: { role: "button", name: "Cursor" } } },
      ],
      demonstrates: ["editorVideo.cursorInspector:open"],
      ready: { area: "editorVideo.cursorInspector" },
      gates: [{ flag: "native-cursor-capture", side: "on" }],
    },
    overview: {
      profile: "default",
      how: "Open “Walkthrough 1” in the editor: no zooms, no privacy regions and nothing muted.",
      steps: [open(ASSETS.walkthrough)],
      demonstrates: [
        "editorVideo.preview:frame",
        "editorVideo.transport:paused",
        "editorVideo.toolRail:default",
        "editorVideo.toolbar:default",
        "editorVideo.inspector:detection",
        "editorVideo.background:default",
        "editorVideo.timeline:default",
        "editorVideo.zoomLane:empty",
        "editorVideo.privacyLane:empty",
        "editorVideo.audioLane:empty",
      ],
      ready: { video: true },
    },
    playing: {
      profile: "default",
      steps: [
        open(ASSETS.walkthrough),
        loaded,
        {
          click: {
            area: "editorVideo.transport",
            part: { role: "button", name: "Play", exact: true },
          },
        },
        { waitMs: 400 },
      ],
      demonstrates: ["editorVideo.transport:playing"],
    },
    "team-notes": {
      profile: "default",
      how: "Open “Team notes”: a zoom, a muted range, a blur and a box are on the timeline.",
      steps: [open(ASSETS.teamNotes)],
      demonstrates: [
        "editorVideo.transport:withCounts",
        "editorVideo.zoomLane:segments",
        "editorVideo.privacyLane:regions",
        "editorVideo.audioLane:mutedRanges",
      ],
      ready: { video: true },
    },
    "zoom-selected": {
      profile: "default",
      steps: [
        open(ASSETS.teamNotes),
        loaded,
        { click: { area: "editorVideo.zoomLane", part: { role: "button", name: "Zoom 1" } } },
      ],
      demonstrates: ["editorVideo.preview:zoomSelected", "editorVideo.inspector:zoom"],
      ready: { area: "editorVideo.inspector" },
    },
    // The seeded recordings carry a silent stereo track (fixtures/make-fixtures.ts), so the
    // bars are the quiet stubs; a take with speech draws taller ones.
    waveform: {
      profile: "audio-waveform",
      how: "With the audio-waveform flag forced on, open “Walkthrough 1”: the Audio lane draws the recording's loudness as bars instead of the empty-state text.",
      steps: [open(ASSETS.walkthrough), loaded, audioWaveformDrawn],
      demonstrates: ["editorVideo.audioLane:waveform"],
      ready: { area: "editorVideo.audioLane" },
    },
    "waveform-muted": {
      profile: "audio-waveform",
      how: "With the audio-waveform flag forced on, open “Team notes”: its muted range is a hatched block over bars drawn dimmed.",
      steps: [open(ASSETS.teamNotes), loaded, audioWaveformDrawn],
      demonstrates: ["editorVideo.audioLane:waveformMuted"],
      ready: { area: "editorVideo.audioLane" },
    },
    "mute-selected": {
      profile: "default",
      steps: [
        open(ASSETS.teamNotes),
        loaded,
        {
          click: {
            area: "editorVideo.audioLane",
            part: { role: "button", name: "Muted section 1" },
          },
        },
      ],
      demonstrates: ["editorVideo.inspector:mute"],
    },
    "privacy-selected": {
      profile: "default",
      steps: [
        open(ASSETS.teamNotes),
        loaded,
        { click: { area: "editorVideo.privacyLane", part: { css: "[data-redaction-block]" } } },
      ],
      demonstrates: ["editorVideo.inspector:privacy"],
    },
    "overlay-selected": {
      profile: "default",
      how: "Open “Team notes” and select the box annotation on the timeline.",
      steps: [
        open(ASSETS.teamNotes),
        loaded,
        { click: { area: "editorVideo.timeline", part: { css: 'button[class*="pill"]' } } },
      ],
      demonstrates: ["editorVideo.preview:overlaySelected", "editorVideo.inspector:annotation"],
    },
    "background-set": {
      profile: "default",
      how: "Open “Walkthrough 1”, choose the Magenta background and set padding 48, corners 16 and shadow 24: the picture sits inset on the gradient.",
      steps: [
        open(ASSETS.walkthrough),
        loaded,
        {
          click: {
            area: "editorVideo.background",
            part: { role: "button", name: "Magenta", exact: true },
          },
        },
        ...(
          [
            ["Padding", "48"],
            ["Corners", "16"],
            ["Shadow", "24"],
          ] as const
        ).map(
          ([name, value]): Step => ({
            fill: { area: "editorVideo.background", part: { role: "slider", name, exact: true } },
            value,
          }),
        ),
        saved,
      ],
      demonstrates: ["editorVideo.background:set"],
      ready: { video: true },
      // The background saved into the vault (autosave, then a flush on unmount): without this the
      // later states that open “Walkthrough 1” find the magenta frame, and the shot can race the
      // “Saving…” chip.
      after: [{ action: "restoreVault" }],
    },
    "tool-box": {
      profile: "default",
      steps: [open(ASSETS.walkthrough), loaded, rail("Box")],
      demonstrates: ["editorVideo.toolRail:annotate", "editorVideo.inspector:annotation"],
    },
    "tool-blur": {
      profile: "default",
      steps: [open(ASSETS.walkthrough), loaded, rail("Blur")],
      demonstrates: ["editorVideo.toolRail:privacy"],
    },
    webcam: {
      profile: "default",
      how: "Open “Release demo”, a recording with a webcam track: the bubble is on the preview.",
      steps: [open(ASSETS.releaseDemo)],
      demonstrates: ["editorVideo.webcam:visible"],
      ready: { video: true },
    },
    "webcam-selected": {
      profile: "default",
      how: "Open “Release demo” and select the webcam bubble: the inspector shows its shape, size and position.",
      // The bubble re-places itself every frame, so a click may never see it stable; Enter on
      // it selects it, as it does from the keyboard.
      steps: [
        open(ASSETS.releaseDemo),
        loaded,
        {
          press: "Enter",
          // The area is the bubble itself (the button), not the slot around it.
          target: { area: "editorVideo.webcam" },
        },
      ],
      demonstrates: ["editorVideo.inspector:webcam"],
      ready: { area: "editorVideo.inspector" },
    },
    "webcam-hidden": {
      profile: "default",
      how: "Open “Release demo” and press Hide webcam here: a hidden section appears on the webcam lane.",
      steps: [open(ASSETS.releaseDemo), loaded, rail("Hide webcam here"), saved],
      demonstrates: ["editorVideo.webcamLane:segments"],
      // The edit saved into the vault: without this the second shot finds the section hidden.
      after: [{ action: "restoreVault" }],
    },
    "audio-menu": {
      profile: "default",
      how: "Open “Bug report” and press Audio in the tool rail: a menu offers Mute a section and Mute the whole recording.",
      steps: [open(ASSETS.bugReport), loaded, rail("Audio")],
      demonstrates: ["editorVideo.toolFlyout:audio"],
    },
    "tracks-popover": {
      profile: "default",
      how: "Open “Team notes” and press Tracks in the transport bar: a panel lists the lanes with a checkbox each, Clips always on.",
      steps: [
        open(ASSETS.teamNotes),
        loaded,
        // The trigger's name carries the count ("Tracks, 5 of 5 shown"), so match the start.
        { click: { area: "editorVideo.transport", part: { role: "button", name: "Tracks" } } },
      ],
      demonstrates: ["editorVideo.tracksPopover:open"],
    },
    "track-guide-clips": {
      profile: "default",
      how: "Open “Team notes” and press Guide in the header: the Timeline guide opens on the Clips tab, with the sample timeline lit on Clips.",
      steps: [
        open(ASSETS.teamNotes),
        loaded,
        {
          click: { area: "editorVideo.toolbar", part: { role: "button", name: "Timeline guide" } },
        },
      ],
      demonstrates: ["editorVideo.trackGuide:clips"],
    },
    "track-guide-zooms": {
      profile: "default",
      how: "Open “Team notes”, press Guide in the header, then the Zooms tab: the legend explains zoom blocks, amber click ticks and pauses.",
      steps: [
        open(ASSETS.teamNotes),
        loaded,
        {
          click: { area: "editorVideo.toolbar", part: { role: "button", name: "Timeline guide" } },
        },
        { click: { area: "editorVideo.trackGuide", part: { role: "tab", name: "Zooms" } } },
      ],
      demonstrates: ["editorVideo.trackGuide:zooms"],
    },
    "track-guide-webcam": {
      profile: "default",
      how: "Open “Team notes”, press Guide in the header, then the Webcam tab: the legend explains the frame strip, hidden and custom blocks.",
      steps: [
        open(ASSETS.teamNotes),
        loaded,
        {
          click: { area: "editorVideo.toolbar", part: { role: "button", name: "Timeline guide" } },
        },
        { click: { area: "editorVideo.trackGuide", part: { role: "tab", name: "Webcam" } } },
      ],
      demonstrates: ["editorVideo.trackGuide:webcam"],
    },
    "playback-speed": {
      profile: "default",
      how: "Open “Team notes” and press the speed button next to mute twice: it reads 2× and the preview plays at double speed.",
      steps: [
        open(ASSETS.teamNotes),
        loaded,
        // The button's name carries the speed ("Playback speed 1×"), so match the start.
        {
          click: {
            area: "editorVideo.transport",
            part: { role: "button", name: "Playback speed" },
          },
        },
        {
          click: {
            area: "editorVideo.transport",
            part: { role: "button", name: "Playback speed" },
          },
        },
      ],
      demonstrates: ["editorVideo.transport:speedChanged"],
    },
    "timeline-zoomed": {
      profile: "default",
      how: "Open “Team notes” and press + in the transport bar twice: the zoom level reads 400%, the lanes stretch to four times the window, the labels stay put and a scrollbar appears under the lanes.",
      // Two presses reach 400% (100% → 200% → 400%); a sixth would be a click on a disabled
      // button (2000% is the deepest zoom, reached by the fifth press), which Playwright waits on
      // until the step times out.
      steps: [open(ASSETS.teamNotes), loaded, zoomIn, zoomIn],
      demonstrates: ["editorVideo.transport:zoomed", "editorVideo.timeline:zoomed"],
    },
    "mute-all": {
      profile: "default",
      how: "Open “Bug report” and press Mute the whole recording: the audio lane reads muted and the edit saves.",
      steps: [
        open(ASSETS.bugReport),
        loaded,
        rail("Audio"),
        flyoutItem("Mute the whole recording"),
        saved,
      ],
      demonstrates: ["editorVideo.audioLane:allMuted", "editorVideo.toolbar:saved"],
      ready: { area: "editorVideo.audioLane" },
      after: [{ action: "restoreVault" }],
    },
    "captures-empty": {
      profile: "default",
      how: "Open “Walkthrough 1”, which has no captures, and press Captures in the tool column: the right column shows the empty panel, which points to the camera in the top bar.",
      steps: [
        open(ASSETS.walkthrough),
        loaded,
        rail("Captures"),
        // The panel is drawn before its first read lands; the empty state is what follows.
        {
          waitFor: {
            area: "editorVideo.capturesPanel",
            part: { text: "No captures of this video yet." },
          },
        },
      ],
      demonstrates: ["editorVideo.capturesPanel:empty"],
      ready: { area: "editorVideo.capturesPanel" },
    },
    "captures-list": {
      profile: "default",
      how: "Open “Weekly sync” and press Capture frame, the camera in the top bar: the frame at the playhead is saved into the library and the right column opens on the Captures list with its time.",
      steps: [
        open(ASSETS.weeklySync),
        loaded,
        captureFrameButton,
        captureListed,
        // The list appears before the image inside it has decoded.
        { waitMs: 400 },
      ],
      demonstrates: ["editorVideo.capturesPanel:list"],
      ready: { area: "editorVideo.capturesPanel" },
      // The capture is a new file in the workspace: put the vault back for the next state.
      after: [{ action: "restoreVault" }],
    },
    "captures-hover": {
      profile: "default",
      how: "Open “Weekly sync”, press Capture frame in the top bar and rest the pointer on the new capture's image: a subtle dark veil covers it with the Go to button in its center. Its row below keeps the time, Add to timeline, Copy and Delete.",
      steps: [
        open(ASSETS.weeklySync),
        loaded,
        captureFrameButton,
        captureListed,
        // The list appears before the image inside it has decoded.
        { waitMs: 400 },
        // Hovering the button (the veil's only part that takes the pointer) is hovering the image.
        {
          hover: {
            area: "editorVideo.capturesPanel",
            part: { role: "button", name: "Go to" },
          },
        },
      ],
      keepPointer: true,
      demonstrates: ["editorVideo.capturesPanel:hover"],
      ready: { area: "editorVideo.capturesPanel" },
      after: [{ action: "restoreVault" }],
    },
    "captures-duplicate": {
      profile: "default",
      how: "Open “Weekly sync” and press Capture frame in the top bar twice at the same playhead: the second press saves nothing, outlines the existing capture and a toast says “Already captured at …”.",
      steps: [
        open(ASSETS.weeklySync),
        loaded,
        captureFrameButton,
        captureListed,
        captureFrameButton,
        // The outline lasts ~2 s; the shot is taken as soon as it appears.
        {
          waitFor: {
            area: "editorVideo.capturesPanel",
            part: { css: '[data-highlighted="true"]' },
          },
        },
      ],
      demonstrates: ["editorVideo.capturesPanel:duplicate"],
      ready: { area: "editorVideo.capturesPanel" },
      after: [{ action: "restoreVault" }],
    },
    "captures-confirm-delete": {
      profile: "default",
      how: "Open “Weekly sync”, capture a frame from the top bar and press the capture's Delete button: a confirmation names the capture and nothing is deleted until it is confirmed.",
      steps: [
        open(ASSETS.weeklySync),
        loaded,
        captureFrameButton,
        captureListed,
        {
          click: {
            area: "editorVideo.capturesPanel",
            part: { role: "button", name: "Delete capture", exact: true },
          },
        },
        { waitFor: { area: "editorVideo.capturesPanel", part: { role: "alertdialog" } } },
      ],
      demonstrates: ["editorVideo.capturesPanel:confirmDelete"],
      ready: { area: "editorVideo.capturesPanel" },
      after: [{ action: "restoreVault" }],
    },
    "export-sheet": {
      profile: "default",
      how: "Open “Walkthrough 1” and press Export with the export quality at Balanced.",
      steps: [open(ASSETS.walkthrough), loaded, exportSheet],
      demonstrates: ["editorVideo.exportSheet:open"],
      gates: [{ setting: "exportQuality", side: "balanced" }],
    },
    "export-sheet-maximum": {
      profile: "default",
      how: "Set the export quality to Maximum, open “Walkthrough 1” and press Export: the sheet preselects the Maximum row.",
      steps: [
        settings({ exportQuality: "maximum" }),
        open(ASSETS.walkthrough),
        loaded,
        exportSheet,
      ],
      demonstrates: ["editorVideo.exportSheet:open"],
      gates: [{ setting: "exportQuality", side: "maximum" }],
      after: [settings({ exportQuality: "balanced" })],
    },
  },
  {
    notCapturable: {
      "editorVideo.toolbar:saving": nc(
        "transient",
        "held for ~800 ms after an edit, until the autosave writes; a shot would race it",
      ),
    },
  },
);
