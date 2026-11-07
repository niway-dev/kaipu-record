import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUpRight,
  Check,
  Download,
  Droplet,
  EyeOff,
  ImagePlus,
  Mouse,
  MousePointer2,
  Redo2,
  Square,
  RectangleHorizontal,
  Type,
  Undo2,
  Volume2,
  VolumeOff,
  VolumeX,
  ZoomIn,
} from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import {
  type EditorTool,
  isPrivacyTool,
  type PrivacyTool,
  type VideoTool,
} from "../annotations/video-tools";
import { formatAccelerator } from "@renderer/features/shortcuts/keyboard-accelerator";
import { isWindowsHost } from "@renderer/features/shortcuts/host-platform";
import styles from "./editor-toolbar.module.css";
import { uiArea } from "@renderer/lib/ui-area";

/** Accepted image types for the "Add image" tool — matches SlideAssetStore's decode path. */
const SLIDE_IMAGE_TYPES = "image/png,image/jpeg,image/webp";

type ToolLabelKey = "toolSelect" | "toolBox" | "toolArrow" | "toolText";

/** Blur uses the screenshot editor's Droplet on purpose (UI spec § 3.1: same icon, same behavior). */
const PRIVACY_META: Record<
  PrivacyTool,
  { labelKey: "toolBlur" | "toolCover"; Icon: typeof Square }
> = {
  blur: { labelKey: "toolBlur", Icon: Droplet },
  cover: { labelKey: "toolCover", Icon: RectangleHorizontal },
};

const TOOL_META: Record<VideoTool, { labelKey: ToolLabelKey; Icon: typeof Square }> = {
  select: { labelKey: "toolSelect", Icon: MousePointer2 },
  box: { labelKey: "toolBox", Icon: Square },
  arrow: { labelKey: "toolArrow", Icon: ArrowUpRight },
  text: { labelKey: "toolText", Icon: Type },
};

/**
 * One-letter shortcuts (plans/video-editor-v2/08 § PR 10 polish). Plain keyboard
 * symbols, not prose — same treatment as the done-step's literal "⌘⇧P" — so they are
 * not i18n keys; every button's `title` appends "(<key>)" to its translated label.
 * The page's key handler (toolForShortcut) binds the same letters to the same tools,
 * straight to the variant, whatever the group's button currently shows.
 */
const TOOL_SHORTCUT: Record<EditorTool, string> = {
  select: "V",
  box: "R",
  arrow: "A",
  text: "T",
  blur: "B",
  cover: "C",
};
const ZOOM_SHORTCUT = "Z";
/** The split shortcut; the transport bar prints it on the split button. */
export const SPLIT_SHORTCUT = "S";

/**
 * The drawing modes that share one rail button (Kaipu Black, NIW2-619). The button
 * shows its group's current variant; the flyout lists all of them.
 */
export const TOOL_GROUPS = {
  annotate: ["box", "arrow", "text"],
  privacy: ["blur", "cover"],
} as const satisfies Record<string, readonly EditorTool[]>;
export type ToolGroup = keyof typeof TOOL_GROUPS;

function variantsOf(group: ToolGroup): readonly EditorTool[] {
  return TOOL_GROUPS[group];
}

/**
 * The opening rule. A click on a group's button whose tool is NOT active arms the
 * variant it shows (`remembered`: the last one used, or the first) — one click, no
 * flyout. A click on the group that IS active opens the flyout with every variant.
 * The corner mark is only a glyph that says "has variants"; it is not a hit target.
 * Audio has no armed variant (both are actions), so its button always opens the flyout.
 * Any group's flyout also opens on press-and-hold or right-click (HOLD_OPEN_MS).
 * Pure and exported so the policy is testable on its own.
 */
export function groupClickAction(
  group: ToolGroup,
  current: EditorTool,
  remembered: EditorTool,
): { kind: "arm"; tool: EditorTool } | { kind: "open" } {
  return variantsOf(group).includes(current) ? { kind: "open" } : { kind: "arm", tool: remembered };
}

/** Press-and-hold on a group's button opens its flyout after this long (Photoshop's
 *  "click and hold"). Shorter than a deliberate press, longer than any click. */
export const HOLD_OPEN_MS = 300;

/**
 * The next variant of the group `tool` belongs to, wrapping — Shift+<shortcut> on the
 * keyboard. Null for a tool outside every group (Select). Pure and exported so the
 * page's key handler and the tests share it.
 */
export function nextToolInGroup(tool: EditorTool): EditorTool | null {
  for (const variants of Object.values(TOOL_GROUPS) as (readonly EditorTool[])[]) {
    const at = variants.indexOf(tool);
    if (at >= 0) return variants[(at + 1) % variants.length] ?? null;
  }
  return null;
}

/** One row of a flyout. */
interface FlyoutItem {
  key: string;
  label: string;
  Icon: typeof Square;
  /** Plain keyboard symbol printed at the row's end, when the action has one. */
  shortcut?: string;
  /** The tool in use, or the toggle that is on: accent colour and a check. */
  current: boolean;
  /** `menuitemradio` for an exclusive tool, `menuitemcheckbox` for a toggle. */
  role: "menuitemradio" | "menuitemcheckbox" | "menuitem";
  onPick(): void;
}

/**
 * The small window listing all of a group's options, to the LEFT of the rail and
 * anchored to its button. Portalled to the body with fixed coordinates because the
 * rail clips its overflow. Opens with the current option focused; arrows move (and
 * wrap), Home/End jump, Enter picks, Escape or Tab closes, and a pointer-down anywhere
 * else closes. Closing returns focus to the button.
 */
function ToolFlyout({
  anchor,
  label,
  items,
  onClose,
}: {
  anchor: HTMLElement;
  label: string;
  items: readonly FlyoutItem[];
  onClose(): void;
}): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    const rect = anchor.getBoundingClientRect();
    const height = menuRef.current?.offsetHeight ?? 0;
    const width = menuRef.current?.offsetWidth ?? 0;
    // Left of the button, clamped so the whole window stays on screen on every side.
    const left = Math.max(8, Math.min(rect.left - 6 - width, window.innerWidth - width - 8));
    const top = Math.max(8, Math.min(rect.top, window.innerHeight - height - 8));
    setPos({ left, top });
  }, [anchor]);

  // Placed once, so any move of the page under it closes it instead of leaving it adrift.
  useEffect(() => {
    window.addEventListener("resize", onClose);
    document.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("resize", onClose);
      document.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  // Focus the current option once, on open.
  useEffect(() => {
    const rows = menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]');
    const at = Math.max(
      0,
      items.findIndex((item) => item.current),
    );
    rows?.[at]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      // The button's own click toggles; closing here too would reopen it.
      if (menuRef.current?.contains(target) || anchor.contains(target)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [anchor, onClose]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
    const at = rows.indexOf(document.activeElement as HTMLElement);
    // Every key the flyout handles stops here: the page's window handler would
    // otherwise also clear the selection on Escape, toggle playback on Space and arm a
    // tool on a shortcut letter. Letters are swallowed, not mapped to a pick.
    const handled = (): void => {
      event.preventDefault();
      event.stopPropagation();
    };
    const move = (to: number): void => {
      handled();
      rows[(to + rows.length) % rows.length]?.focus();
    };
    if (event.key === "Escape") {
      handled();
      onClose();
      anchor.focus();
    } else if (event.key === "Tab") {
      // Close and let focus move on naturally: no preventDefault, no refocus.
      event.stopPropagation();
      onClose();
    } else if (event.key === "ArrowDown") move(at + 1);
    else if (event.key === "ArrowUp") move(at - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(rows.length - 1);
    else if (event.key === "Enter" || event.key === " ") {
      handled();
      rows[at]?.click();
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) handled();
  };

  return createPortal(
    <div
      {...uiArea("editorVideo.toolFlyout")}
      ref={menuRef}
      role="menu"
      aria-label={label}
      aria-orientation="vertical"
      className={styles.flyout}
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={onKeyDown}
    >
      {items.map(({ key, label: itemLabel, Icon, shortcut, current, role, onPick }) => (
        <button
          key={key}
          type="button"
          role={role}
          aria-checked={role === "menuitem" ? undefined : current}
          tabIndex={-1}
          className={`${styles.flyoutItem} ${current ? styles.flyoutCurrent : ""}`}
          onClick={() => {
            onPick();
            onClose();
            anchor.focus();
          }}
        >
          <Icon size={16} aria-hidden />
          <span className={styles.flyoutLabel}>{itemLabel}</span>
          {shortcut ? <kbd className={styles.flyoutKey}>{shortcut}</kbd> : null}
          <Check size={14} aria-hidden className={styles.flyoutCheck} data-shown={current} />
        </button>
      ))}
    </div>,
    document.body,
  );
}

/**
 * Undo/redo/delete as the host prints them: "⌘Z" / "⌘⇧Z" / "⌫" on macOS, and
 * "Ctrl+Z" / "Ctrl+Shift+Z" / "Del" on Windows. These match the page's key handler
 * (Cmd-or-Ctrl+Z, plus Shift for redo; Delete or Backspace), which binds no Ctrl+Y.
 */
export function editShortcuts(): { undo: string; redo: string; remove: string } {
  return {
    undo: formatAccelerator("CommandOrControl+Z"),
    redo: formatAccelerator("CommandOrControl+Shift+Z"),
    remove: isWindowsHost() ? "Del" : "⌫",
  };
}

export interface EditorToolbarProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
  /** Insert an image slide at the playhead's nearest item boundary. */
  onAddImage(file: File): void;
  /** Run the export pipeline. Disabled while exporting or when the timeline is empty. */
  onExport(): void;
  /** Status chips (the original-untouched pill, the autosave state), between the
   *  actions and Export. */
  children?: React.ReactNode;
  exportDisabled: boolean;
}

/**
 * The tools, as one 44 px column to the right of the preview (NIW2-611 put it there;
 * Kaipu Black, NIW2-619, folds it into five tools):
 *
 * Select · Annotate (box, arrow, text) · Zoom · Privacy (blur, cover) · Audio (mute a
 * section, mute everything)
 *
 * A group's button shows its current variant's icon and a corner mark that it has
 * more. The webcam and cursor buttons follow, below a rule, only for a recording that
 * has a webcam or a redrawable cursor.
 */
export interface EditorToolRailProps {
  /** Silence a stretch of audio at the playhead. */
  onAddMute(): void;
  /** Silence the whole recording; the export then drops the audio track. */
  onToggleMuteAll(): void;
  audioMuted: boolean;
  /** Current tool (annotation or privacy). */
  tool: EditorTool;
  onToolChange(tool: EditorTool): void;
  /** Add a zoom at the playhead, or select the one already there (video-editor v2). */
  onAddZoom(): void;
  /** Blur/Cover need footage: disabled while the playhead is on a slide. */
  privacyDisabled: boolean;
  /** "Hide webcam here" (ADR 0038). Absent for a recording without a webcam: no button. */
  onHideWebcam?(): void;
  /** Open the recorded cursor's settings. Absent when the recording cannot redraw its
   *  cursor (it is baked into the video): no button. */
  onOpenCursor?(): void;
  /** The cursor's settings are open; the Select tool then shows as not active. */
  cursorSelected?: boolean;
}

const GROUP_LABEL: Record<ToolGroup, "toolAnnotate" | "toolPrivacy"> = {
  annotate: "toolAnnotate",
  privacy: "toolPrivacy",
};

function toolLabelKey(tool: EditorTool): ToolLabelKey | "toolBlur" | "toolCover" {
  return isPrivacyTool(tool) ? PRIVACY_META[tool].labelKey : TOOL_META[tool].labelKey;
}

function toolIcon(tool: EditorTool): typeof Square {
  return isPrivacyTool(tool) ? PRIVACY_META[tool].Icon : TOOL_META[tool].Icon;
}

export function EditorToolRail({
  tool,
  onToolChange,
  onAddZoom,
  privacyDisabled,
  onAddMute,
  onToggleMuteAll,
  audioMuted,
  onHideWebcam,
  onOpenCursor,
  cursorSelected = false,
}: EditorToolRailProps): React.JSX.Element {
  const t = useTranslations("videoEditor");
  // The variant each group shows while another tool is active: the last one used.
  // Updated during render (React's "store information from previous renders"), so a
  // tool armed from the keyboard shows on its group's button on the same paint.
  const [remembered, setRemembered] = useState<Record<ToolGroup, EditorTool>>({
    annotate: "box",
    privacy: "blur",
  });
  for (const group of Object.keys(TOOL_GROUPS) as ToolGroup[]) {
    if (variantsOf(group).includes(tool) && remembered[group] !== tool) {
      setRemembered({ ...remembered, [group]: tool });
    }
  }
  // The group whose flyout is open; its button is the anchor.
  const [open, setOpen] = useState<ToolGroup | "audio" | null>(null);
  const buttons = useRef<Partial<Record<ToolGroup | "audio", HTMLButtonElement | null>>>({});
  const closeFlyout = useCallback(() => setOpen(null), []);
  // Press-and-hold: the timer that opens a flyout, and whether it already did, so the
  // click the release then fires is swallowed instead of arming a tool or toggling shut.
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const clearHold = useCallback(() => {
    if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  }, []);
  // A gesture that ends without a click (pointer cancelled, or left the button) must
  // not leave the suppression armed for whatever activates the button next.
  const abandonHold = useCallback(() => {
    clearHold();
    held.current = false;
  }, [clearHold]);
  useEffect(() => clearHold, [clearHold]);
  /** Pointer handlers shared by every button that owns a flyout. */
  const flyoutTriggers = (key: ToolGroup | "audio", disabled = false) => ({
    onPointerDown: (event: React.PointerEvent): void => {
      held.current = false;
      clearHold();
      // Touch has no hover, so a still finger is a press, not a hold; it keeps tap and
      // long-press to the platform. A trackpad reports as a mouse.
      if (disabled || event.button !== 0) return;
      if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
      holdTimer.current = setTimeout(() => {
        holdTimer.current = null;
        held.current = true;
        setOpen(key);
      }, HOLD_OPEN_MS);
    },
    onPointerUp: clearHold,
    onPointerLeave: abandonHold,
    onPointerCancel: abandonHold,
    // Enter and Space send no pointerdown: a keyboard activation is never the tail of a hold.
    onKeyDown: abandonHold,
    onContextMenu: (event: React.MouseEvent): void => {
      event.preventDefault();
      clearHold();
      if (!disabled) setOpen(key);
    },
  });
  /** True when this click is the tail of a hold that already opened the flyout. */
  const swallowHeldClick = (): boolean => {
    if (!held.current) return false;
    held.current = false;
    return true;
  };
  // A flyout cannot hang from a disabled button (Privacy over a slide).
  useEffect(() => {
    if (open === "privacy" && privacyDisabled) setOpen(null);
  }, [open, privacyDisabled]);

  const flyoutFor = (group: ToolGroup | "audio"): React.JSX.Element | null => {
    const anchor = buttons.current[group];
    if (open !== group || !anchor) return null;
    if (group === "audio") {
      return (
        <ToolFlyout
          anchor={anchor}
          label={t("toolAudio")}
          onClose={closeFlyout}
          items={[
            {
              key: "muteSection",
              label: t("toolMute"),
              Icon: VolumeX,
              current: false,
              role: "menuitem",
              onPick: onAddMute,
            },
            {
              key: "muteAll",
              label: audioMuted ? t("toolUnmuteAll") : t("toolMuteAll"),
              Icon: audioMuted ? VolumeOff : Volume2,
              current: audioMuted,
              role: "menuitemcheckbox",
              onPick: onToggleMuteAll,
            },
          ]}
        />
      );
    }
    return (
      <ToolFlyout
        anchor={anchor}
        label={t(GROUP_LABEL[group])}
        onClose={closeFlyout}
        items={variantsOf(group).map((variant) => ({
          key: variant,
          label: t(toolLabelKey(variant)),
          Icon: toolIcon(variant),
          shortcut: TOOL_SHORTCUT[variant],
          current: variant === tool,
          role: "menuitemradio" as const,
          onPick: () => onToolChange(variant),
        }))}
      />
    );
  };

  const groupButton = (group: ToolGroup, disabled = false): React.JSX.Element => {
    const active = variantsOf(group).includes(tool);
    const shown = active ? tool : remembered[group];
    const Icon = toolIcon(shown);
    const label = t(toolLabelKey(shown));
    return (
      <>
        <button
          type="button"
          ref={(el) => {
            buttons.current[group] = el;
          }}
          data-tool-group={group}
          data-variants={variantsOf(group).length}
          title={`${label} (${TOOL_SHORTCUT[shown]}) · ${t("toolMoreOptions")}`}
          aria-label={label}
          aria-pressed={active}
          aria-haspopup="menu"
          aria-expanded={open === group}
          disabled={disabled}
          className={`${styles.tool} ${active ? styles.toolActive : ""}`}
          {...flyoutTriggers(group, disabled)}
          onClick={() => {
            if (swallowHeldClick()) return;
            const action = groupClickAction(group, tool, remembered[group]);
            if (action.kind === "arm") {
              setOpen(null);
              onToolChange(action.tool);
            } else setOpen(open === group ? null : group);
          }}
        >
          <Icon size={19} />
        </button>
        {flyoutFor(group)}
      </>
    );
  };

  return (
    <div
      {...uiArea("editorVideo.toolRail")}
      className={styles.rail}
      role="toolbar"
      aria-orientation="vertical"
    >
      <button
        type="button"
        data-tool-group="select"
        title={`${t("toolSelect")} (${TOOL_SHORTCUT.select})`}
        aria-label={t("toolSelect")}
        className={`${styles.tool} ${tool === "select" && !cursorSelected ? styles.toolActive : ""}`}
        onClick={() => onToolChange("select")}
      >
        <MousePointer2 size={19} />
      </button>
      {groupButton("annotate")}
      {/* Zoom is an ACTION, not a drawing mode: it adds a zoom at the playhead (or
          selects the one there) and the camera box on the preview re-aims it. */}
      <button
        type="button"
        data-tool-group="zoom"
        title={`${t("hintZoom")} (${ZOOM_SHORTCUT})`}
        aria-label={t("toolZoom")}
        className={styles.tool}
        onClick={onAddZoom}
      >
        <ZoomIn size={19} />
      </button>
      {groupButton("privacy", privacyDisabled)}
      {/* Both Audio variants are actions, so there is no armed variant to re-click:
          the button always opens the flyout, and it reads pressed while muted. */}
      <button
        type="button"
        ref={(el) => {
          buttons.current.audio = el;
        }}
        data-tool-group="audio"
        data-variants={2}
        title={`${t("toolAudio")} · ${t("toolMoreOptions")}`}
        aria-label={t("toolAudio")}
        data-pressed={audioMuted}
        aria-haspopup="menu"
        aria-expanded={open === "audio"}
        className={`${styles.tool} ${audioMuted ? styles.toolActive : ""}`}
        {...flyoutTriggers("audio")}
        onClick={() => {
          if (swallowHeldClick()) return;
          setOpen(open === "audio" ? null : "audio");
        }}
      >
        {audioMuted ? <VolumeOff size={19} /> : <Volume2 size={19} />}
      </button>
      {flyoutFor("audio")}
      {(onHideWebcam || onOpenCursor) && <span className={styles.railSeparator} aria-hidden />}
      {/* An action like Zoom: a hidden webcam section from the playhead on. */}
      {onHideWebcam && (
        <button
          type="button"
          title={t("hintHideWebcam")}
          aria-label={t("webcamHideHere")}
          className={styles.tool}
          onClick={onHideWebcam}
        >
          <EyeOff size={19} />
        </button>
      )}
      {/* The recorded pointer, redrawn by the editor. A mouse, not an arrow, so it never
          reads as a second Select tool. */}
      {onOpenCursor && (
        <button
          type="button"
          title={t("hintCursor")}
          aria-label={t("cursorTitle")}
          aria-pressed={cursorSelected}
          className={`${styles.tool} ${cursorSelected ? styles.toolActive : ""}`}
          onClick={onOpenCursor}
        >
          <Mouse size={19} />
        </button>
      )}
    </div>
  );
}

/**
 * Undo/redo, image, the status chips and Export: the editor's global actions, in one
 * row. The page renders it into the title bar's right side (Kaipu Black, NIW2-619); it
 * used to be a card above the inspector (NIW2-611). Split and delete act on the
 * playhead and the selection, so they sit on the transport bar (NIW2-664).
 */
export function EditorToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onAddImage,
  onExport,
  children,
  exportDisabled,
}: EditorToolbarProps): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const shortcuts = editShortcuts();

  return (
    <div {...uiArea("editorVideo.toolbar")} className={styles.toolbar}>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.iconBtn}
          title={`${t("undo")} (${shortcuts.undo})`}
          aria-label={t("undo")}
          disabled={!canUndo}
          onClick={onUndo}
        >
          <Undo2 size={18} />
        </button>
        <button
          type="button"
          className={styles.iconBtn}
          title={`${t("redo")} (${shortcuts.redo})`}
          aria-label={t("redo")}
          disabled={!canRedo}
          onClick={onRedo}
        >
          <Redo2 size={18} />
        </button>
        <span className={styles.divider} />
        <input
          ref={fileInputRef}
          type="file"
          data-testid="slide-image-input"
          accept={SLIDE_IMAGE_TYPES}
          className={styles.hiddenInput}
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Reset so choosing the same file again still fires a change event.
            event.target.value = "";
            if (file) onAddImage(file);
          }}
        />
        <button
          type="button"
          className={styles.iconBtn}
          title={t("addImage")}
          aria-label={t("addImage")}
          onClick={() => fileInputRef.current?.click()}
        >
          <ImagePlus size={18} />
        </button>
      </div>
      {children && <div className={styles.status}>{children}</div>}
      <button
        type="button"
        className={styles.exportBtn}
        disabled={exportDisabled}
        onClick={onExport}
      >
        <Download size={16} />
        {t("export")}
      </button>
    </div>
  );
}
