import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AppWindow,
  Camera,
  ChevronDown,
  ChevronsLeftRight,
  ChevronsRightLeft,
  Copy,
  Frame,
  Lock,
  Mic,
  Monitor,
  SlidersHorizontal,
  Video,
  Volume2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import {
  RECORDING_RATIOS,
  type CaptureAction,
  type CaptureMode,
  type CaptureRect,
  type RecordingRatio,
} from "@shared/types/screenshot-capture";
import type { OverlayChrome } from "./overlay-chrome";
import { controlKeyLabel, copyKeyLabel, type InputToggleKey } from "./overlay-keys";
import type { WidgetDevice, WidgetDevices } from "./use-widget-devices";
import { COMPACT_LEVEL, fitLevel, widgetLook } from "./widget-fit";
import { widgetFitWidth, widgetPlacement, type WidgetEdge } from "./widget-placement";
import styles from "./capture-widget.module.css";
import { uiArea } from "@renderer/lib/ui-area";

/** How long a key toggle's toast and its halo stay (the issue's 1.5 s). */
export const TOAST_MS = 1500;
/** The widget's height before it has been measured (one row and its padding). */
const FIRST_HEIGHT_DIP = 60;
const NO_WIDTHS: readonly number[] = [];

const MODE_ICON: Record<CaptureMode, LucideIcon> = {
  frame: Frame,
  window: AppWindow,
  screen: Monitor,
};

/**
 * Presses, moves and clicks on the widget stay on the widget: they must not start a frame
 * drag, change the hovered window, or answer the display underneath.
 */
export const keepPointer = {
  onPointerDown: (event: React.PointerEvent) => event.stopPropagation(),
  onPointerMove: (event: React.PointerEvent) => event.stopPropagation(),
  onClick: (event: React.MouseEvent) => event.stopPropagation(),
};

const INPUTS = [
  {
    key: "isMicrophoneEnabled",
    icon: Mic,
    label: "overlay.toggleMicrophone",
    short: "widget.shortMicrophone",
    hint: "M",
    state: "microphone",
  },
  {
    key: "isSystemAudioEnabled",
    icon: Volume2,
    label: "overlay.toggleSystemAudio",
    short: "widget.shortSystemAudio",
    hint: "A",
    state: "systemAudio",
  },
  {
    key: "isCameraEnabled",
    icon: Camera,
    label: "overlay.toggleCamera",
    short: null,
    hint: "W",
    state: "camera",
  },
] as const satisfies readonly {
  key: InputToggleKey;
  icon: LucideIcon;
  label: string;
  /** The shorter name for a tight row, or null when the name is already short. */
  short: string | null;
  hint: string;
  state: "microphone" | "systemAudio" | "camera";
}[];

function Kbd({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <kbd className={styles.kbd} aria-hidden>
      {children}
    </kbd>
  );
}

/** What the Screen mode's display chip prints for the display this widget sits on. */
export interface WidgetDisplay {
  /** "Display 2". */
  name: string;
  /** "1600 × 1000", in DIP. */
  resolution: string;
  /** "Built-in" or "External". */
  kind: string;
}

interface CaptureWidgetProps {
  chrome: OverlayChrome;
  /** The box the widget must not cover when it can help it; `null` is the whole display (Screen). */
  selection: CaptureRect | null;
  /** The work area in window coordinates. */
  area: CaptureRect;
  ratio: RecordingRatio;
  /** Absent when the mode has no box to lock to (Screen, Window): the ratio menu is not offered. */
  onRatio?(ratio: RecordingRatio): void;
  /** What is captured, in device pixels, for the read-only readout. */
  size: { width: number; height: number };
  /** The display the widget sits on; Screen mode shows it in the contextual slot. */
  display?: WidgetDisplay;
  /** False for a box under the recording minimum: it can be shot, never recorded. */
  canRecord: boolean;
  /** The widget's own actions; keys reach the same handlers through the mode's key listener. */
  onAction(action: CaptureAction): void;
  devices?: WidgetDevices;
}

/**
 * Closes `close` when the pointer goes down anywhere outside `ref`, while `open` is true.
 * Capture phase, so a control that stops its own pointer events cannot keep a menu open.
 */
function useDismissOnOutsidePress(
  ref: React.RefObject<HTMLElement | null>,
  open: boolean,
  close: () => void,
): void {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [ref, open, close]);
}

/**
 * The one capture toolbar (ADR 0056), one row docked to the bottom of the work area, or to its
 * top when the selection reaches the bottom band. Compact by default: icon chips, each with its
 * key badge. The Control key alone (or the badge at the end) expands it to labels, the input
 * switches, the size readout and the soon Window chip; each capture type remembers its mode.
 * After the area comes a contextual slot: the ratio menu in Frame, the display chip in Screen.
 * What the intent needs follows (inputs, or Copy), then Cancel and the confirm button. During
 * the countdown it dims, except Cancel and the confirm button, and a number disc counts down on
 * the selection. It enters from the edge it is docked to.
 */
export function CaptureWidget({
  chrome,
  selection,
  area,
  ratio,
  onRatio,
  size,
  display,
  canRecord,
  onAction,
  devices,
}: CaptureWidgetProps): React.JSX.Element {
  const t = useTranslations("screenshots");
  const tCamera = useTranslations("cameraSettings");
  const root = useRef<HTMLDivElement | null>(null);
  // True from a mouse press on the widget until the next Tab: focus then came from the pointer.
  const pointerFocus = useRef(false);
  const [box, setBox] = useState({ width: 0, height: FIRST_HEIGHT_DIP, measured: false });
  const measureBox = useCallback((): number => {
    const element = root.current;
    if (!element) return 0;
    const rect = element.getBoundingClientRect();
    const height = Math.ceil(rect.height);
    const width = Math.ceil(rect.width);
    setBox((current) => {
      const next = {
        width: width > 0 ? width : current.width,
        height: height > 0 ? height : current.height,
        measured: true,
      };
      return next.width === current.width && next.height === current.height && current.measured
        ? current
        : next;
    });
    return width;
  }, []);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      measureBox();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [measureBox]);

  // Expanded is always one row. The row is as wide as its content (it never wraps), so how much
  // of the expanded look fits is found by trying it: render at a level, measure the width, and
  // step to a narrower level while the row is wider than the work area allows. Every step is a
  // layout effect, so it settles before the first paint. The widths measured stand for as long
  // as nothing that changes the row's content does (`fitKey`); the first level tried is then
  // the full one again, so a wider display gets its labels back.
  const available = widgetFitWidth(area);
  const wanted = chrome.expanded;
  const [fit, setFit] = useState<{ key: string; widths: readonly number[] }>({
    key: "",
    widths: [],
  });
  const fitKey = [
    available,
    chrome.intent,
    chrome.mode,
    wanted,
    chrome.modes.includes("window"),
    display !== undefined,
    t("widget.screenshot"),
  ].join("|");
  const widths = fit.key === fitKey ? fit.widths : NO_WIDTHS;
  const level = wanted ? fitLevel(available, widths) : COMPACT_LEVEL;
  useLayoutEffect(() => {
    const width = measureBox();
    if (!wanted || width === 0 || widths[level] === width) return;
    setFit((current) => {
      const known = current.key === fitKey ? [...current.widths] : [];
      known[level] = width;
      return { key: fitKey, widths: known };
    });
    // `box.width` is a dependency so a width the observer reports (a font loading, say) is
    // recorded too. The guard above makes the loop end: a level's width is stored once per value.
  }, [wanted, widths, level, fitKey, measureBox, box.width]);

  const placement = widgetPlacement(selection, area, box.height, box.width);
  // The edge the widget enters from: where it is docked once its height is known, kept for the
  // rest of this mount. A later move to the other edge (the box reaching the band) slides it
  // there without replaying the entrance. Set in the commit that measured it, so it is in the
  // DOM at the first paint.
  const [enterFrom, setEnterFrom] = useState<WidgetEdge | null>(null);
  useLayoutEffect(() => {
    if (box.measured) setEnterFrom((current) => current ?? placement.edge);
  }, [box.measured, placement.edge]);

  const look = widgetLook(level);
  const expanded = look.expanded;
  const recording = chrome.intent === "record";
  const counting = chrome.countdown !== null;
  const platform = chrome.platform;
  const frameMode = chrome.mode === "frame";
  const screenMode = chrome.mode === "screen";
  const windowOffered = chrome.modes.includes("window");
  const centre = selection
    ? { x: selection.x + selection.width / 2, y: selection.y + selection.height / 2 }
    : { x: area.x + area.width / 2, y: area.y + area.height / 2 };
  const toastInput = INPUTS.find((input) => input.key === chrome.toast?.input);
  const modeLabels: Record<CaptureMode, string> = {
    frame: t("modeFrame"),
    window: t("modeWindow"),
    screen: t("modeScreen"),
  };
  const countdownNote =
    chrome.countdownSeconds > 0
      ? t("widget.countdown", { seconds: chrome.countdownSeconds })
      : t("widget.noCountdown");
  // Dimmed and out of the tab order while the countdown runs; Cancel and the confirm button stay.
  const lock = counting || undefined;

  return (
    <>
      {counting && (
        <div
          className={styles.disc}
          data-testid="countdown-disc"
          role="timer"
          aria-live="assertive"
          style={{ left: centre.x, top: centre.y }}
        >
          {chrome.countdown}
        </div>
      )}
      <div
        ref={root}
        role="toolbar"
        aria-label={t("widget.label")}
        {...uiArea("captureOverlay.captureWidget")}
        data-testid="capture-widget"
        data-edge={placement.edge}
        data-enter={enterFrom ?? undefined}
        data-expanded={wanted || undefined}
        data-fit={wanted ? level : undefined}
        data-intent={chrome.intent}
        data-counting={counting || undefined}
        className={styles.widget}
        style={{
          left: placement.left,
          top: placement.top,
        }}
        {...keepPointer}
        onPointerDown={(event) => {
          pointerFocus.current = true;
          keepPointer.onPointerDown(event);
        }}
        // Enter on a control focused through the keyboard (Tab) activates that control: Cancel
        // cancels, a toggle toggles. The overlay's window-level Enter would start a capture or a
        // recording and preventDefault that activation, so it stops at this boundary. A control
        // focused by a mouse click keeps focus in Chromium, and there Enter is still the
        // overlay's primary key, so it passes. `:focus-visible` tells the two apart, and the
        // pointer flag covers an engine that reports it once any key is pressed; Tab clears it.
        // Focus leaving the widget also ends the pointer's claim: the Tab that brings it back
        // fires outside this root, so onKeyDown never sees it. A move between controls inside
        // the widget keeps the flag.
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            pointerFocus.current = false;
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Tab") pointerFocus.current = false;
          if (event.key !== "Enter" || pointerFocus.current) return;
          if (event.target instanceof Element && event.target.matches(":focus-visible")) {
            event.stopPropagation();
          }
        }}
      >
        {toastInput && chrome.toast && !counting && (
          <div
            key={chrome.toast.id}
            role="status"
            data-testid="input-toast"
            className={styles.toast}
            data-edge={placement.edge}
          >
            ✓{" "}
            {t(chrome.toast.on ? "widget.toastOn" : "widget.toastOff", {
              input: t(toastInput.label),
            })}{" "}
            <kbd className={styles.kbd}>{toastInput.hint}</kbd>
          </div>
        )}

        <div className={styles.row}>
          <div
            className={styles.segments}
            role="group"
            aria-label={t("overlay.intent")}
            inert={lock}
          >
            <button
              type="button"
              className={styles.segment}
              aria-pressed={!recording}
              aria-label={t("widget.screenshot")}
              title={t("widget.screenshot")}
              onClick={() => chrome.onIntent?.("capture")}
            >
              <Camera size={15} aria-hidden />
              {expanded && t("widget.screenshot")}
              <Kbd>P</Kbd>
            </button>
            <button
              type="button"
              className={styles.segment}
              aria-pressed={recording}
              aria-label={t("widget.recording")}
              title={t("widget.recording")}
              onClick={() => chrome.onIntent?.("record")}
            >
              <Video size={15} aria-hidden />
              {expanded && t("widget.recording")}
              <Kbd>V</Kbd>
            </button>
          </div>
          <span className={styles.divider} aria-hidden inert={lock} />
          <div
            className={styles.segments}
            role="group"
            aria-label={t("overlay.modes")}
            inert={lock}
          >
            {chrome.modes.map((mode, index) => {
              const Icon = MODE_ICON[mode];
              return (
                <button
                  key={mode}
                  type="button"
                  className={styles.segment}
                  aria-pressed={mode === chrome.mode}
                  aria-label={t("overlay.modeKey", { mode: modeLabels[mode], key: index + 1 })}
                  title={modeLabels[mode]}
                  onClick={() => chrome.onMode(mode)}
                >
                  <Icon size={15} aria-hidden />
                  {expanded && modeLabels[mode]}
                  <Kbd>{index + 1}</Kbd>
                </button>
              );
            })}
            {expanded && look.windowSoon && !windowOffered && (
              <button
                type="button"
                className={styles.segment}
                disabled
                data-testid="window-soon"
                aria-label={`${modeLabels.window} · ${t("widget.soon")}`}
              >
                <AppWindow size={15} aria-hidden />
                {modeLabels.window}
                <span className={styles.soon}>{t("widget.soon")}</span>
              </button>
            )}
          </div>

          {frameMode && onRatio && (
            <RatioMenu ratio={ratio} onRatio={onRatio} edge={placement.edge} locked={counting} />
          )}
          {screenMode && display && (
            <span
              className={styles.display}
              data-testid="display-chip"
              title={`${display.name} · ${display.resolution} · ${display.kind}`}
              inert={lock}
            >
              <Monitor size={15} aria-hidden />
              {display.name}
              <span className={styles.displaySize}>{display.resolution}</span>
              {look.readout && expanded && (
                <span className={styles.displaySize}>{display.kind}</span>
              )}
            </span>
          )}
          {expanded && look.readout && (
            <span className={styles.readout} data-testid="size-readout" inert={lock}>
              {size.width} × {size.height}
              <span className={styles.unit}> px</span>
            </span>
          )}

          <span className={styles.divider} aria-hidden inert={lock} />

          {recording ? (
            <>
              {INPUTS.map(({ key, icon, label, short, hint, state }) => {
                const toggles = chrome.toggles;
                const on = toggles?.[state] ?? false;
                const blocked = state === "camera" && Boolean(toggles?.cameraBlocked);
                const cannotToggle = blocked && !on;
                const Icon = blocked ? Lock : icon;
                const name = blocked ? tCamera("blockedTile") : t(label);
                const shownName = look.shortNames && short && !blocked ? t(short) : name;
                const picks: WidgetDevice[] | null =
                  state === "microphone"
                    ? (devices?.microphones ?? [])
                    : state === "camera"
                      ? (devices?.cameras ?? [])
                      : null;
                const selected = state === "microphone" ? devices?.microphoneId : devices?.cameraId;
                const select =
                  state === "microphone" ? devices?.selectMicrophone : devices?.selectCamera;
                return (
                  <InputCell
                    key={key}
                    state={state}
                    expanded={expanded}
                    on={on}
                    blocked={blocked}
                    halo={chrome.toast?.input === key ? chrome.toast.id : null}
                    edge={placement.edge}
                    icon={<Icon size={15} aria-hidden />}
                    name={name}
                    shownName={shownName}
                    showStateWord={look.stateWords}
                    hint={hint}
                    stateWord={
                      blocked ? tCamera("blocked") : on ? t("overlay.on") : t("overlay.off")
                    }
                    disabled={cannotToggle}
                    devices={picks}
                    selectedDevice={selected ?? null}
                    onSelectDevice={select}
                    onToggle={() => chrome.toggles?.toggle(key)}
                    locked={counting}
                  />
                );
              })}
              <button
                type="button"
                className={styles.more}
                inert={lock}
                aria-label={t("widget.moreSettings")}
                title={t("widget.moreSettings")}
                onClick={chrome.onMoreSettings}
              >
                <SlidersHorizontal size={15} aria-hidden />
                {expanded &&
                  t(look.shortNames ? "widget.shortMoreSettings" : "widget.moreSettings")}
              </button>
            </>
          ) : (
            <button
              type="button"
              className={styles.copy}
              inert={lock}
              aria-label={t("widget.copyToClipboard")}
              title={t("widget.copyToClipboard")}
              onClick={() => onAction("copy")}
            >
              <Copy size={15} aria-hidden />
              {expanded && t(look.shortNames ? "widget.shortCopy" : "widget.copyToClipboard")}
              <Kbd>{copyKeyLabel(platform)}</Kbd>
            </button>
          )}

          <button
            type="button"
            className={styles.cancel}
            data-keep
            aria-label={t("overlay.cancel")}
            onClick={chrome.onCancel}
            title={t("overlay.cancelTitle")}
          >
            {expanded ? t("overlay.cancel") : <X size={15} aria-hidden />}
            <Kbd>Esc</Kbd>
          </button>
          {recording ? (
            <button
              type="button"
              className={styles.confirm}
              data-keep
              data-testid="start-recording"
              data-counting={counting || undefined}
              disabled={!canRecord || counting}
              aria-label={t("widget.record")}
              // Compact drops the sub line, so the countdown length rides on the tooltip.
              title={counting ? undefined : countdownNote}
              onClick={() => onAction("record")}
            >
              {counting ? (
                <span className={styles.confirmMain}>
                  {t("widget.startingIn", { seconds: chrome.countdown ?? 0 })}
                </span>
              ) : (
                <>
                  <span className={styles.confirmMain}>
                    <span className={styles.dot} aria-hidden />
                    {t("widget.record")}
                    <Kbd>↵</Kbd>
                  </span>
                  {expanded && <span className={styles.confirmSub}>{countdownNote}</span>}
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              className={styles.confirm}
              data-keep
              aria-label={t("overlay.capture")}
              onClick={() => onAction("capture")}
            >
              <span className={styles.confirmMain}>
                <Camera size={16} aria-hidden />
                {t("overlay.capture")}
                <Kbd>↵</Kbd>
              </span>
            </button>
          )}

          <button
            type="button"
            className={styles.expandToggle}
            data-testid="widget-expand"
            inert={lock}
            aria-expanded={expanded}
            aria-label={expanded ? t("widget.collapse") : t("widget.expand")}
            title={expanded ? t("widget.collapse") : t("widget.expand")}
            onClick={chrome.onToggleExpanded}
          >
            <Kbd>{controlKeyLabel(platform)}</Kbd>
            {expanded ? (
              <ChevronsRightLeft size={13} aria-hidden />
            ) : (
              <ChevronsLeftRight size={13} aria-hidden />
            )}
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * The ratio menu of the contextual slot in Frame: one chip with the current ratio that opens
 * Free, 16:9, 9:16 and 1:1. Choosing one is what the old chips did, and locks the frame box.
 */
function RatioMenu({
  ratio,
  onRatio,
  edge,
  locked,
}: {
  ratio: RecordingRatio;
  onRatio(ratio: RecordingRatio): void;
  edge: WidgetEdge;
  locked: boolean;
}): React.JSX.Element {
  const t = useTranslations("screenshots");
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement | null>(null);
  useDismissOnOutsidePress(wrapper, open, () => setOpen(false));
  const nameOf = (value: RecordingRatio): string =>
    value === "free" ? t("overlay.ratioFree") : value;
  return (
    <div ref={wrapper} className={styles.slot} inert={locked || undefined}>
      <button
        type="button"
        className={styles.chip}
        data-testid="ratio-menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("widget.ratioMenu", { ratio: nameOf(ratio) })}
        onClick={() => setOpen((current) => !current)}
      >
        {nameOf(ratio)}
        <ChevronDown size={13} aria-hidden />
      </button>
      {open && (
        <ul
          role="menu"
          className={`${styles.menu} ${styles.menuNarrow}`}
          data-edge={edge}
          aria-label={t("overlay.ratios")}
          // Enter on a menu item picks the ratio; it must not also reach the overlay's
          // window-level Enter, which starts the capture.
          onKeyDown={(event) => {
            if (event.key === "Enter") event.stopPropagation();
          }}
        >
          {RECORDING_RATIOS.map((value) => (
            <li key={value} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={value === ratio}
                className={styles.menuItem}
                onClick={() => {
                  onRatio(value);
                  setOpen(false);
                }}
              >
                {nameOf(value)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One input of the recording toolbar. Compact: an icon chip that toggles, with its key badge,
 * and a small chevron for the device menu (microphone and camera). Expanded: its name (with a
 * device chevron for the microphone and the camera), an On/Off word, a switch and its key. The
 * toggle's `aria-pressed` carries the state; the halo shows for `TOAST_MS` after a key toggle.
 */
function InputCell({
  state,
  expanded,
  on,
  blocked,
  halo,
  edge,
  icon,
  name,
  shownName,
  showStateWord,
  hint,
  stateWord,
  disabled,
  devices,
  selectedDevice,
  onSelectDevice,
  onToggle,
  locked,
}: {
  state: "microphone" | "systemAudio" | "camera";
  expanded: boolean;
  on: boolean;
  blocked: boolean;
  halo: number | null;
  edge: WidgetEdge;
  icon: React.ReactNode;
  /** The accessible name, always the full one. */
  name: string;
  /** What the expanded row prints: `name`, or its short form when the row is tight. */
  shownName: string;
  /** The On / Off word beside the switch; dropped when the row is tight. */
  showStateWord: boolean;
  hint: string;
  stateWord: string;
  disabled: boolean;
  devices: WidgetDevice[] | null;
  selectedDevice: string | null;
  onSelectDevice?(id: string): void;
  onToggle(): void;
  /** While the countdown runs the cell is neither clickable nor focusable. */
  locked: boolean;
}): React.JSX.Element {
  const t = useTranslations("screenshots");
  const [open, setOpen] = useState(false);
  const cell = useRef<HTMLDivElement | null>(null);
  const [lit, setLit] = useState(false);
  useEffect(() => {
    // Another input's toggle ends this one's halo at once: its timer is cancelled below.
    setLit(halo !== null);
    if (halo === null) return;
    const timer = setTimeout(() => setLit(false), TOAST_MS);
    return () => clearTimeout(timer);
  }, [halo]);
  useDismissOnOutsidePress(cell, open, () => setOpen(false));
  const chooseDevice = (
    <button
      type="button"
      className={expanded ? styles.inputName : styles.inputChevron}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={t("widget.chooseDevice", { input: name })}
      onClick={() => setOpen((current) => !current)}
    >
      {expanded && icon}
      {expanded && shownName}
      <ChevronDown size={13} aria-hidden />
    </button>
  );
  return (
    <div
      ref={cell}
      className={styles.input}
      inert={locked || undefined}
      data-compact={!expanded || undefined}
      data-on={on}
      data-halo={lit || undefined}
      data-blocked={blocked || undefined}
      data-testid={`input-${state}`}
    >
      {expanded &&
        (devices ? (
          chooseDevice
        ) : (
          <span className={styles.inputName}>
            {icon}
            {shownName}
          </span>
        ))}
      <button
        type="button"
        className={styles.inputToggle}
        aria-pressed={on}
        aria-label={name}
        title={expanded ? undefined : name}
        aria-disabled={disabled || undefined}
        onClick={disabled ? undefined : onToggle}
      >
        {expanded ? (
          <>
            {showStateWord && <span className={styles.stateWord}>{stateWord}</span>}
            <span className={styles.switch} aria-hidden />
          </>
        ) : (
          icon
        )}
        <Kbd>{hint}</Kbd>
      </button>
      {!expanded && devices && chooseDevice}
      {open && devices && (
        <ul
          role="menu"
          className={styles.menu}
          data-edge={edge}
          aria-label={name}
          // Enter on a menu item picks the device; it must not also reach the overlay's
          // window-level Enter, which starts the recording.
          onKeyDown={(event) => {
            if (event.key === "Enter") event.stopPropagation();
          }}
        >
          {devices.length === 0 && <li className={styles.menuEmpty}>{t("widget.noDevices")}</li>}
          {devices.map((device) => (
            <li key={device.id} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={device.id === selectedDevice}
                className={styles.menuItem}
                onClick={() => {
                  onSelectDevice?.(device.id);
                  setOpen(false);
                }}
              >
                {device.label || t("widget.unnamedDevice")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
