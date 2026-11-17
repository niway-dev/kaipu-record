import { ASSETS } from "../fixtures/seed-vault";
import { catalog, type Step } from "../types";
import { nc } from "./not-capturable";

const open = (assetId: string): Step => ({ navigate: `/editor/video/${assetId}` });
const loaded: Step = { waitFor: { video: true } };
/**
 * The add-from-library profile opens “Weekly sync” as three 4 s clips: half of the 12 s ruler
 * is 6 s, the middle of the second clip. A press on the ruler seeks there.
 */
const playheadInMiddleClip: Step = {
  click: { area: "editorVideo.timeline", part: { css: '[data-testid="ruler"]' } },
  at: { x: 0.5, y: 0.5 },
};
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
/** The Add recording button at the left end of the transport bar (`timeline-levels` on). */
const addRecordingButton: Step = {
  click: {
    area: "editorVideo.transport",
    part: { role: "button", name: "Add recording", exact: true },
  },
};
/** A recording row in the Add from Library list: a button named after the recording. */
const libraryRow = (title: string) => ({
  role: "button" as const,
  name: title,
  exact: true,
});
/** A screenshot card in the Add from Library Screenshots tab: a button named after its title. */
const libraryShot = (title: string) => ({
  role: "button" as const,
  name: title,
  exact: true,
});
/** The modal's Screenshots tab (its name carries the count, so it is not matched exactly). */
const screenshotsTab: Step = {
  click: { area: "editorVideo.addFromLibrary", part: { role: "tab", name: "Screenshots" } },
};
/**
 * The Audio lane's waveform once the whole recording is decoded. Every seeded recording has
 * audio, so every state that opens one waits for it: a shot must not land before, or while,
 * the lane fills in (partial peaks are published every 400 ms on the way).
 */
const audioWaveformDrawn: Step = {
  waitFor: { area: "editorVideo.audioLane", part: { css: '[data-audio-waveform="complete"]' } },
};
/**
 * For "Camera long", which declares 20 minutes over 12 s of media: its waveform never reaches
 * `complete` (the audio ends at 12 s), so these states wait for the part on the lane instead.
 * They do not use `loaded` either: it waits for the webcam filmstrip, which never finishes
 * decoding across 20 declared minutes of a 12 s file.
 */
const cameraPartDrawn: Step = {
  waitFor: {
    area: "editorVideo.webcamLane",
    part: { role: "button", name: "Webcam section 1", exact: true },
  },
};
/** The Nth block on the Camera lane (a part or a hidden range, in order): selects it. */
const cameraSection = (n: number): Step => ({
  click: {
    area: "editorVideo.webcamLane",
    part: { role: "button", name: `Webcam section ${n}`, exact: true },
  },
});
/** The webcam bubble, selected from the keyboard: it re-places itself every frame, so a click may miss. */
const selectBubble: Step = { press: "Enter", target: { area: "editorVideo.webcam" } };
/** A tab of the Camera panel. */
const cameraTab = (name: string): Step => ({
  click: { area: "editorVideo.webcamPanel", part: { role: "tab", name, exact: true } },
});
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
      steps: [open(ASSETS.teamNotes), audioWaveformDrawn],
      demonstrates: ["editorVideo.page:loaded"],
      ready: { video: true },
    },
    "cursor-off": {
      profile: "default",
      how: "Open “Walkthrough 1”, recorded without the flag: no cursor track, no cursor layer or Cursor tool.",
      steps: [open(ASSETS.walkthrough), audioWaveformDrawn],
      demonstrates: ["editorVideo.page:loaded"],
      ready: { video: true },
      gates: [{ flag: "native-cursor-capture", side: "off" }],
    },
    "cursor-on": {
      profile: "cursor-flag",
      how: "With the flag forced on, open “Cursor demo”, which carries a native cursor track: the editor draws the cursor.",
      steps: [open(ASSETS.cursorDemo), audioWaveformDrawn],
      demonstrates: ["editorVideo.cursor:visible"],
      ready: { video: true },
      gates: [{ flag: "native-cursor-capture", side: "on" }],
    },
    "cursor-inspector": {
      profile: "cursor-flag",
      steps: [
        open(ASSETS.cursorDemo),
        audioWaveformDrawn,
        { waitFor: { video: true } },
        { click: { area: "editorVideo.toolRail", part: { role: "button", name: "Cursor" } } },
      ],
      demonstrates: ["editorVideo.cursorInspector:open"],
      ready: { area: "editorVideo.cursorInspector" },
      gates: [{ flag: "native-cursor-capture", side: "on" }],
    },
    overview: {
      profile: "default",
      how: "Open “Walkthrough 1” in the editor: no zooms, no privacy regions and nothing muted. The Audio lane draws the recording's loudness as bars.",
      steps: [open(ASSETS.walkthrough), audioWaveformDrawn],
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
        "editorVideo.audioLane:waveform",
      ],
      ready: { video: true },
    },
    playing: {
      profile: "default",
      steps: [
        open(ASSETS.walkthrough),
        audioWaveformDrawn,
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
      steps: [open(ASSETS.teamNotes), audioWaveformDrawn],
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
        audioWaveformDrawn,
        loaded,
        { click: { area: "editorVideo.zoomLane", part: { role: "button", name: "Zoom 1" } } },
      ],
      demonstrates: ["editorVideo.preview:zoomSelected", "editorVideo.inspector:zoom"],
      ready: { area: "editorVideo.inspector" },
    },
    // The seeded recordings carry a speech-like stereo track (fixtures/make-fixtures.ts), so
    // the lane shows tall bars, quiet stubs and the pauses between phrases (`overview` shows
    // the plain waveform).
    "waveform-muted": {
      profile: "default",
      how: "Open “Team notes”: its muted range is a hatched block over bars drawn dimmed.",
      steps: [open(ASSETS.teamNotes), audioWaveformDrawn, loaded],
      demonstrates: ["editorVideo.audioLane:waveformMuted"],
      ready: { area: "editorVideo.audioLane" },
    },
    "mute-selected": {
      profile: "default",
      steps: [
        open(ASSETS.teamNotes),
        audioWaveformDrawn,
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
        audioWaveformDrawn,
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
        audioWaveformDrawn,
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
        audioWaveformDrawn,
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
    "levels-off": {
      profile: "default",
      how: "Open “Walkthrough 1” with the `timeline-levels` flag off: no floating images, no rows above the sequence, no Add recording button, and no Add from Library… in the Captures panel.",
      steps: [open(ASSETS.walkthrough)],
      demonstrates: ["editorVideo.page:loaded"],
      ready: { video: true },
      gates: [{ flag: "timeline-levels", side: "off" }],
    },
    "media-rows": {
      profile: "timeline-levels",
      how: "With the `timeline-levels` flag forced on, open “Floating images”: its two overlapping floating images sit on two rows above the sequence, the one in front above.",
      steps: [open(ASSETS.floatingDemo)],
      demonstrates: ["editorVideo.timelineMediaRows:twoImages"],
      ready: { video: true },
      gates: [{ flag: "timeline-levels", side: "on" }],
    },
    "media-selected": {
      profile: "timeline-levels",
      how: "With the flag forced on, open “Floating images” and select the front image on the preview (Enter on it, as from the keyboard): it gets an outline with four corner handles and the right column shows its panel.",
      steps: [
        open(ASSETS.floatingDemo),
        loaded,
        {
          press: "Enter",
          target: {
            area: "editorVideo.mediaLayer",
            part: { css: '[data-media-id="float-front"]' },
          },
        },
        { waitFor: { area: "editorVideo.mediaPanel" } },
      ],
      demonstrates: ["editorVideo.mediaLayer:selected", "editorVideo.mediaPanel:overlapping"],
      ready: { area: "editorVideo.mediaPanel" },
      gates: [{ flag: "timeline-levels", side: "on" }],
    },
    "media-selected-full": {
      profile: "timeline-levels",
      how: "With the flag forced on, open “Floating images” and select the back image, which fills the whole picture (Full): its frame and four corner handles sit inside the picture edge instead of being clipped by it.",
      steps: [
        open(ASSETS.floatingDemo),
        loaded,
        {
          press: "Enter",
          target: {
            area: "editorVideo.mediaLayer",
            part: { css: '[data-media-id="float-back"]' },
          },
        },
        { waitFor: { area: "editorVideo.mediaPanel" } },
      ],
      demonstrates: ["editorVideo.mediaLayer:selectedFull"],
      ready: { area: "editorVideo.mediaPanel" },
      gates: [{ flag: "timeline-levels", side: "on" }],
    },
    "slide-sequence": {
      profile: "slide-sequence",
      how: "With the `timeline-levels` flag forced on, open “Slide sequence”: its clip and its three slides all sit on the one Clips row, side by side, each slide showing its picture and the slide badge, with nothing pushed down under the lanes below.",
      // The clip's thumbnails decode after the editor opens; the slides' pictures are there at once.
      steps: [open(ASSETS.slidesDemo), loaded, { waitMs: 800 }],
      demonstrates: ["editorVideo.timeline:threeSlides"],
      ready: { video: true },
      gates: [{ flag: "timeline-levels", side: "on" }],
    },
    "two-recordings": {
      profile: "two-recordings",
      how: "Open “Two recordings”, whose edit joined “Checkout bug”: the clips alternate the two recordings, each labelled with its name and length over its own thumbnails, and the Webcam track says “No camera in this recording” under the joined clip.",
      steps: [open(ASSETS.joinedDemo)],
      demonstrates: ["editorVideo.timeline:twoRecordings", "editorVideo.webcamLane:noCamera"],
      ready: { video: true },
    },
    "two-recordings-hover": {
      profile: "two-recordings",
      how: "Open “Two recordings” and rest the pointer on its first clip: both clips of that recording get a subtle outline, the joined clip between them does not.",
      steps: [
        open(ASSETS.joinedDemo),
        loaded,
        // The thumbnails decode after the editor opens; the labels are there from the start.
        { waitMs: 800 },
        { hover: { area: "editorVideo.timeline", part: { css: '[data-item-id="clip-a1"]' } } },
        // The other clip of the hovered recording is outlined only once the hover landed, so a
        // missed hover fails here instead of shooting the un-hovered timeline.
        {
          waitFor: {
            area: "editorVideo.timeline",
            part: { css: '[data-item-id="clip-a2"][data-same-recording="true"]' },
          },
        },
      ],
      keepPointer: true,
      demonstrates: ["editorVideo.timeline:recordingHover"],
      ready: { video: true },
    },
    "different-aspect": {
      profile: "two-recordings",
      how: "Open “Different aspect” and put the playhead in its joined clip: the square recording is fitted inside the 16:9 frame with the background on both sides.",
      steps: [
        open(ASSETS.differentAspectDemo),
        loaded,
        // The clips run 5 s, 7 s (the joined one, 5 s to 12 s), 7 s: 45% of a 19 s ruler is
        // 8.55 s. A press on the ruler seeks there.
        {
          click: { area: "editorVideo.timeline", part: { css: '[data-testid="ruler"]' } },
          at: { x: 0.45, y: 0.5 },
        },
        // The switch shows a recording by setting its element's visibility, only once that
        // element holds the frame. The joined `<video>` reading visible is the joined picture
        // on screen, not the opened one.
        {
          waitFor: {
            area: "editorVideo.preview",
            part: { css: '[data-recording="join-sq"][style*="visibility: visible"]' },
          },
        },
      ],
      demonstrates: ["editorVideo.preview:differentAspect"],
      ready: { video: true },
    },
    "recording-missing": {
      profile: "two-recordings",
      how: "Open “Missing recording”, whose joined recording is not in the vault: its clip is hatched and reads “Recording missing: Old standup”, and the editor goes on working.",
      steps: [open(ASSETS.joinedMissingDemo)],
      demonstrates: ["editorVideo.timeline:recordingMissing"],
      ready: { video: true },
    },
    "tool-box": {
      profile: "default",
      steps: [open(ASSETS.walkthrough), audioWaveformDrawn, loaded, rail("Box")],
      demonstrates: ["editorVideo.toolRail:annotate", "editorVideo.inspector:annotation"],
    },
    "tool-blur": {
      profile: "default",
      steps: [open(ASSETS.walkthrough), audioWaveformDrawn, loaded, rail("Blur")],
      demonstrates: ["editorVideo.toolRail:privacy"],
    },
    webcam: {
      profile: "default",
      how: "Open “Release demo”, a recording with a webcam track: the bubble is on the preview.",
      steps: [open(ASSETS.releaseDemo), audioWaveformDrawn],
      demonstrates: ["editorVideo.webcam:visible"],
      ready: { video: true },
    },
    "webcam-selected": {
      profile: "default",
      how: "Open “Release demo” and select the webcam bubble: the Camera panel opens.",
      // The bubble re-places itself every frame, so a click may never see it stable; Enter on
      // it selects it, as it does from the keyboard.
      steps: [
        open(ASSETS.releaseDemo),
        audioWaveformDrawn,
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
      how: "Open “Release demo” and press Hide camera from here: a hidden section appears on the webcam lane.",
      steps: [
        open(ASSETS.releaseDemo),
        audioWaveformDrawn,
        loaded,
        rail("Hide camera from here"),
        saved,
      ],
      demonstrates: ["editorVideo.webcamLane:segments"],
      // The edit saved into the vault: without this the second shot finds the section hidden.
      after: [{ action: "restoreVault" }],
    },
    // The Camera panel's states. They open recordings a profile of their own seeds with a saved
    // camera part and hidden range; selecting never edits, so nothing needs restoring.
    "camera-part": {
      profile: "camera-parts",
      how: "Open “Camera parts” and select its first camera section on the lane: the Camera panel shows This part, with its range, small frame, name, how it arrives and Remove this part.",
      steps: [open(ASSETS.cameraParts), audioWaveformDrawn, loaded, cameraSection(1)],
      demonstrates: [
        "editorVideo.webcamPanel:thisPart",
        "editorVideo.inspector:webcamBlock",
        "editorVideo.webcamLane:cameraBlock",
        "editorVideo.webcamMarks:partRoute",
      ],
      ready: { area: "editorVideo.webcamPanel" },
    },
    "camera-no-part": {
      profile: "camera-parts",
      how: "Open “Camera parts” and select the bubble at the start, where no part is: This part says No change and has no button.",
      steps: [open(ASSETS.cameraParts), audioWaveformDrawn, loaded, selectBubble],
      demonstrates: [
        "editorVideo.webcamPanel:noPart",
        "editorVideo.webcamLane:originalStretch",
        "editorVideo.webcamMarks:originalLabel",
      ],
      ready: { area: "editorVideo.webcamPanel" },
    },
    "camera-whole-video": {
      profile: "camera-parts",
      how: "Open “Camera parts”, select the bubble and open the Whole video tab: the original position, shape, size as S, M or L with M pressed, mirror, shadow and shrink.",
      steps: [
        open(ASSETS.cameraParts),
        audioWaveformDrawn,
        loaded,
        selectBubble,
        cameraTab("Whole video"),
      ],
      demonstrates: ["editorVideo.webcamPanel:wholeVideo"],
      ready: { area: "editorVideo.webcamPanel" },
    },
    "camera-size-custom": {
      profile: "camera-parts",
      how: "Open “Camera size”, saved at a camera size no button has (27% of the frame), select the bubble and open Whole video: S, M and L, none pressed.",
      steps: [
        open(ASSETS.cameraSize),
        audioWaveformDrawn,
        loaded,
        selectBubble,
        cameraTab("Whole video"),
      ],
      demonstrates: ["editorVideo.webcamPanel:sizeCustom"],
      ready: { area: "editorVideo.webcamPanel" },
    },
    "camera-drop-card": {
      profile: "camera-parts",
      how: "Open “Camera parts” at its start, where no part is, and drag the bubble from the bottom left to the top middle of the frame, its centre about 16% down from the top: the card asks whether the bubble belongs to a new part.",
      // `to` is measured from the bubble's own box, so 3.5 and -2.5 are outside it: the pointer
      // moves three bubble widths right and three bubble heights up. The bubble follows the pointer
      // 1:1, so it lands at x 0.49, y 0.16 of a 1920×1080 frame (the default centre is 0.12, 0.82;
      // a bubble is 0.22 of the frame height), inside the frame. The drop is not answered, so
      // nothing is saved.
      steps: [
        open(ASSETS.cameraParts),
        audioWaveformDrawn,
        loaded,
        {
          drag: { area: "editorVideo.webcam" },
          from: { x: 0.5, y: 0.5 },
          to: { x: 3.5, y: -2.5 },
        },
        { waitFor: { area: "editorVideo.webcamDrop" } },
      ],
      demonstrates: ["editorVideo.webcamDrop:asking"],
      ready: { area: "editorVideo.webcamDrop" },
    },
    "camera-hidden-range": {
      profile: "camera-parts",
      how: "Open “Camera parts” and select its hidden range on the lane: Camera hidden, its range, the sentence and Show the camera again.",
      steps: [open(ASSETS.cameraParts), audioWaveformDrawn, loaded, cameraSection(2)],
      demonstrates: [
        "editorVideo.webcamPanel:hiddenRange",
        "editorVideo.webcamMarks:hiddenOutline",
      ],
      ready: { area: "editorVideo.webcamPanel" },
    },
    // The Camera lane's two looks on a recording long enough that a part is a few pixels wide:
    // the card the hover opens, and a selected part with its handles spread apart. Both only read.
    "camera-lane-hover": {
      profile: "camera-parts",
      how: "Open “Camera long”, a 20-minute recording whose camera part is about 4 px wide on the lane, and rest the pointer on that part: after a moment a card appears over the lane with the part's range and length, and how it arrives.",
      steps: [
        open(ASSETS.cameraLong),
        cameraPartDrawn,
        // The card opens after about 120 ms of hovering, and the pointer stays on the part.
        {
          hover: {
            area: "editorVideo.webcamLane",
            part: { role: "button", name: "Webcam section 1", exact: true },
          },
        },
        { waitFor: { area: "editorVideo.webcamLaneCard" } },
      ],
      keepPointer: true,
      embedsScreen: true,
      demonstrates: ["editorVideo.webcamLaneCard:hover"],
      ready: { area: "editorVideo.webcamLaneCard" },
    },
    "camera-lane-narrow-selected": {
      profile: "camera-parts",
      how: "Open “Camera long” and select its camera part on the lane: the part is narrower than its glyph, so its two handles are drawn apart from each other.",
      steps: [open(ASSETS.cameraLong), cameraPartDrawn, cameraSection(1)],
      embedsScreen: true,
      demonstrates: ["editorVideo.webcamLane:narrowSelected"],
      ready: { area: "editorVideo.webcamLane" },
    },
    "audio-menu": {
      profile: "default",
      how: "Open “Bug report” and press Audio in the tool rail: a menu offers Mute a section and Mute the whole recording.",
      steps: [open(ASSETS.bugReport), audioWaveformDrawn, loaded, rail("Audio")],
      demonstrates: ["editorVideo.toolFlyout:audio"],
    },
    "tracks-popover": {
      profile: "default",
      how: "Open “Team notes” and press Tracks in the transport bar: a panel lists the lanes with a checkbox each, Clips always on.",
      steps: [
        open(ASSETS.teamNotes),
        audioWaveformDrawn,
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
        audioWaveformDrawn,
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
        audioWaveformDrawn,
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
        audioWaveformDrawn,
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
        audioWaveformDrawn,
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
      steps: [open(ASSETS.teamNotes), audioWaveformDrawn, loaded, zoomIn, zoomIn],
      demonstrates: ["editorVideo.transport:zoomed", "editorVideo.timeline:zoomed"],
    },
    "mute-all": {
      profile: "default",
      how: "Open “Bug report” and press Mute the whole recording: the audio lane reads muted and the edit saves.",
      steps: [
        open(ASSETS.bugReport),
        audioWaveformDrawn,
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
        audioWaveformDrawn,
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
        audioWaveformDrawn,
        loaded,
        captureFrameButton,
        captureListed,
        // The list appears before the image inside it has decoded.
        { waitMs: 400 },
      ],
      demonstrates: ["editorVideo.capturesPanel:list"],
      ready: { area: "editorVideo.capturesPanel" },
      gates: [{ flag: "timeline-levels", side: "off" }],
      // The capture is a new file in the workspace: put the vault back for the next state.
      after: [{ action: "restoreVault" }],
    },
    "captures-hover": {
      profile: "default",
      how: "Open “Weekly sync”, press Capture frame in the top bar and rest the pointer on the new capture's image: a subtle dark veil covers it with the Go to button in its center. Its row below keeps the time, Copy and Delete (Add from Library… is behind the timeline-levels flag).",
      steps: [
        open(ASSETS.weeklySync),
        audioWaveformDrawn,
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
      gates: [{ flag: "timeline-levels", side: "off" }],
      after: [{ action: "restoreVault" }],
    },
    "captures-duplicate": {
      profile: "default",
      how: "Open “Weekly sync” and press Capture frame in the top bar twice at the same playhead: the second press saves nothing, outlines the existing capture and a toast says “Already captured at …”.",
      steps: [
        open(ASSETS.weeklySync),
        audioWaveformDrawn,
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
        audioWaveformDrawn,
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
    "captures-add-from-library": {
      profile: "timeline-levels",
      how: "With the timeline-levels flag forced on, open “Weekly sync” and press Capture frame in the top bar: the new capture's row shows Add from Library beside Copy and Delete.",
      steps: [
        open(ASSETS.weeklySync),
        loaded,
        captureFrameButton,
        captureListed,
        {
          waitFor: {
            area: "editorVideo.capturesPanel",
            part: { role: "button", name: "Add from Library…", exact: true },
          },
        },
      ],
      demonstrates: ["editorVideo.capturesPanel:addFromLibrary"],
      ready: { area: "editorVideo.capturesPanel" },
      after: [{ action: "restoreVault" }],
      gates: [{ flag: "timeline-levels", side: "on" }],
    },
    "captures-opens-add-from-library": {
      profile: "timeline-levels",
      how: "With the timeline-levels flag forced on, open “Weekly sync”, press Capture frame and then Add from Library… on the new capture's row: the Add from Library modal opens on its Screenshots tab with that new capture already selected, its image shown on the right above the placement strip and the Add button, which reads “Add over the video”.",
      steps: [
        open(ASSETS.weeklySync),
        loaded,
        captureFrameButton,
        captureListed,
        {
          click: {
            area: "editorVideo.capturesPanel",
            part: { role: "button", name: "Add from Library…", exact: true },
          },
        },
        // The Add button exists only while a screenshot is selected, so this waits for the
        // modal, the Screenshots tab and the new capture's selection together. The new
        // capture's title ends in its time ("Weekly sync frame 0s"), which the seeded
        // “Weekly sync frame” card does not, so the title is not matched here.
        {
          waitFor: {
            area: "editorVideo.addFromLibrary",
            part: { role: "button", name: "Add over the video", exact: true },
          },
        },
        // The selected image decodes after the column is drawn.
        { waitMs: 400 },
      ],
      demonstrates: ["editorVideo.addFromLibrary:screenshotSelected"],
      ready: { area: "editorVideo.addFromLibrary" },
      after: [{ action: "restoreVault" }],
      gates: [{ flag: "timeline-levels", side: "on" }],
    },
    "add-from-library": {
      profile: "add-from-library",
      how: "With the `timeline-levels` flag forced on, open “Weekly sync” (three 4 s clips, with the playhead put in the middle one) and press Add recording at the left end of the transport bar: the Add from Library modal opens on its Recordings tab, a compact list of the Library's other recordings, newest first, with the first one selected and previewed on the right (paused at its first frame) above the placement strip (a mini timeline of the real sequence: the three clips, with the new one in pink after the middle clip and the last clip moving later, and one sentence saying how many clips move) and the Add button, a split button that reads “Add after this clip”; the transport button stays lit while the modal is open.",
      steps: [
        open(ASSETS.weeklySync),
        loaded,
        playheadInMiddleClip,
        addRecordingButton,
        // The list is drawn after the Library read lands; “Walkthrough 1” is among its rows.
        { waitFor: { area: "editorVideo.addFromLibrary", part: libraryRow("Walkthrough 1") } },
        // The preview autoplays: hold every video at 0:00. The wait is met by any video with a
        // frame (the editor's too), so the preview may still show its poster, the same picture.
        { waitFor: { video: "paused-at-start", within: "editorVideo.addFromLibrary" } },
        // The row thumbnails decode after the list is drawn.
        { waitMs: 400 },
      ],
      demonstrates: [
        "editorVideo.addFromLibrary:recordings",
        "editorVideo.transport:addRecordingOpen",
      ],
      ready: { area: "editorVideo.addFromLibrary" },
      gates: [{ flag: "timeline-levels", side: "on" }],
    },
    "add-from-library-destination-menu": {
      profile: "add-from-library",
      how: "With the flag forced on, open “Weekly sync” (three 4 s clips, playhead in the middle one), press Add recording and open the arrow at the right end of the Add button: the “Where it goes” menu opens upward from the button with its five destinations, each with a thumbnail of the sequence it makes (four blocks: the three clips and the new item, so before, after and around the clip under the playhead look different) and a hint. After this clip is checked with a pink tick, Over the video is greyed out with “Floating videos come later.”, and the arrow part of the button is a shade darker and points down.",
      steps: [
        open(ASSETS.weeklySync),
        loaded,
        playheadInMiddleClip,
        addRecordingButton,
        { waitFor: { area: "editorVideo.addFromLibrary", part: libraryRow("Walkthrough 1") } },
        { waitFor: { video: "paused-at-start", within: "editorVideo.addFromLibrary" } },
        { waitMs: 400 },
        {
          click: {
            area: "editorVideo.addFromLibrary",
            part: { role: "button", name: "Choose where it goes", exact: true },
          },
        },
        { waitFor: { area: "editorVideo.addFromLibrary", part: { role: "menu" } } },
        // The menu pops in over 150 ms (animations are off in the catalog, so this is margin).
        { waitMs: 200 },
      ],
      demonstrates: ["editorVideo.addFromLibrary:destinationMenu"],
      ready: { area: "editorVideo.addFromLibrary" },
      gates: [{ flag: "timeline-levels", side: "on" }],
    },
    "add-from-library-screenshots": {
      profile: "add-from-library",
      how: "With the flag forced on, open “Weekly sync” (three 4 s clips, playhead in the middle one), press Add recording and open the Screenshots tab: a grid of the Library's screenshots (GIFs are not listed), newest first, “Weekly sync frame” tagged “From this recording”, none selected yet, with the right column asking to select a screenshot.",
      steps: [
        open(ASSETS.weeklySync),
        loaded,
        playheadInMiddleClip,
        addRecordingButton,
        { waitFor: { area: "editorVideo.addFromLibrary", part: libraryRow("Walkthrough 1") } },
        screenshotsTab,
        { waitFor: { area: "editorVideo.addFromLibrary", part: libraryShot("Weekly sync frame") } },
        // The card thumbnails decode after the grid is drawn.
        { waitMs: 400 },
      ],
      demonstrates: ["editorVideo.addFromLibrary:screenshots"],
      ready: { area: "editorVideo.addFromLibrary" },
      gates: [{ flag: "timeline-levels", side: "on" }],
    },
    "add-from-library-screenshot-selected": {
      profile: "add-from-library",
      how: "With the flag forced on, open “Weekly sync” (three 4 s clips, playhead in the middle one), press Add recording, open the Screenshots tab and click “Weekly sync frame”: the card is outlined as selected and the right column shows its title above the placement strip, which draws it floating from the playhead (6 s) to the end of the video (6 s long), and the Add button, which reads “Add over the video”.",
      steps: [
        open(ASSETS.weeklySync),
        loaded,
        playheadInMiddleClip,
        addRecordingButton,
        { waitFor: { area: "editorVideo.addFromLibrary", part: libraryRow("Walkthrough 1") } },
        screenshotsTab,
        { waitFor: { area: "editorVideo.addFromLibrary", part: libraryShot("Weekly sync frame") } },
        { click: { area: "editorVideo.addFromLibrary", part: libraryShot("Weekly sync frame") } },
        {
          waitFor: {
            area: "editorVideo.addFromLibrary",
            part: { role: "button", name: "Add over the video", exact: true },
          },
        },
        // The card thumbnails decode after the grid is drawn.
        { waitMs: 400 },
      ],
      demonstrates: ["editorVideo.addFromLibrary:screenshotSelected"],
      ready: { area: "editorVideo.addFromLibrary" },
      gates: [{ flag: "timeline-levels", side: "on" }],
    },
    "add-from-library-no-match": {
      profile: "add-from-library",
      how: "With the flag forced on, open “Weekly sync” (three 4 s clips, playhead in the middle one), press Add recording and type a title no recording has: the list gives way to “No recordings match” with a hint to try another title.",
      steps: [
        open(ASSETS.weeklySync),
        loaded,
        playheadInMiddleClip,
        addRecordingButton,
        { waitFor: { area: "editorVideo.addFromLibrary", part: libraryRow("Walkthrough 1") } },
        {
          fill: {
            area: "editorVideo.addFromLibrary",
            part: { role: "searchbox", name: "Search recordings", exact: true },
          },
          value: "no such recording",
        },
        {
          waitFor: {
            area: "editorVideo.addFromLibrary",
            part: { text: "No recordings match" },
          },
        },
      ],
      demonstrates: ["editorVideo.addFromLibrary:noMatch"],
      ready: { area: "editorVideo.addFromLibrary" },
      gates: [{ flag: "timeline-levels", side: "on" }],
    },
    "add-from-library-added": {
      profile: "add-from-library",
      how: "With the flag forced on, open “Weekly sync”, press Add recording and click “Add after this clip” with “Walkthrough 1” selected and the default destination (After this clip): “Weekly sync” opens as three 4 s clips with the playhead in the middle one, so the recording is inserted after the middle clip, and the sequence shows the clips labelled “Weekly sync” and “Walkthrough 1” (the modal is closed for the shot).",
      steps: [
        open(ASSETS.weeklySync),
        loaded,
        playheadInMiddleClip,
        addRecordingButton,
        { waitFor: { area: "editorVideo.addFromLibrary", part: libraryRow("Walkthrough 1") } },
        // The first row (the newest, “Floating images”) is selected by default: pick this one.
        { click: { area: "editorVideo.addFromLibrary", part: libraryRow("Walkthrough 1") } },
        {
          click: {
            area: "editorVideo.addFromLibrary",
            part: { role: "button", name: "Add after this clip", exact: true },
          },
        },
        // The modal stays open after an add, so close it with Escape to see the sequence.
        { press: "Escape" },
        { waitFor: { area: "editorVideo.addFromLibrary", state: "hidden" } },
        // Both recordings now label a clip.
        { waitFor: { area: "editorVideo.timeline", part: { text: "Walkthrough 1" } } },
        { waitFor: { area: "editorVideo.timeline", part: { text: "Weekly sync" } } },
        saved,
        // The joined clip's thumbnails decode after the labels are there.
        { waitMs: 800 },
      ],
      demonstrates: ["editorVideo.timeline:recordingAdded"],
      ready: { area: "editorVideo.timeline" },
      // The join autosaved into the vault: put it back for the next state that opens this one.
      after: [{ action: "restoreVault" }],
      gates: [{ flag: "timeline-levels", side: "on" }],
    },
    "export-sheet": {
      profile: "default",
      how: "Open “Walkthrough 1” and press Export with the export quality at Balanced.",
      steps: [open(ASSETS.walkthrough), audioWaveformDrawn, loaded, exportSheet],
      demonstrates: ["editorVideo.exportSheet:open"],
      gates: [{ setting: "exportQuality", side: "balanced" }],
    },
    "export-sheet-maximum": {
      profile: "default",
      how: "Set the export quality to Maximum, open “Walkthrough 1” and press Export: the sheet preselects the Maximum row.",
      steps: [
        settings({ exportQuality: "maximum" }),
        open(ASSETS.walkthrough),
        audioWaveformDrawn,
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
      "editorVideo.insertIndicator:visible": nc(
        "transient",
        "drawn only while a recording is dragged over the Clips row, and nothing drags one today (the Add from Library modal adds from its buttons); the target stays for NIW2-789",
      ),
      "editorVideo.audioLane:empty": nc(
        "needsSetup",
        "the empty-state text shows only for a recording without an audio track, and every seeded recording has one; audio-lane.test.tsx covers it",
      ),
      "editorVideo.webcamDrop:noRoom": nc(
        "needsSetup",
        "the camera-drop-card drag with the playhead in a gap of under a second before the next block or the end, and no seeded recording has such a gap; webcam-drop-card.test.tsx covers it",
      ),
      "editorVideo.toolbar:saving": nc(
        "transient",
        "held for ~800 ms after an edit, until the autosave writes; a shot would race it",
      ),
    },
  },
);
