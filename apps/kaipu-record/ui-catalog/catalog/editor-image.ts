import { ASSETS } from "../fixtures/seed-vault";
import { catalog, type Step } from "../types";
import { nc } from "./not-capturable";

const open = (assetId: string): Step => ({ navigate: `/editor/image/${assetId}` });
const zoomOut: Step = {
  click: { area: "editorImage.canvas", part: { role: "button", name: "Zoom out", exact: true } },
};
const zoomIn: Step = {
  click: { area: "editorImage.canvas", part: { role: "button", name: "Zoom in", exact: true } },
};
const theme = (value: "light" | "dark"): Step => ({
  call: "updateSettings",
  args: [{ theme: value }],
});
const addImageButton: Step = {
  click: {
    area: "editorImage.addImage",
    part: { role: "button", name: "Add image", exact: true },
  },
};
const fromLibrary: Step = {
  click: {
    area: "editorImage.addImage",
    part: { role: "menuitem", name: "From Library", exact: true },
  },
};
const searchLibrary = (value: string): Step => ({
  fill: {
    area: "editorImage.libraryPicker",
    part: { role: "textbox", name: "Search captures", exact: true },
  },
  value,
});
// The list loads after the picker opens: wait for an item, not just the dialog.
const libraryListed: Step = {
  waitFor: {
    area: "editorImage.libraryPicker",
    part: { role: "button", name: "Dashboard draft", exact: true },
  },
};
/**
 * After a state that added an image: leave the editor first (leaving autosaves the image into
 * “Settings page”, and the Library shows only once that save is done), then put the vault
 * back. Restoring while the editor is still open would let the save land afterwards.
 */
const leaveAndRestore: readonly Step[] = [
  { navigate: "/library" },
  { waitFor: { area: "library.page" } },
  { action: "restoreVault" },
];
const inspectToggle: Step = {
  click: { area: "editorImage.inspectToggle" },
};
const inspectColors: Step = {
  click: {
    area: "editorImage.inspectBar",
    part: { role: "button", name: "Colors", exact: true },
  },
};
/** A row of the Colors panel by what its button says it highlights (`title`, in English). */
const colorsRow = (title: string): Step => ({
  click: { area: "editorImage.inspectColors", part: { css: `button[title='${title}']` } },
});
/** Open a Colors-panel screenshot, turn Inspect on and open the Colors tab, once it is listed. */
const colorsPanelOpen = (assetId: string): readonly Step[] => [
  open(assetId),
  inspectToggle,
  inspectColors,
  { waitFor: { area: "editorImage.inspectColors", part: { css: "ul" } } },
];
const tool = (name: string): Step => ({
  click: { area: "editorImage.tools", part: { role: "button", name, exact: true } },
});
/**
 * The runner sizes the window after the steps, so a step that needs the compact toolbar
 * (a menu only it has) shrinks the window first.
 */
const compactWindow: Step = { window: "editor-image-min" };
/** The compact toolbar (mock B3): a button of the toolbar, by its accessible name. */
const toolbarButton = (name: string): Step => ({
  click: { area: "editorImage.toolbar", part: { role: "button", name, exact: true } },
});

/**
 * Drop a step badge: the Step tool places one on press, so a drag that never moves is a click at
 * a chosen point (`click` only hits the centre). The Select tool selects what it presses on, and a
 * press that never moves leaves the badge where it is.
 */
const pressAt = (x: number, y: number): Step => ({
  drag: { area: "editorImage.canvas" },
  from: { x, y },
  to: { x, y },
});
/** A size button of the Step tool's options in the Tool tab ("Size S", "Size M", "Size L"). */
const stepSize = (label: "S" | "M" | "L"): Step => ({
  click: {
    area: "editorImage.toolPanel",
    part: { role: "button", name: `Size ${label}`, exact: true },
  },
});
/** A badge's number is drawn as SVG text: once one is there, the placements have rendered. */
const badgeDrawn: Step = { waitFor: { area: "editorImage.canvas", part: { css: "svg text" } } };
/** Where the four badges of mock D1 and D2 go: spread over the image. */
const STEP_POINTS = [
  { x: 0.3, y: 0.35 },
  { x: 0.62, y: 0.3 },
  { x: 0.72, y: 0.62 },
  { x: 0.38, y: 0.75 },
] as const;
const placeFourBadges: readonly Step[] = [
  tool("Step"),
  ...STEP_POINTS.map((p) => pressAt(p.x, p.y)),
  // Select with nothing selected leaves the Tool tab on its empty state.
  tool("Select"),
  badgeDrawn,
];

/**
 * A crop drawn with the crop tool (NIW2-759): the frame is committed on release, the tool stays
 * active, and the panel offers Done. The shot is saved to the document, so the state that uses
 * this leaves the editor (the leave guard saves) and restores the vault in `after`.
 */
const drawCrop = (toolName: "Crop" | "Export frame"): readonly Step[] => [
  open(ASSETS.settingsShot),
  tool(toolName),
  {
    drag: { area: "editorImage.canvas" },
    from: { x: 0.35, y: 0.3 },
    to: { x: 0.65, y: 0.65 },
  },
  {
    waitFor: {
      area: "editorImage.toolPanel",
      part: { role: "button", name: "Done", exact: true },
    },
  },
];
const cropDone: Step = {
  click: { area: "editorImage.toolPanel", part: { role: "button", name: "Done", exact: true } },
};
/** The cropped stage, with the chip in the page (it fades in under the pointer). */
const chipInPage: Step = { waitFor: { area: "editorImage.cropChip" } };
/**
 * The chip is in the page on the first windowed render, but the stage remounts the shot's
 * <img> then, and it measures itself again once decoded: a shot taken at once can catch the
 * window mid-measure (a wide strip). Nothing in the page marks that end, so give it a beat.
 */
const windowSettled: Step = { waitMs: 400 };
const afterCrop: readonly Step[] = [
  { navigate: "/library" },
  { waitFor: { area: "editorImage.canvas", state: "hidden" } },
  { action: "restoreVault" },
];

/** Inspect states from the mocks (C1-C12): the pointer rests on the canvas and the HUD shows. */
const hoverCanvas: Step = { hover: { area: "editorImage.canvas" } };
const hudShown: Step = { waitFor: { area: "editorImage.inspectHud" } };
const runShown: Step = { waitFor: { area: "editorImage.inspectRun" } };
const inspectButton = (name: string): Step => ({
  click: { area: "editorImage.inspectBar", part: { role: "button", name, exact: true } },
});
/** The HUD, aimed by a point of the canvas box (fractions), which the Inspect layer covers. */
const hoverAt = (x: number, y: number, part?: { css: string }): Step => ({
  hover: { area: "editorImage.canvas", ...(part ? { part } : {}) },
  at: { x, y },
});
const clickAt = (x: number, y: number): Step => ({
  click: { area: "editorImage.canvas" },
  at: { x, y },
});
const inCanvas = (css: string) => ({
  waitFor: { area: "editorImage.canvas" as const, part: { css } },
});

/** Open the screenshot that draws real text and pick Select text, as `ready` and `selected` start. */
const openText: readonly Step[] = [
  open(ASSETS.textShot),
  tool("Select text"),
  {
    waitFor: { area: "editorImage.textStatus", part: { text: "words found" } },
    // The first recognition on a Mac compiles Vision's model: 13.5 s measured, so allow more.
    timeoutMs: 60_000,
  },
];

/**
 * Open the text screenshot with the canvas on and pick the redact tool, waiting until its
 * lines are click targets (NIW2-706).
 */
const openTextHide: readonly Step[] = [
  open(ASSETS.textShot),
  tool("Redact"),
  {
    waitFor: { area: "editorImage.textHideHint", part: { text: "Click a line of text" } },
    timeoutMs: 60_000,
  },
];
// The fixture is 560x340 px; its first row ("Language: English") spans x 44-170 at y 92-108.
const FIRST_ROW = { x: 100 / 560, y: 100 / 340 };

/** The image editor on a saved screenshot (`#/editor/image/:assetId`). */
export const editorImage = catalog(
  "editorImage",
  {
    saved: {
      profile: "default",
      how: "Open “Settings page”, a saved screenshot, in the image editor.",
      steps: [open(ASSETS.settingsShot)],
      demonstrates: [
        "editorImage.page:saved",
        "editorImage.toolbar:default",
        "editorImage.tools:select",
        "editorImage.canvas:default",
        "editorImage.beautify:default",
      ],
      // The flags are off in this profile: the `canvasView`, Inspect and Select text areas are
      // not drawn, this is the other side.
      gates: [
        { flag: "image-canvas", side: "off" },
        { flag: "image-inspect", side: "off" },
        { flag: "image-text", side: "off" },
      ],
    },
    "tool-box": {
      profile: "default",
      steps: [open(ASSETS.settingsShot), tool("Box")],
      demonstrates: [
        "editorImage.tools:annotate",
        "editorImage.canvas:annotate",
        "editorImage.toolPanel:stroke",
      ],
    },
    "tool-panel-text": {
      profile: "default",
      how: "Open “Settings page” and pick Text: the side panel switches to its Tool tab, which offers Color and Size for the next label.",
      steps: [
        open(ASSETS.settingsShot),
        tool("Text"),
        { waitFor: { area: "editorImage.toolPanel", part: { text: "Size", exact: true } } },
      ],
      demonstrates: ["editorImage.toolPanel:size"],
    },
    "tool-panel-empty": {
      profile: "default",
      how: "Open “Settings page” and press the Tool tab of the side panel: with Select and nothing selected it says “No tool selected” and where to pick one.",
      steps: [
        open(ASSETS.settingsShot),
        {
          click: {
            area: "editorImage.panelTabs",
            part: { role: "tab", name: "Tool", exact: true },
          },
        },
        { waitFor: { area: "editorImage.toolPanel", part: { text: "No tool selected" } } },
      ],
      demonstrates: ["editorImage.panelTabs:tool", "editorImage.toolPanel:empty"],
    },
    "tool-step": {
      profile: "default",
      how: "Open “Settings page”, pick Step and click the canvas: a badge numbered 1 appears.",
      steps: [open(ASSETS.settingsShot), tool("Step"), { click: { area: "editorImage.canvas" } }],
      demonstrates: ["editorImage.tools:step", "editorImage.canvas:step"],
    },
    "tool-crop": {
      profile: "default",
      steps: [open(ASSETS.settingsShot), tool("Crop")],
      demonstrates: ["editorImage.tools:crop", "editorImage.canvas:crop"],
    },
    "crop-tool-done": {
      profile: "default",
      how: "Open “Settings page”, pick Crop and drag a frame: the stage still shows the whole image with the frame, and the Tool tab offers Reset and the primary Done.",
      steps: drawCrop("Crop"),
      demonstrates: ["editorImage.toolPanel:crop"],
      after: afterCrop,
    },
    "crop-applied": {
      profile: "default",
      how: "Open “Settings page”, pick Crop, drag a frame and press Done: the crop tool is left, the crop is kept and the stage shows only the cropped part.",
      steps: [...drawCrop("Crop"), cropDone, chipInPage, windowSettled],
      demonstrates: ["editorImage.canvas:cropped"],
      after: afterCrop,
    },
    "crop-applied-chip": {
      profile: "default",
      how: "As “Crop applied”, then rest the pointer on the cropped image: the “Cropped” chip appears above its top-left corner.",
      steps: [...drawCrop("Crop"), cropDone, chipInPage, windowSettled, hoverCanvas],
      keepPointer: true,
      demonstrates: ["editorImage.cropChip:shown"],
      after: afterCrop,
    },
    toolbar: {
      profile: "image-toolbar",
      how: "Mock B1: with the three image-editor flags forced on, open “Settings page” at the editor's default size: the toolbar reads mode switch (Annotate | Inspect), Select Pen Box Arrow Text Step, Redact, Export frame, Add image, Select text, Undo Redo, the title, then Copy, Save and PDF.",
      steps: [open(ASSETS.settingsShot)],
      demonstrates: ["editorImage.toolbar:default"],
    },
    "toolbar-tooltip": {
      profile: "image-toolbar",
      how: "Mock B2: with the three image-editor flags forced on, open “Settings page” and rest the pointer on the Step tool: a tooltip names it and shows its key, N.",
      steps: [
        open(ASSETS.settingsShot),
        {
          hover: {
            area: "editorImage.tools",
            part: { role: "button", name: "Step", exact: true },
          },
        },
        { waitFor: { area: "editorImage.toolbar", part: { css: "[role='tooltip']" } } },
      ],
      keepPointer: true,
      demonstrates: ["editorImage.toolbar:tooltip"],
    },
    "toolbar-compact": {
      profile: "image-toolbar",
      // The smallest window the image editor allows (720×560). Compact needs the editor page
      // under 1000 px.
      window: "editor-image-min",
      how: "Mock B3: with the three image-editor flags forced on, open “Settings page” in a narrow window: Pen, Box, Arrow, Text and Step are one Draw menu, the rest sit in the ••• menu, the title is gone and the right panel is behind its toggle.",
      steps: [open(ASSETS.settingsShot)],
      demonstrates: [
        "editorImage.toolbar:compact",
        "editorImage.drawMenu:closed",
        "editorImage.moreMenu:closed",
        "editorImage.panelToggle:closed",
      ],
    },
    "toolbar-compact-draw-menu": {
      profile: "image-toolbar",
      window: "editor-image-min",
      how: "Mock B3: with the three image-editor flags forced on, open “Settings page” in a narrow window and press Draw: the menu lists Pen, Box, Arrow, Text and Step with their keys.",
      steps: [open(ASSETS.settingsShot), compactWindow, toolbarButton("Draw")],
      demonstrates: ["editorImage.drawMenu:open"],
    },
    "toolbar-compact-more-menu": {
      profile: "image-toolbar",
      window: "editor-image-min",
      how: "Mock B3: with the three image-editor flags forced on, open “Settings page” in a narrow window and press •••: the menu lists Export frame, Add image, Select text, Undo, Redo and PDF.",
      steps: [open(ASSETS.settingsShot), compactWindow, toolbarButton("More")],
      demonstrates: ["editorImage.moreMenu:open"],
    },
    "toolbar-compact-panel": {
      profile: "image-toolbar",
      window: "editor-image-min",
      how: "Mock B3: with the three image-editor flags forced on, open “Settings page” in a narrow window and press the panel toggle: the Beautify panel opens as a sheet over the stage's right edge.",
      steps: [open(ASSETS.settingsShot), compactWindow, toolbarButton("Panel")],
      demonstrates: ["editorImage.panelToggle:open"],
    },
    "toolbar-saved": {
      profile: "default",
      how: "Open “Error dialog”, press Save and answer Overwrite: the Save button turns into Saved.",
      steps: [
        open(ASSETS.dialogShot),
        {
          click: {
            area: "editorImage.toolbar",
            part: { role: "button", name: "Save", exact: true },
          },
        },
        { click: { area: "editorImage.page", part: { role: "button", name: "Overwrite" } } },
        {
          waitFor: {
            area: "editorImage.toolbar",
            part: { role: "button", name: "Saved", exact: true },
          },
        },
      ],
      demonstrates: ["editorImage.toolbar:saved"],
    },
    "canvas-default": {
      profile: "image-canvas",
      how: "With the flag forced on, open “Settings page” in the image editor: the canvas is marked as the flag's content-box canvas.",
      steps: [open(ASSETS.settingsShot)],
      demonstrates: ["editorImage.canvasView:default", "editorImage.addImage:closed"],
      gates: [{ flag: "image-canvas", side: "on" }],
    },
    "canvas-off-content": {
      profile: "image-canvas",
      how: "Mock A6: with the flag forced on, open “Settings page”, zoom in three steps and turn the mouse wheel over the canvas toward the right and down until less than half of the content is on stage: a notice says where the content went.",
      steps: [
        open(ASSETS.settingsShot),
        zoomIn,
        zoomIn,
        zoomIn,
        // A plain wheel pans (Ctrl or Cmd would zoom); a positive delta moves the view right
        // and down. The pan stops with 64 px of the content still on stage.
        { wheel: { area: "editorImage.canvas" }, deltaX: 600, deltaY: 600, times: 6 },
        { waitFor: { area: "editorImage.offContentNotice" } },
      ],
      demonstrates: ["editorImage.canvasView:offContent", "editorImage.offContentNotice:shown"],
      gates: [{ flag: "image-canvas", side: "on" }],
    },
    "add-image-menu": {
      profile: "image-canvas",
      how: "Mock E1: with the flag forced on, open “Settings page” and press Add image: the menu offers New capture (focused) and From Library, and says pasting works too, with the paste key in a chip.",
      steps: [open(ASSETS.settingsShot), addImageButton],
      demonstrates: ["editorImage.addImage:open"],
      gates: [{ flag: "image-canvas", side: "on" }],
    },
    "library-picker": {
      profile: "image-canvas",
      how: "Mock E2: with the flag forced on, open “Settings page”, press Add image and choose From Library: the picker lists the other screenshots, newest first and selected with the accent ring, with a search field, and says where the image lands.",
      steps: [open(ASSETS.settingsShot), addImageButton, fromLibrary, libraryListed],
      demonstrates: ["editorImage.libraryPicker:open"],
    },
    "library-picker-search": {
      profile: "image-canvas",
      how: "Mock E2: with the flag forced on, open the Library picker from “Settings page” and type “dash” in Search captures: only “Dashboard draft” is left, selected.",
      steps: [
        open(ASSETS.settingsShot),
        addImageButton,
        fromLibrary,
        libraryListed,
        searchLibrary("dash"),
      ],
      demonstrates: ["editorImage.libraryPicker:filtered"],
    },
    "library-picker-no-match": {
      profile: "image-canvas",
      how: "Mock E2: with the flag forced on, open the Library picker from “Settings page” and type “invoice” in Search captures: no capture matches, and the picker says so.",
      steps: [
        open(ASSETS.settingsShot),
        addImageButton,
        fromLibrary,
        libraryListed,
        searchLibrary("invoice"),
        { waitFor: { area: "editorImage.libraryPicker", part: { text: "No captures match" } } },
      ],
      demonstrates: ["editorImage.libraryPicker:noMatch"],
    },
    "image-just-added": {
      profile: "image-canvas",
      how: "Mock E3: with the flag forced on, open the Library picker from “Settings page”, select “Dashboard draft” and press Place on canvas: it lands to the right of the screenshot, selected, tagged “Just added · drag to place”, and a toast says where it went.",
      steps: [
        open(ASSETS.settingsShot),
        addImageButton,
        fromLibrary,
        libraryListed,
        {
          hover: {
            area: "editorImage.libraryPicker",
            part: { role: "button", name: "Dashboard draft", exact: true },
          },
        },
        {
          click: {
            area: "editorImage.libraryPicker",
            part: { role: "button", name: "Place on canvas", exact: true },
          },
        },
        { waitFor: { area: "editorImage.libraryPicker", state: "hidden" } },
        // The shot must show the tag (the view is still zooming to fit until it is up).
        { waitFor: { area: "editorImage.canvas", part: { text: "Just added" } } },
      ],
      demonstrates: ["editorImage.canvasView:justAdded", "editorImage.toolPanel:selection"],
      // No tag, no state: fail instead of keeping a frame that does not show it.
      stillOnScreen: { area: "editorImage.canvas", part: { text: "Just added" } },
      keepToasts: true,
      after: leaveAndRestore,
    },
    "two-images": {
      profile: "image-canvas",
      how: "Mock A4: with the flag forced on, open “Settings page”, press Add image, choose From Library, click “Dashboard draft” and nudge it right: it sits to the right of the screenshot, selected, with the accent frame, handles, the “Drag to move” tag and the gap to the screenshot.",
      steps: [
        open(ASSETS.settingsShot),
        addImageButton,
        fromLibrary,
        {
          click: {
            area: "editorImage.libraryPicker",
            part: { role: "button", name: "Dashboard draft", exact: true },
          },
        },
        { waitFor: { area: "editorImage.libraryPicker", state: "hidden" } },
        // A just-added image is tagged “Just added” (mock E3) until it moves: nudge it, once the
        // tag is up (the view is still zooming to fit before that, and a drag lands nowhere).
        { waitFor: { area: "editorImage.canvas", part: { text: "Just added" } } },
        {
          drag: { area: "editorImage.canvas", part: { css: '[data-testid="image-selection"]' } },
          from: { x: 0.5, y: 0.5 },
          to: { x: 0.56, y: 0.5 },
        },
      ],
      demonstrates: ["editorImage.canvasView:twoImages"],
      // A drag that missed leaves the E3 frame: fail instead of keeping it.
      stillOnScreen: { area: "editorImage.canvas", part: { text: "Drag to move" } },
      after: leaveAndRestore,
    },
    "canvas-export-box": {
      profile: "image-canvas",
      how: "Mock A1: with the flag forced on, open “Settings page”: a dashed box surrounds the image, labelled EXPORT and the exact pixel size Copy and Save produce.",
      steps: [open(ASSETS.settingsShot), { waitFor: { area: "editorImage.exportBox" } }],
      demonstrates: ["editorImage.exportBox:labeled"],
      gates: [{ flag: "image-canvas", side: "on" }],
    },
    "canvas-export-box-quiet": {
      profile: "image-canvas",
      how: "Mock A1: with the flag forced on, open “Settings page” and pick the Redact tool: the dashed export box stays, its label is hidden.",
      steps: [
        open(ASSETS.settingsShot),
        tool("Redact"),
        { waitFor: { area: "editorImage.exportBox" } },
      ],
      demonstrates: ["editorImage.exportBox:quiet"],
    },
    "canvas-beautified": {
      profile: "image-canvas",
      how: "Mock A2: with the flag forced on, open “Settings page”, pick the Sunset background and raise Padding to its maximum: the export box wraps the background and the padding, and the Beautify tip says the dotted canvas around them is not exported.",
      steps: [
        open(ASSETS.settingsShot),
        {
          click: {
            area: "editorImage.beautify",
            part: { role: "button", name: "Sunset", exact: true },
          },
        },
        // The first slider is Padding; End takes a range input to its maximum.
        {
          press: "End",
          target: { area: "editorImage.beautify", part: { role: "slider" }, nth: 0 },
        },
        { waitFor: { area: "editorImage.exportBox" } },
      ],
      demonstrates: ["editorImage.canvasView:beautified"],
    },
    "canvas-content-outside": {
      profile: "image-canvas",
      how: "Mock A3: with the flag forced on, open “Dashboard draft”, pick the Box tool and drag from inside the image to the empty canvas on its right: the export box and its label grow to include the box.",
      steps: [
        // Its own item: the box this drag adds is saved to the document, and a later state that
        // opens the same item would show it.
        open(ASSETS.dashboardShot),
        // At 100% the shot fills the stage; zoomed out, 97% of the stage is past its right edge.
        zoomOut,
        tool("Box"),
        {
          drag: { area: "editorImage.canvas" },
          from: { x: 0.55, y: 0.4 },
          to: { x: 0.97, y: 0.6 },
        },
      ],
      demonstrates: ["editorImage.canvasView:contentOutside"],
    },
    "canvas-export-frame": {
      profile: "image-canvas",
      how: "Mock A5: with the flag forced on, open “Settings page”, pick the Export frame tool and drag a rectangle inside the image: the outside is dimmed, the frame shows its handles and “W × H px · EXPORT FRAME”, and the Tool tab of the side panel offers Fit to content and Remove.",
      steps: [
        open(ASSETS.settingsShot),
        tool("Export frame"),
        {
          drag: { area: "editorImage.canvas" },
          from: { x: 0.42, y: 0.35 },
          to: { x: 0.62, y: 0.6 },
        },
        { waitFor: { area: "editorImage.exportFrameCard" } },
      ],
      demonstrates: [
        "editorImage.canvasView:exportFrame",
        "editorImage.exportFrameCard:open",
        "editorImage.toolPanel:crop",
      ],
    },
    "canvas-export-frame-applied": {
      profile: "image-canvas",
      how: "With the flag forced on, open “Settings page”, pick the Export frame tool, drag a rectangle and press Done: the tool is left, the frame is kept and the stage shows only what it exports.",
      steps: [...drawCrop("Export frame"), cropDone, chipInPage, windowSettled],
      demonstrates: ["editorImage.canvasView:exportFrameApplied"],
      gates: [{ flag: "image-canvas", side: "on" }],
      after: afterCrop,
    },
    "canvas-export-frame-chip": {
      profile: "image-canvas",
      how: "As “Canvas export frame applied”, then rest the pointer on the framed image: the “Cropped” chip appears above the frame's top-left corner.",
      steps: [...drawCrop("Export frame"), cropDone, chipInPage, windowSettled, hoverCanvas],
      keepPointer: true,
      demonstrates: ["editorImage.cropChip:shown"],
      gates: [{ flag: "image-canvas", side: "on" }],
      after: afterCrop,
    },
    "canvas-zoomed-out": {
      profile: "image-canvas",
      how: "With the flag forced on, open “Settings page” and press Zoom out once: the zoom goes below 100%.",
      steps: [open(ASSETS.settingsShot), zoomOut],
      demonstrates: ["editorImage.canvasView:zoomedOut"],
    },
    "redaction-blur": {
      profile: "image-canvas",
      how: "With the flag forced on, open “Settings page” and pick the Redact tool: the Tool tab of the side panel offers Blur (selected) and Solid, with the note that only Solid hides content for certain.",
      steps: [open(ASSETS.settingsShot), tool("Redact")],
      demonstrates: ["editorImage.redactionStyle:blur", "editorImage.toolPanel:redact"],
      gates: [{ flag: "image-canvas", side: "on" }],
    },
    "redaction-solid": {
      profile: "image-canvas",
      how: "With the flag forced on, open “Settings page”, pick the Redact tool and press Solid in the panel: Solid is now the selected style.",
      steps: [
        open(ASSETS.settingsShot),
        tool("Redact"),
        {
          click: {
            area: "editorImage.redactionStyle",
            part: { role: "button", name: "Solid", exact: true },
          },
        },
      ],
      demonstrates: ["editorImage.redactionStyle:solid"],
    },
    "redaction-locked": {
      profile: "image-canvas-saved",
      how: "Mock H4: with the flag forced on, open “Saved redaction” (a screenshot saved with one redaction over its middle) and rest the pointer on the redaction: a tag beside it says it is permanent and when it was saved. Clicking it selects nothing.",
      steps: [
        open(ASSETS.lockedShot),
        { hover: { area: "editorImage.canvas" } },
        { waitFor: { area: "editorImage.redactionLock" } },
      ],
      keepPointer: true,
      demonstrates: ["editorImage.redactionLock:shown"],
      gates: [{ flag: "image-canvas", side: "on" }],
    },
    "step-badges": {
      profile: "image-mocks",
      how: "Mock D1: with the three image-editor flags forced on, open “Steps demo”, pick Step and click four spread-out points of the image, then pick Select: four badges numbered 1 to 4 in the default color, none selected, no card.",
      steps: [
        // Its own item: the badges are saved to the document (autosave), and a later state that
        // opens the same item would show them.
        open(ASSETS.stepsShot),
        ...placeFourBadges,
      ],
      demonstrates: ["editorImage.canvas:steps"],
      // Leave the editor first (its leave guard saves pending edits), waiting for the editor to
      // unmount so the save has landed before the restore. Then put the vault back so a second
      // shot opens the item as seeded.
      after: [
        { navigate: "/library" },
        { waitFor: { area: "editorImage.canvas", state: "hidden" } },
        { action: "restoreVault" },
      ],
    },
    "step-badge-selected": {
      profile: "image-mocks",
      how: "Mock D2: with the three image-editor flags forced on, open “Step selected”, place four badges with the Step tool, pick Select and press the third one: it wears the selection ring, and the Tool tab shows Color, Size and “Delete renumbers the rest”.",
      steps: [
        open(ASSETS.stepSelectedShot),
        ...placeFourBadges,
        pressAt(STEP_POINTS[2].x, STEP_POINTS[2].y),
        {
          waitFor: { area: "editorImage.toolPanel", part: { text: "Delete renumbers the rest" } },
        },
      ],
      demonstrates: ["editorImage.canvas:stepSelected", "editorImage.toolPanel:stepSelected"],
      // Leave the editor first (its leave guard saves pending edits), waiting for the editor to
      // unmount so the save has landed before the restore. Then put the vault back so a second
      // shot opens the item as seeded.
      after: [
        { navigate: "/library" },
        { waitFor: { area: "editorImage.canvas", state: "hidden" } },
        { action: "restoreVault" },
      ],
    },
    "step-badge-sizes": {
      profile: "image-mocks",
      how: "Mock D3: with the three image-editor flags forced on, open “Step sizes” (dark top half, light bottom half), pick Step, then place S, M and L badges over the dark half and S, M and L over the light half, picking the size in the Tool tab before each: the badges stay readable on both.",
      steps: [
        open(ASSETS.stepSizesShot),
        tool("Step"),
        // The size picks are in the Tool tab of the side panel, which the Step tool opens, so
        // the badges can go anywhere on the canvas: 0.32 (dark) and 0.68 (light) of its height.
        ...([0.32, 0.68] as const).flatMap((y) =>
          (
            [
              ["S", 0.35],
              ["M", 0.5],
              ["L", 0.65],
            ] as const
          ).flatMap(([label, x]) => [stepSize(label), pressAt(x, y)]),
        ),
        tool("Select"),
        badgeDrawn,
      ],
      demonstrates: ["editorImage.canvas:stepSizes"],
      // Leave the editor first (its leave guard saves pending edits), waiting for the editor to
      // unmount so the save has landed before the restore. Then put the vault back so a second
      // shot opens the item as seeded.
      after: [
        { navigate: "/library" },
        { waitFor: { area: "editorImage.canvas", state: "hidden" } },
        { action: "restoreVault" },
      ],
    },
    "redaction-card": {
      profile: "image-mocks",
      how: "Mock H1: with the three image-editor flags forced on, open “Settings page” and pick the Redact tool: the Tool tab shows Blur (selected) and Solid, each with its icon, and the note that only Solid hides content for certain. Nothing is drawn.",
      steps: [
        open(ASSETS.settingsShot),
        tool("Redact"),
        { waitFor: { area: "editorImage.redactionStyle" } },
      ],
      demonstrates: ["editorImage.redactionStyle:blur"],
      gates: [{ flag: "image-canvas", side: "on" }],
    },
    "redaction-notice": {
      profile: "image-mocks",
      how: "With the flag forced on, open “Notice demo”, pick Redact and drag a box over the image: the “Saving makes redactions permanent” card opens over the canvas, with Undo redaction and Got it.",
      steps: [
        // Its own item: the drawn region is autosaved to the document, and a later state that
        // opens the same item would show it. It never presses Got it, so the notice stays
        // unacknowledged for "redaction-styles" below, which does.
        open(ASSETS.noticeShot),
        tool("Redact"),
        {
          drag: { area: "editorImage.canvas" },
          from: { x: 0.42, y: 0.35 },
          to: { x: 0.62, y: 0.6 },
        },
        { waitFor: { area: "editorImage.redactionNotice" } },
      ],
      demonstrates: ["editorImage.redactionNotice:shown"],
      gates: [{ flag: "image-canvas", side: "on" }],
      // Leave the editor first (its leave guard saves pending edits), waiting for the editor to
      // unmount so the save has landed before the restore. Then put the vault back so a second
      // shot opens the item as seeded.
      after: [
        { navigate: "/library" },
        { waitFor: { area: "editorImage.canvas", state: "hidden" } },
        { action: "restoreVault" },
        { action: "forgetRedactionNotice" },
      ],
    },
    "redaction-styles": {
      profile: "image-mocks",
      how: "Mock H2: with the three image-editor flags forced on, open “Redaction demo” (text-like rows), pick Redact and draw a blur over the left column, press Got it on the permanence notice, pick Redact again, press Solid and draw a second region over the right column: one blurred and one solid region side by side.",
      steps: [
        // Its own item. The one-time notice is acknowledged here and nowhere else (the earlier
        // "redaction-notice" leaves it open on purpose), so it is still unacknowledged when
        // region 1 is drawn, whether this state runs alone or after that one.
        open(ASSETS.redactionShot),
        tool("Redact"),
        {
          drag: { area: "editorImage.canvas" },
          from: { x: 0.2, y: 0.36 },
          to: { x: 0.46, y: 0.54 },
        },
        { waitFor: { area: "editorImage.redactionNotice" } },
        {
          click: {
            area: "editorImage.redactionNotice",
            part: { role: "button", name: "Got it", exact: true },
          },
        },
        { waitFor: { area: "editorImage.redactionNotice", state: "hidden" } },
        // Picking the tool again deselects region 1, so Solid sets the next region's style and
        // does not restyle the one just drawn.
        tool("Redact"),
        {
          click: {
            area: "editorImage.redactionStyle",
            part: { role: "button", name: "Solid", exact: true },
          },
        },
        {
          drag: { area: "editorImage.canvas" },
          from: { x: 0.54, y: 0.36 },
          to: { x: 0.8, y: 0.54 },
        },
        { waitFor: { area: "editorImage.redactionStyle" } },
      ],
      demonstrates: ["editorImage.canvas:redacted", "editorImage.redactionStyle:solid"],
      gates: [{ flag: "image-canvas", side: "on" }],
      // Leave the editor first (its leave guard saves pending edits), waiting for the editor to
      // unmount so the save has landed before the restore. Then put the vault back so a second
      // shot opens the item as seeded.
      after: [
        { navigate: "/library" },
        { waitFor: { area: "editorImage.canvas", state: "hidden" } },
        { action: "restoreVault" },
        { action: "forgetRedactionNotice" },
      ],
    },
    "inspect-off": {
      profile: "image-inspect",
      how: "With the flag forced on, open “Settings page”: the Inspect button is in the toolbar, off.",
      steps: [open(ASSETS.settingsShot)],
      demonstrates: ["editorImage.inspectToggle:off"],
      gates: [{ flag: "image-inspect", side: "on" }],
    },
    "inspect-on": {
      profile: "image-inspect",
      how: "With the flag forced on, open “Settings page” and press Inspect: the button turns on and the side panel's Tool tab shows the Inspect controls (Width, Height, Outer, color format, As captured, Tolerance, Copy color, Colors).",
      steps: [
        open(ASSETS.settingsShot),
        inspectToggle,
        { waitFor: { area: "editorImage.inspectBar" } },
      ],
      demonstrates: [
        "editorImage.inspectToggle:on",
        "editorImage.inspectBar:hex",
        "editorImage.inspectRuler:off",
        "editorImage.toolPanel:inspect",
      ],
    },
    "inspect-as-captured": {
      profile: "image-inspect",
      how: "With the flag forced on, open “Settings page”, press Inspect, then As captured: HSL and OKLCH are disabled because the raw bytes are not sRGB.",
      steps: [
        open(ASSETS.settingsShot),
        inspectToggle,
        {
          click: {
            area: "editorImage.inspectBar",
            part: { role: "button", name: "As captured", exact: true },
          },
        },
      ],
      demonstrates: ["editorImage.inspectBar:asCaptured"],
    },
    "inspect-hud": {
      profile: "image-inspect",
      how: "With the flag forced on, open “Settings page”, press Inspect and rest the pointer on the image: the loupe and colour chip appear beside it.",
      steps: [
        open(ASSETS.settingsShot),
        inspectToggle,
        { hover: { area: "editorImage.canvas" } },
        { waitFor: { area: "editorImage.inspectHud" } },
      ],
      keepPointer: true,
      demonstrates: ["editorImage.inspectHud:reading"],
    },
    "inspect-colors": {
      profile: "image-inspect",
      how: "With the flag forced on, open “Settings page”, press Inspect, then Colors: the side panel switches to its Colors tab, which lists the image's colors, largest first, with their share; a group with more than one exact value lists them in a box.",
      steps: [
        open(ASSETS.settingsShot),
        inspectToggle,
        inspectColors,
        { waitFor: { area: "editorImage.inspectColors", part: { css: "ul" } } },
      ],
      demonstrates: ["editorImage.inspectColors:list"],
    },
    "inspect-colors-located": {
      profile: "image-inspect",
      how: "With the flag forced on, open “Settings page”, press Inspect, then Colors, and click the second color: the image dims everywhere except the pixels of that color.",
      steps: [
        open(ASSETS.settingsShot),
        inspectToggle,
        inspectColors,
        { waitFor: { area: "editorImage.inspectColors", part: { css: "ul" } } },
        {
          click: {
            area: "editorImage.inspectColors",
            part: { css: "li button[title^='Highlight']" },
            nth: 1,
          },
        },
        {
          waitFor: { area: "editorImage.canvas", part: { css: "[data-testid='inspect-locate']" } },
        },
      ],
      demonstrates: ["editorImage.inspectColors:located"],
    },
    "colors-flat": {
      profile: "image-inspect",
      how: "With the flag forced on, open “Pricing page”, press Inspect, then Colors, and turn Group off: every exact value is its own row, largest first (mock F1).",
      steps: [
        ...colorsPanelOpen(ASSETS.colorsShot),
        {
          click: {
            area: "editorImage.inspectColors",
            part: { role: "switch", name: "Group", exact: true },
          },
        },
        {
          waitFor: {
            area: "editorImage.inspectColors",
            part: { css: "[role='switch'][aria-checked='false']" },
          },
        },
      ],
      demonstrates: ["editorImage.inspectColors:flat", "editorImage.panelTabs:colors"],
    },
    "colors-grouped": {
      profile: "image-inspect",
      how: "With the flag forced on, open “Pricing page”, press Inspect, then Colors: the page white and the card's near-white, and the two pinks, each sit in an “Almost the same” box with their distance and a Show both button (mock F2).",
      steps: [
        ...colorsPanelOpen(ASSETS.colorsShot),
        { waitFor: { area: "editorImage.inspectColors", part: { text: "Almost the same" } } },
      ],
      demonstrates: ["editorImage.inspectColors:grouped", "editorImage.panelTabs:colors"],
    },
    "colors-located": {
      profile: "image-inspect",
      how: "With the flag forced on, open “Pricing page”, press Inspect, then Colors, and click the card's near-white inside its box: the image dims everywhere else and a tag under the largest area gives the color, its areas and its share (mock F3).",
      steps: [
        ...colorsPanelOpen(ASSETS.colorsShot),
        colorsRow("Highlight only #fdfdfd"),
        {
          waitFor: {
            area: "editorImage.canvas",
            part: { css: "[data-testid='inspect-locate-tag']" },
          },
        },
      ],
      demonstrates: ["editorImage.inspectColors:located"],
    },
    "colors-copied": {
      profile: "image-inspect",
      how: "With the flag forced on, open “Pricing page”, press Inspect, then Colors, and press a row's copy button: the row's bar and share are replaced by a green check and Copied for a moment (mock F5). The toast that also names the color is closed before the shot, so it is not in the image.",
      steps: [
        ...colorsPanelOpen(ASSETS.colorsShot),
        {
          click: {
            area: "editorImage.inspectColors",
            part: { role: "button", name: "Copy #fdfdfd", exact: true },
          },
        },
        { waitFor: { area: "editorImage.inspectColors", part: { text: "Copied" } } },
      ],
      keepPointer: true,
      // The mark lasts about 1.5 s: a shot taken after it went would not show the state.
      stillOnScreen: { area: "editorImage.inspectColors", part: { text: "Copied" } },
      demonstrates: ["editorImage.inspectColors:copied"],
    },
    "colors-photo": {
      profile: "image-inspect",
      how: "With the flag forced on, open “Landscape photo”, press Inspect, then Colors: the groups that cover 80% of the image, an Other row last, and a card that says it looks like a photo (mock F4).",
      steps: [
        ...colorsPanelOpen(ASSETS.photoShot),
        {
          waitFor: { area: "editorImage.inspectColors", part: { text: "This looks like a photo" } },
        },
      ],
      demonstrates: ["editorImage.inspectColors:photo"],
    },
    "panel-tabs": {
      profile: "image-inspect",
      how: "With the flag forced on, open “Settings page”: the side panel has a Tool | Beautify | Colors tab strip with Beautify selected (mock A1).",
      steps: [open(ASSETS.settingsShot), { waitFor: { area: "editorImage.panelTabs" } }],
      demonstrates: ["editorImage.panelTabs:beautify"],
    },
    "inspect-ruler": {
      profile: "image-inspect",
      how: "With the flag forced on, open “Settings page”, press Inspect, rest the pointer on the image and press 1: the horizontal pixel run under the cursor is drawn with its length, and Horizontal is on in the side panel's Tool tab.",
      steps: [
        open(ASSETS.settingsShot),
        inspectToggle,
        { hover: { area: "editorImage.canvas" } },
        { waitFor: { area: "editorImage.inspectHud" } },
        { press: "1" },
        { waitFor: { area: "editorImage.inspectRun" } },
      ],
      keepPointer: true,
      demonstrates: ["editorImage.inspectRuler:horizontal", "editorImage.inspectRun:horizontal"],
    },
    "inspect-ruler-vertical": {
      profile: "image-inspect",
      how: "With the flag forced on, open “Settings page”, press Inspect, rest the pointer on the image and press 2: the vertical pixel run under the cursor is drawn with its length beside it, and Vertical is on in the side panel's Tool tab.",
      steps: [
        open(ASSETS.settingsShot),
        inspectToggle,
        { hover: { area: "editorImage.canvas" } },
        { waitFor: { area: "editorImage.inspectHud" } },
        { press: "2" },
        { waitFor: { area: "editorImage.inspectRun" } },
      ],
      keepPointer: true,
      demonstrates: ["editorImage.inspectRuler:vertical", "editorImage.inspectRun:vertical"],
    },
    "inspect-measure-pinned": {
      profile: "image-inspect",
      how: "With the flag forced on, open “Settings page”, press Inspect, rest the pointer on the image, press 1 and click: the run stays on the image as a measurement with its length.",
      steps: [
        open(ASSETS.settingsShot),
        inspectToggle,
        { hover: { area: "editorImage.canvas" } },
        { waitFor: { area: "editorImage.inspectHud" } },
        { press: "1" },
        { waitFor: { area: "editorImage.inspectRun" } },
        { click: { area: "editorImage.canvas" } },
        { waitFor: { area: "editorImage.measure" } },
      ],
      keepPointer: true,
      demonstrates: ["editorImage.measure:pinned"],
    },
    "inspect-c1-loupe": {
      profile: "image-inspect",
      how: "Mock C1: with the flag forced on, open “Settings page”, press Inspect and rest the pointer on the image: the gridded loupe with its marked centre pixel, the colour chip with its format tag, and the mode pill at the foot of the canvas.",
      steps: [open(ASSETS.settingsShot), inspectToggle, hoverCanvas, hudShown],
      keepPointer: true,
      demonstrates: ["editorImage.inspectHud:reading", "editorImage.inspectMode:collapsed"],
    },
    "inspect-c2-format": {
      profile: "image-inspect",
      how: "Mock C2: with the flag forced on, open “Settings page”, press Inspect, choose OKLCH and As captured in the side panel's Tool tab, then rest the pointer on the image: the chip reads in OKLCH and its tag says it is as captured.",
      steps: [
        open(ASSETS.settingsShot),
        inspectToggle,
        inspectButton("OKLCH"),
        inspectButton("As captured"),
        hoverCanvas,
        hudShown,
      ],
      keepPointer: true,
      demonstrates: ["editorImage.inspectBar:asCaptured", "editorImage.inspectHud:reading"],
    },
    "inspect-c3-p3": {
      profile: "image-inspect",
      how: "Mock C3: with the flag forced on, open “P3 swatches”, a Display P3 sheet, press Inspect and rest the pointer on its teal swatch, which sRGB cannot show: the chip carries the P3 badge and the card under it explains the nearest sRGB color.",
      steps: [
        open(ASSETS.p3Shot),
        inspectToggle,
        hoverAt(0.1875, 0.75, { css: "img" }),
        hudShown,
        inCanvas("[data-ui-area='editorImage.inspectHud'][data-probed='true']"),
        { waitFor: { area: "editorImage.inspectHud", part: { text: "Out of sRGB" } } },
      ],
      keepPointer: true,
      demonstrates: ["editorImage.inspectHud:reading"],
    },
    "inspect-c4-copied": {
      profile: "image-inspect",
      how: "Mock C4: with the flag forced on, open “Settings page”, press Inspect, rest the pointer on the image and press C: the chip shows a check and the mode pill is replaced by “Copied” with the value.",
      steps: [
        open(ASSETS.settingsShot),
        inspectToggle,
        hoverCanvas,
        hudShown,
        { press: "c" },
        { waitFor: { area: "editorImage.inspectCopied" } },
      ],
      keepPointer: true,
      demonstrates: ["editorImage.inspectCopied:shown"],
    },
    "inspect-c5-width": {
      profile: "image-inspect",
      how: "Mock C5: with the flag forced on, open “Settings page”, press Inspect, rest the pointer on the image and press 1: the horizontal run is drawn with its length pill above it, and Width is on in the toolbar.",
      steps: [
        open(ASSETS.settingsShot),
        inspectToggle,
        hoverCanvas,
        hudShown,
        { press: "1" },
        runShown,
      ],
      keepPointer: true,
      demonstrates: ["editorImage.inspectRuler:horizontal", "editorImage.inspectRun:horizontal"],
    },
    "inspect-c6-height": {
      profile: "image-inspect",
      how: "Mock C6: with the flag forced on, open “Settings page”, press Inspect, rest the pointer on the image and press 2: the vertical run is drawn with its length pill beside it, and Height is on in the toolbar.",
      steps: [
        open(ASSETS.settingsShot),
        inspectToggle,
        hoverCanvas,
        hudShown,
        { press: "2" },
        runShown,
      ],
      keepPointer: true,
      demonstrates: ["editorImage.inspectRuler:vertical", "editorImage.inspectRun:vertical"],
    },
    "inspect-c7-tolerance": {
      profile: "image-inspect",
      how: "Mock C7: with the flag forced on, open “Settings page”, press Inspect, rest the pointer on the image, press 1 and turn the mouse wheel up three notches: the tolerance card with its progress bar appears beside the cursor and the toolbar's Tolerance value turns accent.",
      steps: [
        open(ASSETS.settingsShot),
        inspectToggle,
        hoverCanvas,
        hudShown,
        { press: "1" },
        runShown,
        { wheel: { area: "editorImage.canvas" }, deltaY: -100, times: 3 },
        inCanvas("[data-testid='inspect-tolerance-card']"),
      ],
      keepPointer: true,
      demonstrates: ["editorImage.inspectRun:horizontal"],
    },
    "inspect-c8-outer": {
      profile: "image-inspect",
      how: "Mock C8: with the flag forced on, open “Settings page”, press Inspect, rest the pointer on the image, press 1, turn Outer on in the side panel's Tool tab (it needs a ruler) and rest the pointer on the image again: the length pill adds the “Outer” sub-label.",
      steps: [
        open(ASSETS.settingsShot),
        inspectToggle,
        hoverCanvas,
        hudShown,
        { press: "1" },
        inspectButton("Outer"),
        hoverCanvas,
        hudShown,
        runShown,
        inCanvas("[data-testid='inspect-ruler-length'][data-outer='true']"),
      ],
      keepPointer: true,
      demonstrates: ["editorImage.inspectRun:horizontal"],
    },
    "inspect-c9-pinned": {
      profile: "image-inspect",
      how: "Mock C9: with the flag forced on, open “Measure page”, press Inspect, press 1 and click twice at two heights, press 2 and click once more, then press Escape, pick Select and click the first measurement: three pinned measurements, the selected one with an accent label and round end handles.",
      steps: [
        open(ASSETS.pinsShot),
        inspectToggle,
        // Two moves: one mouse event can land before the Inspect layer listens (seen once on the mini).
        hoverAt(0.44, 0.34),
        hoverAt(0.45, 0.35),
        hudShown,
        { press: "1" },
        runShown,
        clickAt(0.45, 0.35),
        hoverAt(0.55, 0.5),
        runShown,
        clickAt(0.55, 0.5),
        { press: "2" },
        hoverAt(0.5, 0.65),
        runShown,
        clickAt(0.5, 0.65),
        { press: "Escape" },
        tool("Select"),
        // Back on the first measurement's line (where it was pinned); its <g> root is not clickable.
        clickAt(0.45, 0.35),
        // The measure root carries data-selected; parts search below an area, so look from the canvas.
        {
          waitFor: {
            area: "editorImage.canvas",
            part: { css: "[data-kind='measure'][data-selected='true']" },
          },
        },
      ],
      demonstrates: ["editorImage.measure:selected"],
    },
    "inspect-c10-empty": {
      profile: "image-toolbar",
      how: "Mock C10: with the three image-editor flags forced on, open “Settings page”, press Inspect, zoom out and rest the pointer on the empty canvas beside the image: the loupe is hatched with “No pixels here” and the chip says “Nothing to read”.",
      steps: [
        open(ASSETS.settingsShot),
        inspectToggle,
        zoomOut,
        hoverAt(0.05, 0.5),
        { waitFor: { area: "editorImage.inspectEmpty" } },
      ],
      keepPointer: true,
      demonstrates: ["editorImage.inspectEmpty:shown"],
    },
    "inspect-c11-legend": {
      profile: "image-inspect",
      how: "Mock C11: with the flag forced on, open “Settings page”, press Inspect, rest the pointer on the image and press ?: the mode pill opens into the key legend, with a button that hides it.",
      steps: [
        open(ASSETS.settingsShot),
        inspectToggle,
        hoverCanvas,
        hudShown,
        { press: "?" },
        {
          waitFor: {
            area: "editorImage.inspectMode",
            part: { role: "button", name: "Hide the keys", exact: true },
          },
        },
      ],
      keepPointer: true,
      demonstrates: ["editorImage.inspectMode:legend"],
    },
    "inspect-c12-edge": {
      profile: "image-toolbar",
      how: "Mock C12: with the three image-editor flags forced on, open “Settings page”, press Inspect, zoom in three steps and rest the pointer near the bottom-right corner of the canvas: the loupe and chip flip to the left and above the pointer, with the chip above the loupe.",
      steps: [
        open(ASSETS.settingsShot),
        inspectToggle,
        zoomIn,
        zoomIn,
        zoomIn,
        hoverAt(0.97, 0.95),
        hudShown,
        inCanvas("[data-ui-area='editorImage.inspectHud'][data-flip-x='true'][data-flip-y='true']"),
      ],
      keepPointer: true,
      demonstrates: ["editorImage.inspectHud:reading"],
    },
    "text-none": {
      profile: "image-text",
      how: "With the flag forced on, open “Settings page” (a drawing with no text) and pick the Select text tool: once recognition finishes, the Tool tab says no text was found.",
      steps: [
        open(ASSETS.settingsShot),
        tool("Select text"),
        {
          waitFor: {
            area: "editorImage.textStatus",
            part: { text: "No text found", exact: true },
          },
          // The first recognition on a Mac compiles Vision's model, which can take a while.
          timeoutMs: 45_000,
        },
      ],
      demonstrates: ["editorImage.textStatus:noText"],
      gates: [{ flag: "image-text", side: "on" }],
    },
    "text-ready": {
      profile: "image-text",
      how: "With the flag forced on, open “Display settings” (a screenshot of a settings panel with real text) and pick the Select text tool: once recognition finishes, the Tool tab counts the words found and offers Select all and Copy text.",
      steps: openText,
      demonstrates: ["editorImage.textStatus:ready", "editorImage.toolPanel:selectText"],
      gates: [{ flag: "image-text", side: "on" }],
    },
    "text-selected": {
      profile: "image-text",
      how: "With the flag forced on, open “Display settings”, pick Select text and drag across its first row (“Language: English”): the words under the drag are highlighted on the image.",
      steps: [
        ...openText,
        {
          drag: { area: "editorImage.textSelection" },
          // The fixture is 560x340 px; the first row's text spans x 44-170 at y 92-108.
          from: { x: 60 / 560, y: 100 / 340 },
          to: { x: 190 / 560, y: 100 / 340 },
        },
        {
          waitFor: {
            area: "editorImage.textSelection",
            part: { css: "[data-testid=text-highlights]" },
          },
        },
      ],
      demonstrates: ["editorImage.textSelection:selected"],
    },
    "text-hide-ready": {
      profile: "image-text-canvas",
      how: "With both flags forced on, open “Display settings” and pick the Redact tool: once recognition finishes, the Tool tab says a click on a line of text hides it.",
      steps: openTextHide,
      demonstrates: ["editorImage.textHideHint:ready"],
      gates: [
        { flag: "image-text", side: "on" },
        { flag: "image-canvas", side: "on" },
      ],
    },
    "text-hide-hover": {
      profile: "image-text-canvas",
      how: "With both flags forced on, open “Display settings”, pick the Redact tool and rest the pointer on its first row: the line a click would hide is outlined.",
      steps: [
        ...openTextHide,
        { hover: { area: "editorImage.textHide" }, at: FIRST_ROW },
        { waitFor: { area: "editorImage.textHide", part: { css: "[data-testid=text-target]" } } },
      ],
      keepPointer: true,
      demonstrates: ["editorImage.textHide:hover"],
    },
    "text-hidden": {
      profile: "image-text-canvas",
      how: "With both flags forced on, open “Display settings”, pick the Redact tool and click its first row: that line is blurred, and the rows around it stay sharp.",
      steps: [
        ...openTextHide,
        // A press and release on the same point is a click.
        { drag: { area: "editorImage.textHide" }, from: FIRST_ROW, to: FIRST_ROW },
        {
          waitFor: { area: "editorImage.textHide", part: { css: "[data-testid=redaction-tile]" } },
        },
      ],
      demonstrates: ["editorImage.textHide:hidden"],
    },
    "text-reading": {
      profile: "image-text-slow",
      how: "Mock G1 (recognizing text on open). With the flag forced on and text recognition held for a minute, open “Display settings”: a faint accent band sweeps the image and a quiet notice at the bottom-left, right of the zoom control, reads “Reading the text in this image…”.",
      steps: [open(ASSETS.textShot), { waitFor: { area: "editorImage.textNotice" } }],
      demonstrates: ["editorImage.textNotice:reading"],
      gates: [{ flag: "image-text", side: "on" }],
    },
    "text-pending": {
      profile: "image-text-slow",
      how: "With the flag forced on and text recognition held for a minute, open “Display settings” and pick Select text: the Tool tab reads “Recognizing text…”.",
      steps: [
        open(ASSETS.textShot),
        tool("Select text"),
        {
          waitFor: {
            area: "editorImage.textStatus",
            part: { text: "Recognizing text", exact: false },
          },
        },
      ],
      demonstrates: ["editorImage.textStatus:pending"],
      gates: [{ flag: "image-text", side: "on" }],
    },
    "text-hover": {
      profile: "image-text",
      how: "Mock G2 (hover over recognized text). With the flag forced on, open “Display settings”, pick Select text and rest the pointer on its first row: every line has a dotted accent underline, the row under the pointer a soft accent fill and a small “Text · drag to select” tag, and the pointer is the text cursor.",
      steps: [
        ...openText,
        {
          // Line 0 is the title bar, so line 1 (nth 1) is the first row, "Language: English"
          // (x 44-170 at y 92-108 of the 560x340 fixture).
          hover: {
            area: "editorImage.textSelection",
            part: { css: "[data-testid=text-line-box]" },
            nth: 1,
          },
        },
        {
          waitFor: {
            area: "editorImage.textSelection",
            part: { css: "[data-testid=text-line-tag]" },
          },
        },
      ],
      keepPointer: true,
      demonstrates: ["editorImage.textSelection:hover"],
    },
    "text-copied": {
      profile: "image-text",
      how: "Mock G3 (two-line selection and copy confirmation). With the flag forced on, open “Display settings”, pick Select text, drag from its first row (“Language: English”) down to its second (“Theme: Dark mode”) and click Copy text (the same copy as Cmd+C): the toast says “Text copied” and “2 lines”.",
      steps: [
        ...openText,
        {
          drag: { area: "editorImage.textSelection" },
          // Rows of the 560x340 fixture: first at y 92-108, second at y 148-164.
          from: { x: 60 / 560, y: 100 / 340 },
          to: { x: 190 / 560, y: 156 / 340 },
        },
        {
          waitFor: {
            area: "editorImage.textSelection",
            part: { css: "[data-testid=text-highlights]" },
          },
        },
        // The panel's Copy text runs the same copy as Cmd+C. A click gives the page focus and a
        // user gesture, which the clipboard write needs under the driver; a bare keypress did not
        // copy there. The toast renders in the app shell, outside this screen's areas, so no step
        // can wait on it; `keepToasts` leaves it open for the shot.
        {
          click: {
            area: "editorImage.textStatus",
            part: { role: "button", name: "Copy text", exact: true },
          },
        },
      ],
      keepToasts: true,
      demonstrates: ["editorImage.textSelection:copied"],
      gates: [{ flag: "image-text", side: "on" }],
    },
    "text-unavailable": {
      profile: "image-text-unavailable",
      how: "Mock G4 (recognition unavailable). With the flag forced on and text recognition answering unavailable, open “Display settings”: a quiet notice at the bottom-left reads “Text can't be selected on this computer. Everything else works.”, with no error dialog.",
      steps: [open(ASSETS.textShot), { waitFor: { area: "editorImage.textNotice" } }],
      demonstrates: ["editorImage.textNotice:unavailable"],
      gates: [{ flag: "image-text", side: "on" }],
    },
    "text-unavailable-panel": {
      profile: "image-text-unavailable",
      how: "With the flag forced on and text recognition answering unavailable, open “Display settings” and pick Select text: the Tool tab says text recognition is not available.",
      steps: [
        open(ASSETS.textShot),
        tool("Select text"),
        {
          waitFor: {
            area: "editorImage.textStatus",
            part: { text: "not available", exact: false },
          },
        },
      ],
      demonstrates: ["editorImage.textStatus:unavailable"],
      gates: [{ flag: "image-text", side: "on" }],
    },
    "reopen-editable": {
      profile: "image-canvas",
      how: "With the flag forced on, open “Settings page”, pick Step, click the canvas, press Save and answer Overwrite; leave the editor and open “Settings page” again: a pill at the top of the stage says it reopened with everything editable, with the time it was saved, and fades after about four seconds.",
      steps: [
        open(ASSETS.settingsShot),
        tool("Step"),
        { click: { area: "editorImage.canvas" } },
        {
          click: {
            area: "editorImage.toolbar",
            part: { role: "button", name: "Save", exact: true },
          },
        },
        { click: { area: "editorImage.page", part: { role: "button", name: "Overwrite" } } },
        {
          waitFor: {
            area: "editorImage.toolbar",
            part: { role: "button", name: "Saved", exact: true },
          },
        },
        { navigate: "/library" },
        open(ASSETS.settingsShot),
        { waitFor: { area: "editorImage.reopenNotice" } },
      ],
      demonstrates: ["editorImage.reopenNotice:editable"],
      gates: [{ flag: "image-canvas", side: "on" }],
      // Save wrote the step annotation into the profile's vault: restore it so “Settings page”
      // opens unmodified in canvas-light and in a second shot of this state.
      after: [{ action: "restoreVault" }],
    },
    "reopen-flat": {
      profile: "image-canvas-unreadable",
      how: "With the flag forced on and a corrupt editable document beside “Settings page”, open it: the flat image opens, with a pill that says the earlier drawings are part of it now and can no longer be moved, and stays until dismissed.",
      steps: [open(ASSETS.settingsShot), { waitFor: { area: "editorImage.reopenNotice" } }],
      demonstrates: ["editorImage.reopenNotice:flat"],
      gates: [{ flag: "image-canvas", side: "on" }],
    },
    "canvas-light": {
      profile: "image-canvas",
      how: "With the flag forced on, switch to the light theme and open “Settings page”: the canvas's dot grid takes the light colours.",
      steps: [theme("light"), open(ASSETS.settingsShot)],
      demonstrates: ["editorImage.canvasView:light"],
      gates: [{ setting: "theme", side: "light" }],
      after: [theme("dark")],
    },
  },
  {
    notCapturable: {
      "editorImage.textHideHint:pending": nc(
        "needsSetup",
        "only the image-text-slow profile holds recognition, and it does not force image-canvas, which the hint needs; a canvas variant of that profile would show it (not built). The hint reads “Recognizing text…” until recognition settles",
      ),
      "editorImage.libraryPicker:empty": nc(
        "needsSetup",
        "the picker leaves out the shot being edited, and the seeded vault holds three screenshots, so it always lists two; a vault with a single screenshot would show it (not built)",
      ),
      "editorImage.inspectColors:counting": nc(
        "transient",
        "the count of a catalog-sized image ends in well under a second, before a screenshot can be taken",
      ),
      "editorImage.inspectColors:error": nc(
        "inducedFailure",
        "shown only when the image cannot be decoded or the colors worker fails; the page tests pin it",
      ),
    },
  },
);
