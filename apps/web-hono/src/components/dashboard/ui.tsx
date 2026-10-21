import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import * as stylex from "@stylexjs/stylex";
import { TriangleAlert } from "lucide-react";

import { bp, kl, tone } from "./dashboard.stylex";

/**
 * The pieces every dashboard page is built from (design: "Kaipu Dashboard.dc.html"). Each one is
 * a real element: buttons are <button>, fields have a <label>, notices are status regions. They
 * take text as props and know nothing about routes or data, so pages stay the place where copy
 * and behaviour live.
 */

const pulse = stylex.keyframes({
  "0%, 100%": { opacity: 0.45 },
  "50%": { opacity: 0.9 },
});

const pop = stylex.keyframes({
  "0%": { transform: "translateY(6px) scale(0.98)", opacity: 0 },
  "100%": { transform: "none", opacity: 1 },
});

const focusRing = {
  outline: "none",
  boxShadow: { default: null, ":focus-visible": "0 0 0 3px rgba(246, 5, 92, 0.18)" },
} as const;

const s = stylex.create({
  // ---------- buttons ----------
  btn: {
    ...focusRing,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    boxSizing: "border-box",
    height: "40px",
    paddingInline: "16px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: { default: "transparent", ":focus-visible": kl.pink },
    borderRadius: "10px",
    fontFamily: "inherit",
    fontSize: "14px",
    fontWeight: 600,
    lineHeight: 1.2,
    textAlign: "center",
    textDecoration: "none",
    whiteSpace: "nowrap",
    cursor: "pointer",
    transitionProperty: "background-color, border-color, box-shadow",
    transitionDuration: "0.15s",
  },
  sm: { height: "36px", paddingInline: "14px" },
  lg: { height: "44px" },
  full: { width: "100%" },
  // Spanish runs 20-30% longer: a phone-width button wraps instead of truncating.
  wrap: { whiteSpace: "normal", height: "auto", minHeight: "44px", paddingBlock: "8px" },
  disabled: { opacity: 0.5, cursor: "not-allowed", boxShadow: "none" },
  pink: {
    backgroundColor: { default: kl.pink, ":hover": tone.pinkHover },
    color: "#ffffff",
    boxShadow: { default: tone.pinkGlow, ":focus-visible": "0 0 0 3px rgba(246, 5, 92, 0.18)" },
  },
  outline: {
    backgroundColor: { default: "transparent", ":hover": kl.card2 },
    borderColor: { default: kl.bd2, ":focus-visible": kl.pink },
    color: kl.tx,
  },
  danger: {
    backgroundColor: tone.red,
    color: "#ffffff",
  },
  dangerOutline: {
    backgroundColor: { default: "transparent", ":hover": tone.redSoft },
    borderColor: { default: "rgba(239, 68, 68, 0.45)", ":focus-visible": tone.red },
    color: tone.red,
  },
  google: {
    backgroundColor: kl.tx,
    color: kl.bg,
  },
  iconBtn: {
    ...focusRing,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: "36px",
    height: "36px",
    padding: 0,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: { default: kl.bd, ":focus-visible": kl.pink },
    borderRadius: "9px",
    backgroundColor: { default: "transparent", ":hover": kl.card2 },
    color: kl.dim,
    cursor: { default: "pointer", ":disabled": "not-allowed" },
    opacity: { default: 1, ":disabled": 0.5 },
  },
  textLink: {
    ...focusRing,
    padding: 0,
    borderStyle: "none",
    borderRadius: "4px",
    backgroundColor: "transparent",
    color: { default: kl.pinkTx, ":hover": kl.pink },
    fontFamily: "inherit",
    fontSize: "13.5px",
    fontWeight: 600,
    textDecoration: "none",
    whiteSpace: "nowrap",
    cursor: "pointer",
  },
  quietLink: {
    ...focusRing,
    padding: 0,
    borderStyle: "none",
    borderRadius: "4px",
    backgroundColor: "transparent",
    color: { default: kl.faint, ":hover": kl.tx },
    fontFamily: "inherit",
    fontSize: "13px",
    textDecoration: "none",
    cursor: "pointer",
  },

  // ---------- tag ----------
  tag: {
    display: "inline-flex",
    alignItems: "center",
    paddingBlock: "2px",
    paddingInline: "7px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderRadius: "5px",
    fontFamily: kl.fontMono,
    fontSize: "10px",
    fontWeight: 600,
    letterSpacing: "0.1em",
    lineHeight: 1.5,
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  },
  tagSoon: {
    color: kl.faint,
    backgroundColor: "transparent",
    borderColor: kl.bd2,
    borderStyle: "dashed",
  },
  tagPink: { color: kl.pinkTx, backgroundColor: tone.pinkSoft, borderColor: tone.pinkEdge },
  tagOk: { color: tone.green, backgroundColor: tone.greenSoft, borderColor: tone.greenEdge },
  tagWarn: { color: tone.amber, backgroundColor: tone.amberSoft, borderColor: tone.amberEdge },
  tagRed: { color: tone.red, backgroundColor: tone.redSoft, borderColor: tone.redEdge },
  tagBlue: { color: tone.blue, backgroundColor: tone.blueSoft, borderColor: tone.blueEdge },

  // ---------- card ----------
  card: {
    boxSizing: "border-box",
    minWidth: 0,
    padding: { default: "22px", [bp.mobile]: "18px" },
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: kl.bd,
    borderRadius: "16px",
    backgroundColor: kl.card,
  },
  cardDanger: { borderColor: "rgba(239, 68, 68, 0.35)" },
  cardHead: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "10px",
    marginBottom: "16px",
  },
  cardTitle: {
    flex: "1",
    margin: 0,
    fontSize: "16.5px",
    fontWeight: 600,
    letterSpacing: "-0.015em",
    color: kl.tx,
  },
  cardTitleDanger: { color: tone.red },

  // ---------- notice ----------
  notice: {
    display: "flex",
    flexWrap: { default: "nowrap", [bp.mobile]: "wrap" },
    alignItems: "flex-start",
    gap: "13px",
    paddingBlock: "14px",
    paddingInline: "15px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderRadius: "12px",
  },
  noticeNeutral: { backgroundColor: kl.bg2, borderColor: kl.bd },
  noticeWarn: { backgroundColor: tone.amberSoft, borderColor: tone.amberEdge },
  noticeDanger: { backgroundColor: tone.redSoft, borderColor: tone.redEdge },
  noticePink: { backgroundColor: tone.pinkSoft, borderColor: tone.pinkEdge },
  noticeIcon: { display: "flex", flexShrink: 0, marginTop: "1px" },
  iconNeutral: { color: kl.dim },
  iconWarn: { color: tone.amber },
  iconDanger: { color: tone.red },
  iconPink: { color: kl.pinkTx },
  noticeBody: { flex: "1", minWidth: 0 },
  noticeTitle: { margin: 0, fontSize: "14.5px", fontWeight: 600, color: kl.tx },
  noticeDetail: {
    margin: 0,
    marginTop: "4px",
    fontSize: "13.5px",
    lineHeight: 1.5,
    color: kl.dim,
    textWrap: "pretty",
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "8px",
    marginTop: "12px",
  },

  // ---------- form panel ----------
  panel: {
    marginTop: "18px",
    padding: { default: "18px", [bp.mobile]: "14px" },
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: kl.bd,
    borderRadius: "12px",
    backgroundColor: kl.bg2,
  },
  panelTitle: { margin: 0, marginBottom: "4px", fontSize: "14.5px", fontWeight: 600, color: kl.tx },
  panelIntro: {
    margin: 0,
    marginBottom: "14px",
    fontSize: "13px",
    lineHeight: 1.45,
    color: kl.dim,
  },
  pair: {
    display: "grid",
    gridTemplateColumns: { default: "1fr 1fr", [bp.mobile]: "1fr" },
    columnGap: "12px",
  },
  formMsg: { margin: 0, marginBottom: "12px", fontSize: "13px", lineHeight: 1.45 },
  formOk: { color: tone.green },
  formErr: { color: tone.red },

  // ---------- page ----------
  page: { display: "flex", flexDirection: "column", gap: "16px" },

  // ---------- heading ----------
  heading: { marginBottom: { default: "12px", [bp.mobile]: "4px" } },
  headingRow: { display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "10px" },
  h1: {
    margin: 0,
    fontSize: { default: "36px", [bp.mobile]: "30px" },
    fontWeight: 700,
    letterSpacing: "-0.045em",
    lineHeight: 1.05,
    color: kl.tx,
  },
  serif: {
    fontFamily: kl.fontSerif,
    fontStyle: "italic",
    fontWeight: 400,
    fontSize: { default: "32px", [bp.mobile]: "26px" },
    lineHeight: 1.05,
    color: kl.pinkTx,
  },
  desc: { margin: 0, marginTop: "8px", fontSize: "15px", lineHeight: 1.5, color: kl.dim },

  // ---------- field ----------
  field: { marginBottom: "14px" },
  label: {
    display: "flex",
    justifyContent: "space-between",
    gap: "8px",
    marginBottom: "7px",
    fontSize: "13px",
    fontWeight: 600,
    color: kl.tx,
  },
  input: {
    boxSizing: "border-box",
    width: "100%",
    height: "44px",
    paddingInline: "13px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: { default: kl.bd2, ":focus": kl.pink },
    borderRadius: "10px",
    outline: "none",
    backgroundColor: kl.card,
    color: kl.tx,
    fontFamily: kl.fontSans,
    fontSize: "14.5px",
    boxShadow: { default: "none", ":focus": "0 0 0 3px rgba(246, 5, 92, 0.18)" },
    transitionProperty: "border-color, box-shadow",
    transitionDuration: "0.15s",
    "::placeholder": { color: kl.faint },
  },
  inputError: { borderColor: { default: tone.red, ":focus": tone.red } },
  fieldError: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    margin: 0,
    marginTop: "7px",
    fontSize: "12.5px",
    color: tone.red,
  },
  help: { margin: 0, marginTop: "7px", fontSize: "12.5px", lineHeight: 1.45, color: kl.faint },

  // ---------- glow box ----------
  glow: {
    position: "relative",
    overflow: "hidden",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: kl.bd,
    borderRadius: "16px",
    backgroundColor: kl.card,
  },
  glowAccent: { borderColor: "rgba(246, 5, 92, 0.3)" },
  glowLayer: {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    backgroundImage: "radial-gradient(60% 80% at 15% 20%, rgba(246, 5, 92, 0.11), transparent 70%)",
  },
  dotLayer: {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    backgroundImage: "radial-gradient(var(--kl-dot) 1px, transparent 1px)",
    backgroundSize: "22px 22px",
  },
  glowBody: { position: "relative" },

  // ---------- coming soon ----------
  soon: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    paddingBlock: "15px",
    paddingInline: "16px",
    borderWidth: "1px",
    borderStyle: "dashed",
    borderColor: kl.bd2,
    borderRadius: "14px",
    color: kl.faint,
  },
  soonBody: { flex: "1", minWidth: 0 },
  soonTitle: { margin: 0, fontSize: "14.5px", fontWeight: 600, color: kl.faint },
  soonDetail: { margin: 0, marginTop: "3px", fontSize: "13px", lineHeight: 1.45 },

  // ---------- skeleton ----------
  skeleton: {
    borderRadius: "6px",
    backgroundColor: kl.card2,
    animationName: { default: pulse, [bp.reducedMotion]: "none" },
    animationDuration: "1.4s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
  },

  // ---------- dialog ----------
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 50,
    display: "flex",
    alignItems: { default: "center", [bp.mobile]: "flex-end" },
    justifyContent: "center",
    padding: { default: "24px", [bp.mobile]: 0 },
    backgroundColor: "rgba(6, 6, 8, 0.55)",
  },
  dialog: {
    boxSizing: "border-box",
    width: { default: "480px", [bp.mobile]: "100%" },
    maxWidth: "100%",
    maxHeight: "92svh",
    overflowY: "auto",
    padding: { default: "24px", [bp.mobile]: "20px" },
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: kl.bd2,
    borderRadius: { default: "16px", [bp.mobile]: "20px 20px 0 0" },
    backgroundColor: kl.card,
    color: kl.tx,
    fontFamily: kl.fontSans,
    boxShadow: "0 40px 100px -30px rgba(0, 0, 0, 0.9)",
    outline: "none",
    animationName: { default: pop, [bp.reducedMotion]: "none" },
    animationDuration: "0.2s",
    animationTimingFunction: "ease",
  },
  dialogTitle: { margin: 0, fontSize: "19px", fontWeight: 700, letterSpacing: "-0.02em" },
  dialogActions: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: "8px",
    marginTop: "20px",
  },
});

// ---------------------------------------------------------------------------------------------

export type ButtonVariant = "pink" | "outline" | "danger" | "dangerOutline" | "google";

const VARIANT = {
  pink: s.pink,
  outline: s.outline,
  danger: s.danger,
  dangerOutline: s.dangerOutline,
  google: s.google,
} as const;

export interface ButtonLook {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  full?: boolean;
  /** Let a long label wrap onto two lines (phone widths, Spanish). */
  wrap?: boolean;
  disabled?: boolean;
}

/**
 * The design's button look as StyleX props, for elements that are not a <button>: an <a> to a
 * download, a router <Link>. The <button> itself is `Button`.
 */
export function buttonProps({
  variant = "outline",
  size = "md",
  full = false,
  wrap = false,
  disabled = false,
}: ButtonLook = {}) {
  return stylex.props(
    s.btn,
    size === "sm" && s.sm,
    size === "lg" && s.lg,
    VARIANT[variant],
    full && s.full,
    wrap && s.wrap,
    disabled && s.disabled,
  );
}

export function Button({
  variant,
  size,
  full,
  wrap,
  icon,
  children,
  type = "button",
  disabled,
  ...rest
}: ButtonLook &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "style"> & { icon?: ReactNode }) {
  return (
    <button
      type={type}
      disabled={disabled}
      {...rest}
      {...buttonProps({ variant, size, full, wrap, disabled })}
    >
      {icon}
      {children}
    </button>
  );
}

/** A square, icon-only button. `label` is its accessible name and tooltip. */
export function IconButton({
  label,
  children,
  ...rest
}: { label: string; children: ReactNode } & Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "className" | "style" | "aria-label"
>) {
  return (
    <button type="button" aria-label={label} title={label} {...rest} {...stylex.props(s.iconBtn)}>
      {children}
    </button>
  );
}

/** Pink inline action text ("Manage →"). Use on an <a>, a <Link> or a <button>. */
export const textLinkProps = () => stylex.props(s.textLink);
/** Faint inline action text ("Download again", "Dismiss"). */
export const quietLinkProps = () => stylex.props(s.quietLink);

// ---------------------------------------------------------------------------------------------

export type TagTone = "soon" | "pink" | "ok" | "warn" | "red" | "blue";

const TAG = {
  soon: s.tagSoon,
  pink: s.tagPink,
  ok: s.tagOk,
  warn: s.tagWarn,
  red: s.tagRed,
  blue: s.tagBlue,
} as const;

/** A small mono badge. The words carry the meaning; colour only repeats it. */
export function Tag({ tone: t = "soon", children }: { tone?: TagTone; children: ReactNode }) {
  return <span {...stylex.props(s.tag, TAG[t])}>{children}</span>;
}

// ---------------------------------------------------------------------------------------------

/** A flat data card: hairline border, no glow. `title` renders as the card's h2. */
export function Card({
  title,
  action,
  danger = false,
  children,
  labelledBy,
}: {
  title?: ReactNode;
  action?: ReactNode;
  danger?: boolean;
  children?: ReactNode;
  labelledBy?: string;
}) {
  const id = useId();
  const headingId = labelledBy ?? (title ? id : undefined);
  return (
    <section aria-labelledby={headingId} {...stylex.props(s.card, danger && s.cardDanger)}>
      {title ? (
        <div {...stylex.props(s.cardHead)}>
          <h2 id={headingId} {...stylex.props(s.cardTitle, danger && s.cardTitleDanger)}>
            {title}
          </h2>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------

export type NoticeTone = "neutral" | "warn" | "danger" | "pink";

const NOTICE = {
  neutral: [s.noticeNeutral, s.iconNeutral],
  warn: [s.noticeWarn, s.iconWarn],
  danger: [s.noticeDanger, s.iconDanger],
  pink: [s.noticePink, s.iconPink],
} as const;

/**
 * A passive message on the page, never a toast: the page shows state, not events. `role` is
 * "status" by default; pass "alert" only for a failure the visitor has to act on.
 */
export function Notice({
  tone: t = "neutral",
  icon,
  title,
  detail,
  actions,
  role = "status",
}: {
  tone?: NoticeTone;
  icon?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  actions?: ReactNode;
  role?: "status" | "alert";
}) {
  const [box, iconTone] = NOTICE[t];
  return (
    <div role={role} {...stylex.props(s.notice, box)}>
      {icon ? (
        <span aria-hidden {...stylex.props(s.noticeIcon, iconTone)}>
          {icon}
        </span>
      ) : null}
      <div {...stylex.props(s.noticeBody)}>
        <p {...stylex.props(s.noticeTitle)}>{title}</p>
        {detail ? <p {...stylex.props(s.noticeDetail)}>{detail}</p> : null}
        {actions ? <div {...stylex.props(s.actions)}>{actions}</div> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

/**
 * A recessed form inside a card (Change password, Set a password): its own h3 title and one line
 * of context, then the fields.
 */
export function FormPanel({
  title,
  intro,
  children,
}: {
  title: ReactNode;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div {...stylex.props(s.panel)}>
      <h3 {...stylex.props(s.panelTitle)}>{title}</h3>
      {intro ? <p {...stylex.props(s.panelIntro)}>{intro}</p> : null}
      {children}
    </div>
  );
}

/** Two fields side by side on desktop, stacked on a phone. */
export function FieldPair({ children }: { children: ReactNode }) {
  return <div {...stylex.props(s.pair)}>{children}</div>;
}

/** A small inline status line under a form: green for done, red (role=alert) for a failure. */
export function FormMessage({ tone: t, children }: { tone: "ok" | "error"; children: ReactNode }) {
  return (
    <p
      role={t === "ok" ? "status" : "alert"}
      {...stylex.props(s.formMsg, t === "ok" ? s.formOk : s.formErr)}
    >
      {children}
    </p>
  );
}

/** A page's column: heading, notices and cards, 16px apart. */
export function PageStack({ children }: { children: ReactNode }) {
  return <div {...stylex.props(s.page)}>{children}</div>;
}

/** A page's opening: a bold phrase, an optional pink serif second voice, one line of context. */
export function PageHeading({
  title,
  serif,
  description,
  extra,
}: {
  title: ReactNode;
  serif?: ReactNode;
  description?: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <header {...stylex.props(s.heading)}>
      <div {...stylex.props(s.headingRow)}>
        <h1 {...stylex.props(s.h1)}>{title}</h1>
        {serif ? <span {...stylex.props(s.serif)}>{serif}</span> : null}
        {extra}
      </div>
      {description ? <p {...stylex.props(s.desc)}>{description}</p> : null}
    </header>
  );
}

// ---------------------------------------------------------------------------------------------

/**
 * A labelled input with its error (role=alert, linked by aria-describedby) and help line. The
 * input is controlled by the caller; every other attribute passes through.
 */
export function Field({
  id,
  label,
  error,
  help,
  right,
  ...input
}: {
  id: string;
  label: ReactNode;
  error?: string | null;
  help?: ReactNode;
  right?: ReactNode;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "style" | "id">) {
  const errorId = `${id}-error`;
  const helpId = `${id}-help`;
  const describedBy = [error ? errorId : null, help ? helpId : null].filter(Boolean).join(" ");
  return (
    <div {...stylex.props(s.field)}>
      <label htmlFor={id} {...stylex.props(s.label)}>
        <span>{label}</span>
        {right}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...input}
        {...stylex.props(s.input, Boolean(error) && s.inputError)}
      />
      {error ? (
        <p id={errorId} role="alert" {...stylex.props(s.fieldError)}>
          <TriangleAlert size={13} aria-hidden />
          {error}
        </p>
      ) : null}
      {help ? (
        <p id={helpId} {...stylex.props(s.help)}>
          {help}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

/**
 * The moment surface: radial pink glow and the 22px dot grid. "Glow where there is a moment,
 * never where there is a task": first visit, get the desktop app, empty states. Never on data.
 */
export function GlowBox({ accent = false, children }: { accent?: boolean; children: ReactNode }) {
  return (
    <div {...stylex.props(s.glow, accent && s.glowAccent)}>
      <div aria-hidden {...stylex.props(s.glowLayer)} />
      <div aria-hidden {...stylex.props(s.dotLayer)} />
      <div {...stylex.props(s.glowBody)}>{children}</div>
    </div>
  );
}

/** Planned work: faint text, a dashed border, a mono tag. Not clickable, no dates. */
export function SoonRow({
  title,
  detail,
  tag,
}: {
  title: ReactNode;
  detail: ReactNode;
  tag: ReactNode;
}) {
  return (
    <div aria-disabled="true" {...stylex.props(s.soon)}>
      <div {...stylex.props(s.soonBody)}>
        <p {...stylex.props(s.soonTitle)}>{title}</p>
        <p {...stylex.props(s.soonDetail)}>{detail}</p>
      </div>
      <Tag>{tag}</Tag>
    </div>
  );
}

/** A pulsing placeholder block. Width and height come from the caller. */
export function Skeleton({ width = "100%", height }: { width?: string | number; height: number }) {
  return (
    <div
      data-loading
      {...stylex.props(s.skeleton)}
      // Sizes vary per call site; they are layout, not theme.
      style={{ width, height }}
    />
  );
}

// ---------------------------------------------------------------------------------------------

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * A modal dialog: centred card on desktop, bottom sheet on a phone. Focus moves into it on open,
 * Tab stays inside, Escape and a backdrop click call `onClose`, and focus returns to whatever
 * opened it. It renders in place, not in a portal, so it stays inside the shell's `[data-kl]`
 * and keeps the theme.
 */
export function Dialog({
  open,
  title,
  onClose,
  children,
  actions,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input, " + FOCUSABLE);
    (first ?? ref.current)?.focus();
    return () => opener?.focus?.();
  }, [open]);

  if (!open) return null;

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const firstItem = items[0];
    const lastItem = items[items.length - 1];
    if (event.shiftKey && document.activeElement === firstItem) {
      event.preventDefault();
      lastItem?.focus();
    } else if (!event.shiftKey && document.activeElement === lastItem) {
      event.preventDefault();
      firstItem?.focus();
    }
  };

  return (
    <div {...stylex.props(s.overlay)} onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        // A click inside the card must not reach the backdrop's dismiss.
        onClick={(e) => e.stopPropagation()}
        {...stylex.props(s.dialog)}
      >
        <h2 id={titleId} {...stylex.props(s.dialogTitle)}>
          {title}
        </h2>
        {children}
        {actions ? <div {...stylex.props(s.dialogActions)}>{actions}</div> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

/** Brand marks lucide does not carry, drawn as in the design. */
export function AppleMark({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.7 0-1.9-.9-3.1-.8-1.6 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2.1-1.1 2.8-2.3.9-1.3 1.3-2.6 1.3-2.7 0 0-2.4-.9-2.4-3.7zM14.1 5.7c.6-.8 1.1-1.8 1-2.9-.9 0-2.1.6-2.7 1.4-.6.7-1.1 1.8-1 2.8 1 .1 2.1-.5 2.7-1.3z" />
    </svg>
  );
}

export function WindowsMark({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <rect x="3" y="3" width="8" height="8" rx="1" />
      <rect x="13" y="3" width="8" height="8" rx="1" />
      <rect x="3" y="13" width="8" height="8" rx="1" />
      <rect x="13" y="13" width="8" height="8" rx="1" />
    </svg>
  );
}

/** The Google "G", in its own colours on any background. */
export function GoogleMark({ size = 17 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 48 48" focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
