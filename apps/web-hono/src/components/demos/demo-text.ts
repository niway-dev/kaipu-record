/**
 * Ported from apps/kaipu-record/src/renderer/src/features/onboarding/demos/demo-text.ts
 * (the desktop onboarding demos). Copied, not shared: a shared package is a follow-up.
 * Keep the choreography in sync by hand until then.
 */
import { useTranslations } from "@kaipu/i18n";

/**
 * Every translatable word in the three ported demos. Namespace `landing.demos`: the keys are
 * copied from the desktop's `onboarding.demos` so the landing's message slice stays small.
 */
export type DemoKey =
  // share
  | "shareOriginalCaption"
  | "shareQuestion"
  | "shareLightNote"
  | "shareFullNote"
  | "shareDestChat"
  | "shareDestGithubDesc"
  | "shareDestChatDesc"
  | "shareDestYoutubeDesc"
  | "shareDestVerticalDesc"
  | "shareBeatGithub"
  | "shareBeatYoutube"
  | "shareBeatOriginal"
  // editor
  | "edSectionIntro"
  | "edSectionDemo"
  | "edSectionWrapUp"
  | "edAnnotation"
  | "edBeatSections"
  | "edBeatZoom"
  | "edBeatPrivate"
  | "edBeatPoint"
  // workspaces
  | "wsPersonal"
  | "wsWork"
  | "wsClient"
  | "wsThisMac"
  | "wsFolderWork"
  | "wsFolderClient"
  | "wsNewRecording"
  | "wsSaved"
  | "wsBeatPersonal"
  | "wsBeatSwitch"
  | "wsBeatSaved";

export type DemoText = (key: DemoKey) => string;

/** The demos' translator, over the nested `landing.demos` namespace. */
export function useDemoText(): DemoText {
  return useTranslations("landing.demos");
}
