import { useEffect, useState } from "react";
import * as stylex from "@stylexjs/stylex";
import { useTranslations } from "@kaipu/i18n";
import { KaipuLogo } from "@kaipu/brand";

// Relative on purpose: the StyleX compiler resolves `.stylex` imports itself and knows no `@/`.
import { kl } from "../auth/auth.stylex";
import {
  AccountChip,
  GhostButton,
  HeroBody,
  HeroHeader,
  InfoPanel,
  PrimaryButton,
  SmallPrint,
  Strong,
} from "@/components/auth/auth-ui";
import { desktopAuthClient } from "@/lib/auth/desktop-auth-client";
import type { AuthSession } from "@/lib/auth/types";
import { desktopCallbackUrl } from "@/lib/desktop-auth";

/** How often and how long to look for the code cookie (the plugin's own defaults). */
export const CODE_POLL_INTERVAL_MS = 100;
export const CODE_WAIT_MS = 10_000;
/** How long before the paste-the-code fallback appears under "Open Kaipu Record". */
export const FALLBACK_AFTER_MS = 4_000;

type Phase =
  | { kind: "waiting" }
  | { kind: "returning"; code: string }
  | { kind: "fallback"; code: string }
  | { kind: "no-code" };

/**
 * `/auth/desktop/done` (NIW2-471), the design's "You're signed in". The sign-in left a readable
 * `better-auth.kaipu-desktop` cookie; this page opens `kaipu://auth/callback#token=<cookie value>`
 * through `ensureElectronRedirect`.
 *
 * `ensureElectronRedirect` deletes the cookie as it redirects, so the page reads the value first
 * and keeps it: "Open Kaipu Record" opens the same link again, and when the deep link cannot open
 * the app (blocked prompt, unpackaged dev build) the fallback below it offers the value to paste.
 * That value — base64url JSON of `{ identifier, state }` — is what the desktop's
 * `authenticate({ token })` decodes. The raw 32-character code alone would not work.
 *
 * `checkEmail` is set after an email sign-up: the page then also says a verification link is on its
 * way. It never holds the return to the app back — verifying only unlocks Kaipu Cloud.
 */
export function DesktopDonePage({
  session,
  checkEmail,
}: {
  session?: AuthSession | null;
  checkEmail?: boolean;
}) {
  const t = useTranslations("desktopAuth");
  const tAuth = useTranslations("auth");
  const [phase, setPhase] = useState<Phase>({ kind: "waiting" });

  useEffect(() => {
    const started = Date.now();
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    const poll = setInterval(() => {
      const code = desktopAuthClient.electron.getAuthorizationCode();
      if (code) {
        clearInterval(poll);
        setPhase({ kind: "returning", code });
        desktopAuthClient.ensureElectronRedirect({
          timeout: CODE_WAIT_MS,
          interval: CODE_POLL_INTERVAL_MS,
        });
        fallbackTimer = setTimeout(() => setPhase({ kind: "fallback", code }), FALLBACK_AFTER_MS);
      } else if (Date.now() - started >= CODE_WAIT_MS) {
        clearInterval(poll);
        setPhase({ kind: "no-code" });
      }
    }, CODE_POLL_INTERVAL_MS);
    return () => {
      clearInterval(poll);
      if (fallbackTimer) clearTimeout(fallbackTimer);
    };
  }, []);

  if (phase.kind === "no-code") {
    return (
      <HeroHeader use="product" title={t("noCodeTitle")}>
        <HeroBody>{t("noCodeBody")}</HeroBody>
      </HeroHeader>
    );
  }

  if (phase.kind === "waiting") {
    return (
      <div aria-live="polite">
        <HeroHeader use="done" size={92} title={t("returningTitle")}>
          <HeroBody>{t("returningBody")}</HeroBody>
        </HeroHeader>
      </div>
    );
  }

  const email = session?.user.email;
  return (
    <div>
      <HeroHeader use="done" size={92} float title={t("doneTitle")}>
        {email ? <AccountChip name={session?.user.name} email={email} /> : null}
        {checkEmail ? (
          <InfoPanel>
            <Strong>{tAuth("checkEmailTitle")}</Strong>{" "}
            {email
              ? tAuth.rich("checkEmailBody", { email, b: (chunks) => <Strong>{chunks}</Strong> })
              : tAuth("checkEmailLater")}
          </InfoPanel>
        ) : null}
        <HeroBody>{t("doneBody")}</HeroBody>
        <PrimaryButton
          large
          arrow={false}
          icon={<KaipuLogo use="product" size={22} />}
          onClick={() => {
            window.location.href = desktopCallbackUrl(phase.code);
          }}
        >
          {t("openKaipuRecord")}
        </PrimaryButton>
        <SmallPrint>{t("doneCloseTab")}</SmallPrint>
      </HeroHeader>
      {phase.kind === "fallback" ? <Fallback code={phase.code} /> : null}
    </div>
  );
}

/** The paste-the-code fallback, as it works since #333: copy the value, or select it by hand. */
function Fallback({ code }: { code: string }) {
  const t = useTranslations("desktopAuth");
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  }

  return (
    <section aria-labelledby="desktop-fallback-title" {...stylex.props(s.fallback)}>
      <h2 id="desktop-fallback-title" {...stylex.props(s.fallbackTitle)}>
        {t("fallbackTitle")}
      </h2>
      <p {...stylex.props(s.text)}>{t("fallbackBodyCode")}</p>
      <GhostButton onClick={() => void copyCode()}>{t("copyCode")}</GhostButton>
      <label htmlFor="desktop-sign-in-code" {...stylex.props(s.label)}>
        {t("codeLabel")}
      </label>
      <textarea
        id="desktop-sign-in-code"
        readOnly
        rows={3}
        value={code}
        onFocus={(e) => e.currentTarget.select()}
        {...stylex.props(s.code)}
      />
      <p {...stylex.props(s.text)}>{t("codeNote")}</p>
      <p aria-live="polite" {...stylex.props(s.status)}>
        {copy === "copied" ? t("copied") : copy === "failed" ? t("copyFailed") : ""}
      </p>
    </section>
  );
}

const s = stylex.create({
  fallback: {
    marginTop: "28px",
    paddingTop: "20px",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: kl.bd,
  },
  fallbackTitle: { margin: 0, fontSize: "14px", fontWeight: 600, color: kl.tx },
  text: { margin: "6px 0 12px", fontSize: "12.5px", lineHeight: 1.5, color: kl.faint },
  label: {
    display: "block",
    marginTop: "14px",
    fontSize: "12.5px",
    fontWeight: 600,
    color: kl.dim,
  },
  code: {
    boxSizing: "border-box",
    width: "100%",
    marginTop: "6px",
    padding: "8px",
    resize: "none",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: kl.bd2,
    borderRadius: "8px",
    backgroundColor: kl.card,
    color: kl.dim,
    fontFamily: kl.fontMono,
    fontSize: "11px",
    wordBreak: "break-all",
  },
  status: { margin: 0, minHeight: "1.2em", fontSize: "12.5px", color: kl.dim },
});
