import * as stylex from "@stylexjs/stylex";
import { tokens } from "@kaipu/tokens/kaipu.stylex";
import type { ReactNode } from "react";

/**
 * The frame of the screen/window picker: a backdrop, a titled card with a close
 * button, a row of tabs, and a scrolling content area that the caller fills.
 * A molecule because it carries behavior — a click on the bare backdrop closes
 * it, a click inside does not — and because it owns the tab row.
 *
 * Which tab is active, what each tab filters to, and whether the picker is open
 * at all are the caller's: this renders a frame around whatever it is handed.
 * It is a sibling of `ModalOverlay`, not a use of it, because the two differ in
 * the ways that matter — this is a wide, scrolling card with no alert role and
 * no focus capture — and bending one component to both would trade pixels or
 * behavior.
 */
const fade = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
});

const pop = stylex.keyframes({
  from: { opacity: 0, transform: "scale(0.94)" },
  to: { opacity: 1, transform: "scale(1)" },
});

const styles = stylex.create({
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 50,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: tokens.spaceXl,
    backgroundColor: tokens.bgOverlay,
    backdropFilter: "blur(4px)",
    animationName: fade,
    animationDuration: "150ms",
    animationTimingFunction: "ease",
  },
  modal: {
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    width: "100%",
    maxWidth: "640px",
    maxHeight: "80vh",
    backgroundColor: tokens.bgModal,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.borderLight,
    borderRadius: tokens.radiusLg,
    boxShadow: "0 24px 60px -16px rgba(0, 0, 0, 0.6)",
    animationName: pop,
    animationDuration: "250ms",
    animationTimingFunction: "ease",
  },
  header: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBlock: "16px",
    paddingInline: "18px",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.border,
  },
  title: {
    fontSize: "15px",
    fontWeight: tokens.fontWeightSemibold,
    letterSpacing: "-0.01em",
    color: tokens.textPrimary,
  },
  close: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "28px",
    height: "28px",
    borderStyle: "none",
    borderRadius: tokens.radiusMd,
    backgroundColor: {
      default: "transparent",
      ":hover": tokens.bgCardHover,
    },
    color: {
      default: tokens.textMuted,
      ":hover": tokens.textPrimary,
    },
    cursor: "pointer",
    transitionProperty: "background-color, color",
    transitionDuration: "150ms",
    transitionTimingFunction: "ease",
  },
  tabs: {
    flexShrink: 0,
    display: "flex",
    gap: "2px",
    paddingTop: "10px",
    paddingInline: "18px",
    paddingBottom: 0,
  },
  tab: {
    paddingBlock: "6px",
    paddingInline: "12px",
    borderStyle: "none",
    borderRadius: "999px",
    backgroundColor: {
      default: "transparent",
      ":hover": tokens.bgCardHover,
    },
    color: {
      default: tokens.textSecondary,
      ":hover": tokens.textPrimary,
    },
    fontFamily: tokens.fontFamily,
    fontSize: tokens.fontSizeBase,
    fontWeight: tokens.fontWeightMedium,
    cursor: "pointer",
    transitionProperty: "background-color, color",
    transitionDuration: "150ms",
    transitionTimingFunction: "ease",
  },
  // The active tab holds its tint even under the pointer.
  tabActive: {
    backgroundColor: "rgba(246, 5, 92, 0.12)",
    color: tokens.accentPrimary,
  },
  content: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minHeight: 0,
    overflowY: "auto",
    // Reserve the scrollbar's lane (themed globally) so it never overlaps the
    // tile grid; the trimmed right padding balances that lane.
    scrollbarGutter: "stable",
    paddingBlock: "18px",
    paddingInlineStart: "18px",
    paddingInlineEnd: "12px",
  },
});

export interface SourcePickerTab {
  id: string;
  label: string;
}

export interface SourcePickerProps {
  title: string;
  tabs: SourcePickerTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  onClose: () => void;
  /** What fills the content area: a grid, a message, a spinner. */
  children: ReactNode;
}

export function SourcePicker({
  title,
  tabs,
  activeTab,
  onTabChange,
  onClose,
  children,
}: SourcePickerProps) {
  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      {...stylex.props(styles.overlay)}
    >
      <div {...stylex.props(styles.modal)}>
        <div {...stylex.props(styles.header)}>
          <h3 {...stylex.props(styles.title)}>{title}</h3>
          <button type="button" onClick={onClose} {...stylex.props(styles.close)}>
            ✕
          </button>
        </div>

        <div {...stylex.props(styles.tabs)}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              data-active={tab.id === activeTab || undefined}
              onClick={() => onTabChange(tab.id)}
              {...stylex.props(styles.tab, tab.id === activeTab && styles.tabActive)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div {...stylex.props(styles.content)}>{children}</div>
      </div>
    </div>
  );
}
