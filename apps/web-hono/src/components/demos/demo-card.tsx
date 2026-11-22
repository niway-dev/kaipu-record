import type { CSSProperties, ReactElement } from "react";

import styles from "./demo-card.module.css";
import { EditorDemo } from "./editor-demo";
import { ShareDemo } from "./share-demo";
import { useOnScreen } from "./use-on-screen";
import { useReducedMotion } from "./use-reduced-motion";
import { WorkspacesDemo } from "./workspaces-demo";

export type DemoId = "editor" | "workspaces" | "share";

const DEMOS = {
  editor: EditorDemo,
  workspaces: WorkspacesDemo,
  share: ShareDemo,
} as const;

/**
 * The demos read three tokens the desktop app defines globally. The landing does not, so the
 * card supplies them: the product pink, and the landing's own mono and sans stacks.
 */
const TOKENS = {
  "--accent-primary": "#f6055c",
  "--font-mono": "var(--kl-font-mono)",
  "--font-family": "var(--kl-font-sans)",
} as CSSProperties;

/**
 * One running demo. It plays only while it is on screen: an IntersectionObserver flips
 * `data-paused`, and the stylesheet in demo-card.module.css pauses every animation inside while it
 * is set, so an off-screen demo costs no frames. Under `prefers-reduced-motion` the demo
 * renders its still frame instead and the observer is not needed.
 *
 * It starts as "visible" so a server-rendered or script-less page never shows a paused
 * (invisible, at second 0) stage; the observer corrects it on the first callback.
 */
export function DemoCard({ id }: { id: DemoId }): ReactElement {
  const reducedMotion = useReducedMotion();
  const { ref, onScreen } = useOnScreen<HTMLDivElement>();

  const Demo = DEMOS[id];
  return (
    <div
      ref={ref}
      className={styles.card}
      data-demo-card={id}
      data-paused={!reducedMotion && !onScreen ? "" : undefined}
      style={TOKENS}
    >
      <Demo reducedMotion={reducedMotion} />
    </div>
  );
}
