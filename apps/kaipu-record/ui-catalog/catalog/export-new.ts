import { catalog } from "../types";
import { nc } from "./not-capturable";

/**
 * Export with no video (`#/export`): the door for any video, with the Library picker and the
 * recent exports under the drop zone. The seeded “Walkthrough 1 (light)” is an exported copy,
 * so Recent exports has a row.
 */
export const exportNew = catalog(
  "exportNew",
  {
    empty: {
      profile: "default",
      steps: [{ navigate: "/export" }],
      demonstrates: [
        "exportNew.page:empty",
        "exportNew.header:default",
        "exportNew.dropZone:idle",
        "exportNew.recentExports:list",
      ],
    },
    "pick-video": {
      profile: "default",
      how: "Open Export with no video and press Pick from Library: the Pick a video to export modal lists the Library's originals, newest first, with the first one selected and its muted quick look paused at the first frame on the right.",
      steps: [
        { navigate: "/export" },
        {
          click: {
            area: "exportNew.dropZone",
            part: { role: "button", name: "Pick from Library" },
          },
        },
        {
          waitFor: {
            area: "exportNew.pickVideoModal",
            part: { role: "button", name: "Walkthrough 1" },
          },
        },
        { waitFor: { video: "paused-at-start", within: "exportNew.pickVideoModal" } },
        { waitMs: 400 },
      ],
      demonstrates: ["exportNew.pickVideoModal:open"],
      ready: { area: "exportNew.pickVideoModal" },
    },
  },
  {
    notCapturable: {
      "exportNew.page:dragging": nc(
        "transient",
        "a transient state while a file is dragged over the window",
      ),
      "exportNew.dropZone:dragging": nc(
        "transient",
        "a transient state while a file is dragged over the window",
      ),
      "exportNew.dropZone:importing": nc(
        "transient",
        "a transient state while a dropped video is brought in",
      ),
    },
  },
);
