import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AppWindow,
  Camera,
  ChevronDown,
  Copy,
  Frame,
  Lock,
  Mic,
  Monitor,
  Video,
  Volume2,
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
import { copyKeyLabel, recordKeyLabel, type InputToggleKey } from "./overlay-keys";
import type { WidgetDevice, WidgetDevices } from "./use-widget-devices";
import { widgetPlacement } from "./widget-placement";
import styles from "./capture-widget.module.css";
import { uiArea } from "@renderer/lib/ui-area";

/** How long a key toggle's toast and its halo stay (the issue's 1.5 s). */
export const TOAST_MS = 1500;
/** The widget's height before it has been measured (three rows and their padding). */
const FIRST_HEIGHT_DIP = 190;

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
    hint: "M",
    state: "microphone",
  },
  {
    key: "isSystemAudioEnabled",
    icon: Volume2,
    label: "overlay.toggleSystemAudio",
    hint: "A",
    state: "systemAudio",
  },
  {
    key: "isCameraEnabled",
    icon: Camera,
    label: "overlay.toggleCamera",
    hint: "W",
    state: "camera",
  },
] as const satisfies readonly {
  key: InputToggleKey;
  icon: LucideIcon;
  label: string;
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

interface CaptureWidgetProps {
  chrome: OverlayChrome;
  /** The box the widget must not cover when it can help it; `null` is the whole display (Screen). */
  selection: CaptureRect | null;
  /** The work area in window coordinates. */
  area: CaptureRect;
  ratio: RecordingRatio;
  /** Absent when the mode has no box to lock to (Screen, Window): the chips read disabled. */
  onRatio?(ratio: RecordingRatio): void;
  /** What is captured, in device pixels, for the read-only readout. */
  size: { width: number; height: number };
  /** False for a box under the recording minimum: it can be shot, never recorded. */
  canRecord: boolean;
  /** The widget's own actions; keys reach the same handlers through the mode's key listener. */
  onAction(action: CaptureAction): void;
  devices?: WidgetDevices;
}

/**
 * The one capture toolbar (ADR 0056), docked to the bottom of the work area, or to its top
 * when the selection reaches the bottom band. Row 1: capture as, area, ratio and the size
 * readout. Row 2: what the intent needs (inputs and Record, or Copy and Capture). Row 3: key
 * hints, and a link to the Record settings. During the countdown it dims, except Cancel and
 * the confirm button, and a number disc counts down on the selection.
 */
export function CaptureWidget({
  chrome,
  selection,
  area,
  ratio,
  onRatio,
  size,
  canRecord,
  onAction,
  devices,
}: CaptureWidgetProps): React.JSX.Element {
  const t = useTranslations("screenshots");
  const tCamera = useTranslations("cameraSettings");
  const root = useRef<HTMLDivElement | null>(null);
  // True from a mouse press on the widget until the next Tab: focus then came from the pointer.
  const pointerFocus = useRef(false);
  const [height, setHeight] = useState(FIRST_HEIGHT_DIP);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = (): void => {
      const next = Math.ceil(element.getBoundingClientRect().height);
      if (next > 0) setHeight((current) => (current === next ? current : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const placement = widgetPlacement(selection, area, height);
  const recording = chrome.intent === "record";
  const counting = chrome.countdown !== null;
  const platform = chrome.platform;
  const frameMode = chrome.mode === "frame";
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
        data-intent={chrome.intent}
        data-counting={counting || undefined}
        className={styles.widget}
        style={{ left: placement.left, top: placement.top, width: placement.width }}
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
          <div className={styles.group} inert={counting || undefined}>
            <span className={styles.label}>{t("widget.captureAs")}</span>
            <div className={styles.segments} role="group" aria-label={t("overlay.intent")}>
              <button
                type="button"
                className={styles.segment}
                aria-pressed={!recording}
                onClick={() => chrome.onIntent?.("capture")}
              >
                <Camera size={15} aria-hidden />
                {t("widget.screenshot")}
                <Kbd>P</Kbd>
              </button>
              <button
                type="button"
                className={styles.segment}
                aria-pressed={recording}
                onClick={() => chrome.onIntent?.("record")}
              >
                <Video size={15} aria-hidden />
                {t("widget.recording")}
                <Kbd>V</Kbd>
              </button>
            </div>
          </div>
          <div className={styles.group} inert={counting || undefined}>
            <span className={styles.label}>{t("widget.area")}</span>
            <div className={styles.segments} role="group" aria-label={t("overlay.modes")}>
              {chrome.modes.map((mode, index) => {
                const Icon = MODE_ICON[mode];
                return (
                  <button
                    key={mode}
                    type="button"
                    className={styles.segment}
                    aria-pressed={mode === chrome.mode}
                    aria-label={t("overlay.modeKey", { mode: modeLabels[mode], key: index + 1 })}
                    onClick={() => chrome.onMode(mode)}
                  >
                    <Icon size={15} aria-hidden />
                    {modeLabels[mode]}
                    <Kbd>{index + 1}</Kbd>
                  </button>
                );
              })}
              {!windowOffered && (
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
          </div>
          <div className={styles.group} inert={counting || undefined}>
            <span className={styles.label}>{t("widget.ratio")}</span>
            <div
              className={styles.segments}
              role="group"
              aria-label={t("overlay.ratios")}
              data-testid="ratio-chips"
            >
              {RECORDING_RATIOS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={styles.chip}
                  aria-pressed={frameMode && value === ratio}
                  disabled={!onRatio}
                  onClick={() => onRatio?.(value)}
                >
                  {value === "free" ? t("overlay.ratioFree") : value}
                </button>
              ))}
              <span className={styles.readout} data-testid="size-readout">
                {size.width} × {size.height}
                <span className={styles.unit}> px</span>
              </span>
            </div>
          </div>
        </div>

        {recording ? (
          <div className={styles.row}>
            {INPUTS.map(({ key, icon, label, hint, state }) => {
              const toggles = chrome.toggles;
              const on = toggles?.[state] ?? false;
              const blocked = state === "camera" && Boolean(toggles?.cameraBlocked);
              const cannotToggle = blocked && !on;
              const Icon = blocked ? Lock : icon;
              const name = blocked ? tCamera("blockedTile") : t(label);
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
                  on={on}
                  blocked={blocked}
                  halo={chrome.toast?.input === key ? chrome.toast.id : null}
                  edge={placement.edge}
                  icon={<Icon size={15} aria-hidden />}
                  name={name}
                  hint={hint}
                  stateWord={blocked ? tCamera("blocked") : on ? t("overlay.on") : t("overlay.off")}
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
              className={styles.cancel}
              data-keep
              onClick={chrome.onCancel}
              title={t("overlay.cancelTitle")}
            >
              {t("overlay.cancel")}
              <Kbd>Esc</Kbd>
            </button>
            <button
              type="button"
              className={styles.confirm}
              data-keep
              data-testid="start-recording"
              data-counting={counting || undefined}
              disabled={!canRecord || counting}
              aria-label={t("widget.record")}
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
                  <span className={styles.confirmSub}>
                    {chrome.countdownSeconds > 0
                      ? t("widget.countdown", { seconds: chrome.countdownSeconds })
                      : t("widget.noCountdown")}
                  </span>
                </>
              )}
            </button>
          </div>
        ) : (
          <div className={styles.row}>
            <button type="button" className={styles.copy} onClick={() => onAction("copy")}>
              <Copy size={15} aria-hidden />
              {t("widget.copyToClipboard")}
              <Kbd>{copyKeyLabel(platform)}</Kbd>
            </button>
            <button
              type="button"
              className={styles.cancel}
              data-keep
              onClick={chrome.onCancel}
              title={t("overlay.cancelTitle")}
            >
              {t("overlay.cancel")}
              <Kbd>Esc</Kbd>
            </button>
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
          </div>
        )}

        <div className={styles.hints} data-testid="widget-hints" inert={counting || undefined}>
          {frameMode && (
            <span className={styles.hintGroup}>
              <span className={styles.label}>{t("widget.hintBox")}</span>
              {t("widget.hintBoxText")}
            </span>
          )}
          <span className={styles.hintGroup}>
            <span className={styles.label}>{t("widget.hintSwitch")}</span>
            {chrome.modes.map((mode, index) => (
              <Kbd key={mode}>{index + 1}</Kbd>
            ))}
            {t("widget.hintArea")}
            <Kbd>P</Kbd>
            <Kbd>V</Kbd>
            {t("widget.hintIntent")}
          </span>
          <span className={styles.hintGroup}>
            <span className={styles.label}>{t("widget.hintGo")}</span>
            <Kbd>↵</Kbd>
            {t("widget.hintStart")}
            <Kbd>Esc</Kbd>
            {t("widget.hintCancel")}
            {recording && (
              <>
                <Kbd>{recordKeyLabel(platform)}</Kbd>
                {t("widget.hintRecord")}
              </>
            )}
          </span>
          {recording && (
            <button type="button" className={styles.more} onClick={chrome.onMoreSettings}>
              {t("widget.moreSettings")}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * One input of the recording row: its name (with a device chevron for the microphone and the
 * camera), an On/Off word, a switch and its key. The toggle's `aria-pressed` carries the state;
 * the halo shows for `TOAST_MS` after a key toggle.
 */
function InputCell({
  state,
  on,
  blocked,
  halo,
  edge,
  icon,
  name,
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
  on: boolean;
  blocked: boolean;
  halo: number | null;
  edge: "bottom" | "top";
  icon: React.ReactNode;
  name: string;
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
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent): void => {
      if (!cell.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [open]);
  return (
    <div
      ref={cell}
      className={styles.input}
      inert={locked || undefined}
      data-on={on}
      data-halo={lit || undefined}
      data-blocked={blocked || undefined}
      data-testid={`input-${state}`}
    >
      {devices ? (
        <button
          type="button"
          className={styles.inputName}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t("widget.chooseDevice", { input: name })}
          onClick={() => setOpen((current) => !current)}
        >
          {icon}
          {name}
          <ChevronDown size={13} aria-hidden />
        </button>
      ) : (
        <span className={styles.inputName}>
          {icon}
          {name}
        </span>
      )}
      <button
        type="button"
        className={styles.inputToggle}
        aria-pressed={on}
        aria-label={name}
        aria-disabled={disabled || undefined}
        onClick={disabled ? undefined : onToggle}
      >
        <span className={styles.stateWord}>{stateWord}</span>
        <span className={styles.switch} aria-hidden />
        <Kbd>{hint}</Kbd>
      </button>
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
