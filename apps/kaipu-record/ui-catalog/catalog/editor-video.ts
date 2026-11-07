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
        { click: { area: "editorVideo.transport", part: { role: "button", name: "Play" } } },
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
      how: "Open “Team notes” and press + in the transport bar twice: the lanes stretch to the deepest zoom a 9 s take allows in this window (about 1.7×), the labels stay put and a scrollbar appears under the lanes.",
      // Two presses, not more: the second reaches the deepest zoom, and a third would be a
      // click on a disabled button, which Playwright waits on until the step times out.
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
