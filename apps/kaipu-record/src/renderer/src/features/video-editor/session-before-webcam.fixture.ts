/**
 * A session as the editor saved it before the webcam layer existed (main at bbbc0b80, before
 * the NIW2-565 stack): every v2 field present — a cut, a manual zoom, a cover region, a
 * muted range — and no `webcam` key. Frozen on purpose: the parser and the loader must keep
 * opening it unchanged (review W6). Do not regenerate it from the current serializer.
 */
export const SESSION_BEFORE_WEBCAM = JSON.stringify({
  version: 1,
  scene: {
    items: [
      { id: "clip-a", kind: "clip", sourceStart: 0, sourceEnd: 8 },
      { id: "clip-b", kind: "clip", sourceStart: 12, sourceEnd: 30 },
    ],
    overlays: [],
    zoomSegments: [
      {
        id: "zoom-1",
        start: 2,
        end: 5,
        scale: 2,
        mode: "fixed",
        anchor: { x: 0.3, y: 0.4 },
        smoothing: 50,
        origin: "manual",
        trigger: null,
      },
    ],
    redactions: [
      {
        id: "cover-1",
        kind: "cover",
        start: 14,
        end: 18,
        rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 },
        fill: "#18181b",
        label: "",
      },
    ],
    zoomSensitivity: 50,
    audioMuted: false,
    mutedRanges: [{ id: "mute-1", sourceStart: 20, sourceEnd: 22 }],
  },
});
