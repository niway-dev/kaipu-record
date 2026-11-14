import { createElement, type ComponentType, type ReactElement } from "react";
import { CaptureDemo } from "./capture-demo";
import { EditorDemo } from "./editor-demo";
import {
  CaptureIcon,
  EditorIcon,
  RecordIcon,
  ShareIcon,
  WorkspacesIcon,
  type IconProps,
} from "./icons";
import { RecordDemo } from "./record-demo";
import { ShareDemo } from "./share-demo";
import { WorkspacesDemo } from "./workspaces-demo";

export type DemoId = "record" | "capture" | "share" | "editor" | "workspaces";

/** Card order on the Welcome step. */
export const DEMO_IDS: readonly DemoId[] = ["record", "capture", "share", "editor", "workspaces"];

/** The icon of each demo's card. */
export const DEMO_ICONS: Record<DemoId, ComponentType<IconProps>> = {
  record: RecordIcon,
  capture: CaptureIcon,
  share: ShareIcon,
  editor: EditorIcon,
  workspaces: WorkspacesIcon,
};

const DEMOS: Record<DemoId, ComponentType<{ reducedMotion: boolean }>> = {
  record: RecordDemo,
  capture: CaptureDemo,
  share: ShareDemo,
  editor: EditorDemo,
  workspaces: WorkspacesDemo,
};

/** One animated demo: a 660 x 330 stage and its beat chips. Pass the user's reduced-motion setting. */
export function OnboardingDemo({
  id,
  reducedMotion,
}: {
  id: DemoId;
  reducedMotion: boolean;
}): ReactElement {
  return createElement(DEMOS[id], { reducedMotion });
}

export { DEMO_CURSOR_COLOR } from "./scene";
export { useReducedMotion } from "./use-reduced-motion";
export { useDemoText, type DemoKey } from "./demo-text";
