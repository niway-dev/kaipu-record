import { useId, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { ArrowLeft, ArrowRight, Eye, EyeOff, Lock, Mail, TriangleAlert } from "lucide-react";
import { KaipuLogo, type LogoUse } from "@kaipu/brand";
import { useTranslations } from "@kaipu/i18n";

import { bp, danger, kl } from "./auth.stylex";

/**
 * The pieces every auth view is built from (design: "Kaipu Web Auth.dc.html"). Each one is a
 * real element — buttons are <button>, links are <a>, fields have a <label> — so keyboard order
 * and screen readers follow the visual order without extra wiring.
 */

const focusRing = {
  outline: { default: "none", ":focus-visible": "2px solid #f6055c" },
  outlineOffset: "2px",
} as const;

const floatKeyframes = stylex.keyframes({
  "0%, 100%": { transform: "translateY(0)" },
  "50%": { transform: "translateY(-8px)" },
});

const s = stylex.create({
  heading: {
    margin: 0,
    fontSize: { default: "34px", [bp.mobile]: "30px" },
    fontWeight: 700,
    letterSpacing: "-0.04em",
    lineHeight: 1.05,
    color: kl.tx,
  },
  headingCompact: { fontSize: "30px" },
  lead: {
    margin: 0,
    marginTop: "8px",
    marginBottom: "24px",
    fontSize: "15px",
    lineHeight: 1.5,
    color: kl.dim,
  },
  primary: {
    ...focusRing,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    width: "100%",
    height: "48px",
    marginTop: "18px",
    borderStyle: "none",
    borderRadius: "11px",
    backgroundColor: { default: kl.pink, ":hover": "#d4044f" },
    color: "#ffffff",
    fontFamily: "inherit",
    fontSize: "15px",
    fontWeight: 600,
    textDecoration: "none",
    cursor: { default: "pointer", ":disabled": "default" },
    opacity: { default: 1, ":disabled": 0.6 },
    boxShadow: "0 12px 28px -12px rgba(246, 5, 92, 0.9)",
  },
  primaryLarge: { height: "50px", borderRadius: "12px", fontSize: "15.5px", marginTop: "22px" },
  ghost: {
    ...focusRing,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
    width: "100%",
    height: "48px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: kl.bd2,
    borderRadius: "11px",
    backgroundColor: { default: "transparent", ":hover": kl.card2 },
    color: kl.tx,
    fontFamily: "inherit",
    fontSize: "15px",
    fontWeight: 500,
    textDecoration: "none",
    cursor: { default: "pointer", ":disabled": "default" },
    opacity: { default: 1, ":disabled": 0.6 },
  },
  quiet: {
    ...focusRing,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
    padding: 0,
    borderStyle: "none",
    backgroundColor: "transparent",
    color: { default: kl.dim, ":hover": kl.tx },
    fontFamily: "inherit",
    fontSize: "13px",
    textDecoration: "none",
    cursor: "pointer",
  },
  quietBlock: { display: "flex", width: "100%", marginTop: "14px" },
  accentLink: {
    ...focusRing,
    padding: 0,
    borderStyle: "none",
    backgroundColor: "transparent",
    color: kl.pinkTx,
    fontFamily: "inherit",
    fontSize: "12.5px",
    fontWeight: 600,
    textDecoration: { default: "none", ":hover": "underline" },
    cursor: "pointer",
  },
  field: { display: "block", marginTop: "14px" },
  fieldFirst: { marginTop: 0 },
  labelRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: "7px",
  },
  label: { fontSize: "13px", fontWeight: 600, color: kl.tx },
  hint: { fontFamily: kl.fontMono, fontSize: "11px", color: kl.faint },
  inputWrap: { position: "relative" },
  input: {
    boxSizing: "border-box",
    width: "100%",
    height: "46px",
    paddingInline: "14px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: { default: kl.bd2, ":focus": kl.pink },
    borderRadius: "10px",
    backgroundColor: kl.card,
    color: kl.tx,
    fontFamily: kl.fontSans,
    fontSize: "15px",
    outline: "none",
    boxShadow: { default: "none", ":focus": "0 0 0 3px rgba(246, 5, 92, 0.18)" },
    transitionProperty: "border-color, box-shadow",
    transitionDuration: "0.15s",
    "::placeholder": { color: kl.faint },
  },
  inputWithToggle: { paddingRight: "46px" },
  inputError: { borderColor: { default: danger.line, ":focus": danger.line } },
  eye: {
    ...focusRing,
    position: "absolute",
    right: "6px",
    top: "6px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "34px",
    height: "34px",
    padding: 0,
    borderStyle: "none",
    borderRadius: "8px",
    backgroundColor: "transparent",
    color: { default: kl.faint, ":hover": kl.tx },
    cursor: "pointer",
  },
  fieldError: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    marginTop: "7px",
    fontSize: "12.5px",
    color: danger.line,
  },
  divider: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    margin: "22px 0 18px",
  },
  dividerLine: { flex: 1, height: "1px", backgroundColor: kl.bd },
  dividerText: {
    fontFamily: kl.fontMono,
    fontSize: "11px",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: kl.faint,
  },
  banner: {
    display: "flex",
    gap: "9px",
    marginTop: "14px",
    padding: "11px 13px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: danger.edge,
    borderRadius: "10px",
    backgroundColor: danger.soft,
    fontSize: "13px",
    lineHeight: 1.45,
    color: kl.tx,
  },
  bannerIcon: { flexShrink: 0, marginTop: "2px", color: danger.line },
  bannerBody: { minWidth: 0 },
  panel: {
    marginTop: "10px",
    padding: "11px 13px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: kl.bd,
    borderRadius: "10px",
    backgroundColor: kl.bg2,
    fontSize: "13px",
    lineHeight: 1.5,
    color: kl.dim,
  },
  note: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginTop: "18px",
    padding: "11px 13px",
    borderWidth: "1px",
    borderStyle: "dashed",
    borderColor: kl.bd2,
    borderRadius: "10px",
    fontSize: "12.5px",
    lineHeight: 1.45,
    color: kl.dim,
  },
  noteIcon: { flexShrink: 0 },
  desktopBanner: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    marginBottom: "22px",
    padding: "11px 13px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "rgba(246, 5, 92, 0.3)",
    borderRadius: "12px",
    backgroundColor: "rgba(246, 5, 92, 0.08)",
  },
  desktopBannerText: { flex: 1, minWidth: 0 },
  desktopBannerTitle: { margin: 0, fontSize: "13.5px", fontWeight: 600, color: kl.tx },
  desktopBannerBody: { margin: 0, marginTop: "2px", fontSize: "12.5px", color: kl.dim },
  hero: { textAlign: "center" },
  heroFox: {
    marginInline: "auto",
    boxShadow: "0 18px 40px -16px rgba(246, 5, 92, 0.9)",
  },
  float: {
    // No float for visitors who asked the system for less motion.
    animationName: { default: floatKeyframes, [bp.reducedMotion]: "none" },
    animationDuration: "5s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
  },
  heroTitle: { marginTop: "22px" },
  heroBody: {
    margin: 0,
    marginTop: "10px",
    fontSize: "15px",
    lineHeight: 1.55,
    color: kl.dim,
  },
  spaced: { marginTop: "12px" },
  formBlock: { marginTop: "24px", textAlign: "left" },
  backRow: { marginBottom: "22px" },
  strong: { color: kl.tx, fontWeight: 600, overflowWrap: "anywhere" },
  small: { margin: 0, marginTop: "14px", fontSize: "12.5px", color: kl.faint },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: "9px",
    maxWidth: "100%",
    marginTop: "12px",
    padding: "6px 12px 6px 6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: kl.bd2,
    borderRadius: "999px",
  },
  chipAvatar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: "26px",
    height: "26px",
    borderRadius: "50%",
    backgroundColor: "#7c4dff",
    color: "#ffffff",
    fontSize: "12px",
    fontWeight: 600,
  },
  chipEmail: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: "13.5px",
    color: kl.tx,
  },
});

export function AuthHeading({ children, compact }: { children: ReactNode; compact?: boolean }) {
  return <h1 {...stylex.props(s.heading, compact && s.headingCompact)}>{children}</h1>;
}

export function AuthLead({ children }: { children: ReactNode }) {
  return <p {...stylex.props(s.lead)}>{children}</p>;
}

type ButtonProps = Omit<ComponentPropsWithoutRef<"button">, "className" | "style">;

/** The pink call to action. `arrow` adds the design's trailing →. */
export function PrimaryButton({
  children,
  arrow = true,
  large,
  icon,
  ...props
}: ButtonProps & { arrow?: boolean; large?: boolean; icon?: ReactNode }) {
  return (
    <button type="button" {...props} {...stylex.props(s.primary, large && s.primaryLarge)}>
      {icon}
      {children}
      {arrow ? <ArrowRight size={16} aria-hidden /> : null}
    </button>
  );
}

/** A primary-looking link, for actions that navigate (Go to your library, Open Gmail). */
export function PrimaryLink({
  children,
  href,
  large,
  ...props
}: Omit<ComponentPropsWithoutRef<"a">, "className" | "style"> & { large?: boolean }) {
  return (
    <a href={href} {...props} {...stylex.props(s.primary, large && s.primaryLarge)}>
      {children}
      <ArrowRight size={16} aria-hidden />
    </a>
  );
}

export function GhostButton({ children, icon, ...props }: ButtonProps & { icon?: ReactNode }) {
  return (
    <button type="button" {...props} {...stylex.props(s.ghost)}>
      {icon}
      {children}
    </button>
  );
}

export function GhostLink({
  children,
  icon,
  ...props
}: Omit<ComponentPropsWithoutRef<"a">, "className" | "style"> & { icon?: ReactNode }) {
  return (
    <a {...props} {...stylex.props(s.ghost)}>
      {icon}
      {children}
    </a>
  );
}

/** "Continue with email" / "Sign up with email". */
export function EmailRevealButton(props: ButtonProps) {
  return <GhostButton {...props} icon={<Mail size={17} aria-hidden />} />;
}

/** Low-emphasis text button: "Back to Google", "Wrong email? Change it". */
export function QuietButton({
  children,
  back,
  block,
  ...props
}: ButtonProps & { back?: boolean; block?: boolean }) {
  return (
    <button type="button" {...props} {...stylex.props(s.quiet, block && s.quietBlock)}>
      {back ? <ArrowLeft size={14} aria-hidden /> : null}
      {children}
    </button>
  );
}

/** Pink inline text action: "Forgot password?", "Resend". */
export function AccentButton({ children, ...props }: ButtonProps) {
  return (
    <button type="button" {...props} {...stylex.props(s.accentLink)}>
      {children}
    </button>
  );
}

/** Style props for a router <Link> that should look like a quiet or accent text link. */
export const linkStyles = {
  quiet: () => stylex.props(s.quiet),
  accent: () => stylex.props(s.accentLink),
};

type InputProps = Omit<ComponentPropsWithoutRef<"input">, "className" | "style" | "id">;

export function TextField({
  label,
  aside,
  error,
  first,
  ...input
}: InputProps & { label: string; aside?: ReactNode; error?: string; first?: boolean }) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div {...stylex.props(s.field, first && s.fieldFirst)}>
      <div {...stylex.props(s.labelRow)}>
        <label htmlFor={id} {...stylex.props(s.label)}>
          {label}
        </label>
        {aside}
      </div>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...input}
        {...stylex.props(s.input, error ? s.inputError : null)}
      />
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}

/** Password input with the design's eye toggle, a real button with a pressed state. */
export function PasswordField({
  label,
  aside,
  error,
  ...input
}: Omit<InputProps, "type"> & { label: string; aside?: ReactNode; error?: string }) {
  const t = useTranslations("auth");
  const id = useId();
  const errorId = `${id}-error`;
  const [visible, setVisible] = useState(false);
  return (
    <div {...stylex.props(s.field)}>
      <div {...stylex.props(s.labelRow)}>
        <label htmlFor={id} {...stylex.props(s.label)}>
          {label}
        </label>
        {aside}
      </div>
      <div {...stylex.props(s.inputWrap)}>
        <input
          id={id}
          type={visible ? "text" : "password"}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          {...input}
          {...stylex.props(s.input, s.inputWithToggle, error ? s.inputError : null)}
        />
        <button
          type="button"
          aria-label={visible ? t("hidePassword") : t("showPassword")}
          aria-pressed={visible}
          aria-controls={id}
          onClick={() => setVisible((v) => !v)}
          {...stylex.props(s.eye)}
        >
          {visible ? <EyeOff size={17} aria-hidden /> : <Eye size={17} aria-hidden />}
        </button>
      </div>
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}

export function FieldHint({ children }: { children: ReactNode }) {
  return <span {...stylex.props(s.hint)}>{children}</span>;
}

export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} {...stylex.props(s.fieldError)}>
      <TriangleAlert size={13} aria-hidden />
      {children}
    </p>
  );
}

export function OrDivider() {
  const t = useTranslations("auth");
  return (
    <div {...stylex.props(s.divider)}>
      <span {...stylex.props(s.dividerLine)} />
      <span {...stylex.props(s.dividerText)}>{t("orDivider")}</span>
      <span {...stylex.props(s.dividerLine)} />
    </div>
  );
}

/** The red banner (wrong credentials, Google closed). `role="alert"` is read as it appears. */
export function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div role="alert" {...stylex.props(s.banner)}>
      <TriangleAlert size={14} aria-hidden {...stylex.props(s.bannerIcon)} />
      <div {...stylex.props(s.bannerBody)}>{children}</div>
    </div>
  );
}

/** A neutral grey panel under a field, for a follow-up action. */
export function InfoPanel({ children }: { children: ReactNode }) {
  return <div {...stylex.props(s.panel)}>{children}</div>;
}

/** The dashed "Recording never needs an account…" note. */
export function AccountOptionalNote() {
  const t = useTranslations("auth");
  return (
    <p {...stylex.props(s.note)}>
      <Lock size={14} aria-hidden {...stylex.props(s.noteIcon)} />
      {t("accountOptional")}
    </p>
  );
}

/** "Kaipu Record for Mac is waiting" — shown while the desktop app waits for this tab. */
export function DesktopWaitingBanner({ platform }: { platform: string | null }) {
  const t = useTranslations("auth");
  return (
    <div role="status" {...stylex.props(s.desktopBanner)}>
      <KaipuLogo use="product" size={32} />
      <div {...stylex.props(s.desktopBannerText)}>
        <p {...stylex.props(s.desktopBannerTitle)}>
          {platform ? t("desktopWaitingTitle", { platform }) : t("desktopWaitingTitleGeneric")}
        </p>
        <p {...stylex.props(s.desktopBannerBody)}>{t("desktopWaitingBody")}</p>
      </div>
    </div>
  );
}

/** The centred fox + title opening the check-email, reset-sent and done views. */
export function HeroHeader({
  use,
  size = 84,
  float,
  title,
  children,
}: {
  use: LogoUse;
  size?: number;
  float?: boolean;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div {...stylex.props(s.hero)}>
      <KaipuLogo use={use} size={size} {...stylex.props(s.heroFox, float && s.float)} />
      <div {...stylex.props(s.heroTitle)}>
        <AuthHeading compact>{title}</AuthHeading>
      </div>
      {children}
    </div>
  );
}

export function HeroBody({ children }: { children: ReactNode }) {
  return <p {...stylex.props(s.heroBody)}>{children}</p>;
}

/** A form inside a centred hero view: back to left-aligned fields. */
export function FormBlock({ children }: { children: ReactNode }) {
  return <div {...stylex.props(s.formBlock)}>{children}</div>;
}

/** The row holding "Back to sign in" above a heading. */
export function BackRow({ children }: { children: ReactNode }) {
  return <div {...stylex.props(s.backRow)}>{children}</div>;
}

/** Puts a secondary action a little below the one above it. */
export function Spaced({ children }: { children: ReactNode }) {
  return <div {...stylex.props(s.spaced)}>{children}</div>;
}

export function Strong({ children }: { children: ReactNode }) {
  return <b {...stylex.props(s.strong)}>{children}</b>;
}

export function SmallPrint({ children, live }: { children: ReactNode; live?: boolean }) {
  return (
    <p aria-live={live ? "polite" : undefined} {...stylex.props(s.small)}>
      {children}
    </p>
  );
}

/** The signed-in account: initial avatar plus email. */
export function AccountChip({ name, email }: { name?: string | null; email: string }) {
  const initial = (name?.trim() || email).charAt(0).toUpperCase();
  return (
    <span {...stylex.props(s.chip)}>
      <span aria-hidden {...stylex.props(s.chipAvatar)}>
        {initial}
      </span>
      <span {...stylex.props(s.chipEmail)}>{email}</span>
    </span>
  );
}
