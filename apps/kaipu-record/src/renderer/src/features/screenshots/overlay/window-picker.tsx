import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "@kaipu/i18n";
import type { CaptureOverlayBridge } from "@shared/types/electron-api";
import type { CaptureAction, CaptureRect, ListedWindow } from "@shared/types/screenshot-capture";
import type { SendAnswer } from "./capture-overlay";
import { actionForKey } from "./overlay-keys";
import { workAreaInWindow, type OverlayQuery } from "./overlay-query";
import { CHROME_GAP_DIP, SelectionToolbar, type OverlayChrome } from "./selection-chrome";
import styles from "./capture-overlay.module.css";

/** Room the title label needs above the highlight before it moves inside. */
const LABEL_ROOM_DIP = 30;

function contains(rect: CaptureRect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

/**
 * The front-most window of `windows` under the point, among those on `displayId`. The list is
 * in z-order, front first (as the OS listers return it), and its rects are display-relative
 * DIP, the overlay window's own coordinates.
 */
export function windowAt(
  windows: readonly ListedWindow[],
  displayId: number,
  x: number,
  y: number,
): ListedWindow | null {
  return (
    windows.find((window) => window.displayId === displayId && contains(window.rect, x, y)) ?? null
  );
}

/** "Kaipu Record — Editor · 1536 × 893": the owner, the title when it says more, the size. */
export function windowLabel(window: ListedWindow): string {
  const name =
    window.title && window.title !== window.ownerName && window.ownerName
      ? `${window.ownerName} — ${window.title}`
      : window.title || window.ownerName;
  return `${name} · ${Math.round(window.rect.width)} × ${Math.round(window.rect.height)}`;
}

interface WindowPickerProps {
  query: OverlayQuery;
  bridge: Pick<CaptureOverlayBridge, "hover">;
  /** Main's list: `null` while the lister runs, `[]` when it found none. */
  windows: ListedWindow[] | null;
  /** Main's word on which display the pointer is over. */
  hoverDisplayId: number | null;
  /** The pointer in global DIP when the list landed (main's `OverlayState.cursor`). */
  cursor: { x: number; y: number } | null;
  chrome: OverlayChrome;
  send: SendAnswer;
}

/**
 * Window mode: the window under the pointer is highlighted (accent fill, 2 px accent border,
 * its title above it) with the mode pill and the action bar attached. A click captures the
 * window under the click; a click where there is no window answers nothing. Enter and
 * ⌘C / Ctrl+C capture or copy the highlighted one.
 *
 * Keyboard focus follows the pointer: entering this display tells main (`hover`), which
 * makes this overlay the key window, so Enter acts on the highlight the user sees. When the
 * list lands, the window under the pointer is highlighted at once, even if it never moved.
 */
export function WindowPicker({
  query,
  bridge,
  windows,
  hoverDisplayId,
  cursor,
  chrome,
  send,
}: WindowPickerProps): React.JSX.Element {
  const t = useTranslations("screenshots");
  const area = useMemo(() => workAreaInWindow(query), [query]);
  const onDisplay = useMemo(
    () => (windows ?? []).filter((window) => window.displayId === query.displayId),
    [windows, query.displayId],
  );
  const [hovered, setHovered] = useState<ListedWindow | null>(null);

  // A new list (or a list without the hovered window) must not keep a stale highlight.
  useEffect(() => {
    setHovered((current) =>
      current ? (onDisplay.find((window) => window.id === current.id) ?? null) : null,
    );
  }, [onDisplay]);

  // Until the pointer moves over this overlay, main's pointer (sent with every state once the
  // list has landed) decides the highlight, so Enter works on a list that landed under a
  // still pointer. After the first local pointer event, local tracking alone decides.
  const pointerSeen = useRef(false);
  useEffect(() => {
    if (pointerSeen.current || !cursor) return;
    setHovered(
      windowAt(onDisplay, query.displayId, cursor.x - query.bounds.x, cursor.y - query.bounds.y),
    );
  }, [cursor, onDisplay, query.displayId, query.bounds]);

  // What main believes is hovered: report only when it disagrees (one message, not one per move).
  const reported = useRef<number | null>(hoverDisplayId);
  useEffect(() => {
    reported.current = hoverDisplayId;
  }, [hoverDisplayId]);
  const reportPointerHere = (): void => {
    if (reported.current === query.displayId) return;
    reported.current = query.displayId;
    bridge.hover(query.displayId);
  };

  const answer = (window: ListedWindow, action: CaptureAction): void => {
    send({
      kind: "window",
      mode: "window",
      action,
      displayId: query.displayId,
      windowId: window.id,
      rect: window.rect,
    });
  };

  const latest = useRef({ hovered, answer });
  latest.current = { hovered, answer };
  const platform = chrome.platform;
  const intent = chrome.intent;

  // Layout effect: the picker hears Enter from the commit that paints it (see FrameBox).
  useLayoutEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // A window is captured, never recorded from here (Window keeps the thumbnail picker).
      // Opened to record, Enter means "use selection", which a window cannot be: nothing.
      const keyed = actionForKey(event, platform, intent);
      const action = keyed === "capture" || keyed === "copy" ? keyed : null;
      const target = latest.current.hovered;
      if (!action || !target) return;
      event.preventDefault();
      latest.current.answer(target, action);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [platform, intent]);

  const track = (event: React.PointerEvent<HTMLDivElement>): void => {
    pointerSeen.current = true;
    reportPointerHere();
    const { clientX: x, clientY: y } = event;
    const next = windowAt(onDisplay, query.displayId, x, y);
    if (next?.id === hovered?.id) return;
    // The toolbar sits 10 DIP outside the highlight: crossing that gap on the way
    // to them must not hand the highlight to the window behind (the chrome itself keeps
    // its pointer moves to itself).
    if (hovered) {
      const { rect } = hovered;
      const gap = CHROME_GAP_DIP;
      const bridged = {
        x: rect.x - gap,
        y: rect.y - gap,
        width: rect.width + 2 * gap,
        height: rect.height + 2 * gap,
      };
      if (!contains(rect, x, y) && contains(bridged, x, y)) return;
    }
    setHovered(next);
  };

  const onClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const target = windowAt(onDisplay, query.displayId, event.clientX, event.clientY);
    if (target) answer(target, "capture");
  };

  const status =
    windows === null
      ? t("overlay.findingWindows")
      : onDisplay.length === 0
        ? t("overlay.noWindows")
        : null;

  return (
    <div
      className={`${styles.sheet} ${hovered ? styles.clear : ""} ${styles.windowSheet}`}
      data-testid="window-picker"
      onPointerMove={track}
      onPointerEnter={track}
      onClick={onClick}
    >
      {status && (
        <div className={styles.statusLayer}>
          <span className={styles.movePill} role="status">
            {status}
          </span>
        </div>
      )}
      {hovered && (
        <>
          <div
            className={styles.windowHighlight}
            data-testid="window-highlight"
            data-window-id={hovered.id}
            style={{
              left: hovered.rect.x,
              top: hovered.rect.y,
              width: hovered.rect.width,
              height: hovered.rect.height,
            }}
          />
          <div
            className={styles.windowLabel}
            style={{
              left: hovered.rect.x,
              top:
                hovered.rect.y - LABEL_ROOM_DIP < area.y
                  ? hovered.rect.y + 8
                  : hovered.rect.y - LABEL_ROOM_DIP,
              marginLeft: hovered.rect.y - LABEL_ROOM_DIP < area.y ? 8 : 0,
            }}
          >
            {windowLabel(hovered)}
          </div>
          <SelectionToolbar
            chrome={chrome}
            selection={hovered.rect}
            area={area}
            onAction={(action) => answer(hovered, action)}
            // A window is captured, not recorded, from here (ADR 0030 non-goal).
            canRecord={false}
          />
        </>
      )}
    </div>
  );
}
