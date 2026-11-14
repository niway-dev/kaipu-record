import { useTranslations } from "@kaipu/i18n";

/** Every translatable word in the demos. Namespace `onboarding.demos`. */
export type DemoKey =
  // shared
  | "frame"
  | "record"
  | "copied"
  // record
  | "recMic"
  | "recSystem"
  | "recBeatMic"
  | "recBeatSystem"
  | "recBeatCamera"
  | "recBeatRecording"
  // capture
  | "capAnnotation"
  | "capBeatSelect"
  | "capBeatEditor"
  | "capBeatBox"
  | "capBeatSteps"
  | "capBeatMeasure"
  | "capBeatText"
  | "capBeatCopy"
  | "capCopy"
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

/** The demos' translator, over the nested `onboarding.demos` namespace. */
export function useDemoText(): DemoText {
  return useTranslations("onboarding.demos");
}
