import { useEffect, useState } from "react";
import { useTranslations } from "@kaipu/i18n";
import type { RecordingShadeView } from "@shared/types/ipc";
import type { CaptureRect } from "@shared/types/screenshot-capture";
import { CountdownOverlay } from "@renderer/features/recording/components/countdown-overlay";
import styles from "./recording-shade.module.css";

/** Room the REC tag needs above the area's border before it moves inside. */
const TAG_ROOM_DIP = 30;

/** The slice of the preload bridge the shade uses; tests pass a fake. */
export interface RecordingShadeApi {
  onRecordingShadeState(callback: (state: RecordingShadeView) => void): () => void;
}

/**
 * The marker over the recorded display (`?window=recording-shade`), loaded once and reused:
 * the region and phase arrive as state. Main makes the window
 * click-through and content-protected, so this paints and does nothing else.
 *
 * - Countdown: the shared `CountdownOverlay` (the Record page's pink countdown), confined
 *   to the region with everything outside dimmed, or over the whole display.
 * - Recording an area: the area is clear and everything around it dark, as the screenshot
 *   overlay does (spec "Record capture modes" decision 4), with a 2 px pink border 3 px outside the area and
 *   a "REC · border not recorded" tag on top (design "Kaipu Record Modes").
 * - Recording a whole display (`rect` null): only a 3 px pink border around the display.
 */
export function RecordingShade({
  rect: initialRect = null,
  initialState = { phase: "idle" },
  api = window.electronAPI,
}: {
  rect?: CaptureRect | null;
  initialState?: RecordingShadeView;
  api?: RecordingShadeApi;
}): React.JSX.Element {
  const t = useTranslations("record");
  const [state, setState] = useState<RecordingShadeView>(initialState);
  // The region travels with the state (the window is reused across takes); a view without
  // one keeps the last.
  const [rect, setRect] = useState<CaptureRect | null>(initialRect);
  useEffect(
    () =>
      api.onRecordingShadeState((view) => {
        if (view.rect !== undefined) setRect(view.rect);
        setState(view);
      }),
    [api],
  );

  // Neutral: the preloaded window waits here, and a hidden one is reset to it.
  if (state.phase === "idle") return <></>;

  if (state.phase === "countdown") {
    // The same pink countdown the Record page shows; click-through here, so no Cancel
    // button: Esc is a global shortcut the hub holds, and the hint says so.
    return <CountdownOverlay value={state.value} region={rect} hint={t("shadeCountdownHint")} />;
  }

  if (!rect) {
    return <div className={styles.displayBorder} data-testid="recording-shade-display" />;
  }
  return (
    <>
      <div
        className={styles.area}
        data-testid="recording-shade-area"
        style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      />
      <div
        className={styles.border}
        data-testid="recording-shade-border"
        // No room above the area for the tag (it would leave the display): draw it inside.
        data-tag-inside={rect.y < TAG_ROOM_DIP}
        style={{
          left: rect.x - 5,
          top: rect.y - 5,
          width: rect.width + 10,
          height: rect.height + 10,
        }}
      >
        <span className={styles.tag}>
          <span className={styles.tagDot} aria-hidden />
          {t("shadeRecTag")}
        </span>
      </div>
    </>
  );
}
