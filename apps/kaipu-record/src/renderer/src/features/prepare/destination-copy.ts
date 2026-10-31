import type { Messages } from "@kaipu/i18n";
import type { DestinationGroupId, DestinationId } from "./destinations";

type PrepareKey = keyof Messages["prepare"];

/**
 * The words for each destination (NIW2-578): its name, the short line in the list, the
 * sentence the detail opens with, and why the copy is bigger or smaller. Plain language only —
 * never bitrate or fps.
 */
export const DESTINATION_COPY = {
  youtube: { name: "destYoutube", line: "lineYoutube", say: "sayYoutube", why: "whyYoutube" },
  vertical: { name: "destVertical", line: "lineVertical", say: "sayVertical", why: "whyVertical" },
  square: { name: "destSquare", line: "lineSquare", say: "saySquare", why: "whySquare" },
  github: { name: "destGithub", line: "lineGithub", say: "sayGithub", why: "whyGithub" },
  chat: { name: "destChat", line: "lineChat", say: "sayChat", why: "whyChat" },
  email: { name: "destEmail", line: "lineEmail", say: "sayEmail", why: "whyEmail" },
  archive: { name: "destArchive", line: "lineArchive", say: "sayArchive", why: "whyArchive" },
} as const satisfies Record<
  DestinationId,
  { name: PrepareKey; line: PrepareKey; say: PrepareKey; why: PrepareKey }
>;

/** Each group's label, the reason under it, and the question its "why" paragraph answers. */
export const GROUP_COPY = {
  "send-more": { label: "groupSendMore", reason: "groupSendMoreWhy", whyTitle: "whyBigger" },
  "keep-light": { label: "groupKeepLight", reason: "groupKeepLightWhy", whyTitle: "whySmaller" },
  keep: { label: "groupKeep", reason: "groupKeepWhy", whyTitle: "whyKeep" },
} as const satisfies Record<
  DestinationGroupId,
  { label: PrepareKey; reason: PrepareKey; whyTitle: PrepareKey }
>;
