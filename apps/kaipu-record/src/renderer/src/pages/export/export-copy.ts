import type { Messages } from "@kaipu/i18n";
import type { DestinationGroupId, DestinationId } from "@renderer/features/prepare/destinations";

type ExportKey = keyof Messages["export"];

/**
 * Each destination's name on the Export screen: the card in the bottom row, "For …" and the
 * button. Shorter than Prepare's list names (`DESTINATION_COPY`), which the recording page and
 * the status cards keep using.
 */
export const EXPORT_NAME = {
  youtube: "cardYoutube",
  vertical: "cardVertical",
  square: "cardSquare",
  github: "cardGithub",
  chat: "cardChat",
  email: "cardEmail",
  archive: "cardArchive",
} as const satisfies Record<DestinationId, ExportKey>;

/** The one sentence under "For …": why this group's copy is bigger, lighter or kept whole. */
export const GROUP_SENTENCE = {
  "send-more": "sentenceUpload",
  "keep-light": "sentenceLight",
  keep: "sentenceKeep",
} as const satisfies Record<DestinationGroupId, ExportKey>;

/** The bottom row, left to right: what gets bigger, then what stays light, then Keep. */
export const EXPORT_ORDER: readonly DestinationId[] = [
  "youtube",
  "vertical",
  "square",
  "github",
  "chat",
  "email",
  "archive",
];
