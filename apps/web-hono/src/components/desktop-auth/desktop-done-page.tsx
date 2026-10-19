import { useEffect, useState } from "react";
import { useTranslations } from "@kaipu/i18n";
import { Button } from "@kaipu/web-ui";

import { desktopAuthClient } from "@/lib/auth/desktop-auth-client";
import { desktopCallbackUrl } from "@/lib/desktop-auth";

/** How often and how long to look for the code cookie (the plugin's own defaults). */
export const CODE_POLL_INTERVAL_MS = 100;
export const CODE_WAIT_MS = 10_000;
/** How long "Returning to Kaipu…" stays before the fallback offers to retry or copy the code. */
export const FALLBACK_AFTER_MS = 4_000;

type Phase =
  | { kind: "waiting" }
  | { kind: "returning"; code: string }
  | { kind: "fallback"; code: string }
  | { kind: "no-code" };

/**
 * `/auth/desktop/done` (NIW2-471). The sign-in left a readable `better-auth.kaipu-desktop` cookie;
 * this page opens `kaipu://auth/callback#token=<cookie value>` through `ensureElectronRedirect`.
 *
 * `ensureElectronRedirect` deletes the cookie as it redirects, so the page reads the value first
 * and keeps it: when the deep link cannot open the app (blocked prompt, unpackaged dev build), the
 * fallback offers the same link again and the value to paste. That value — base64url JSON of
 * `{ identifier, state }` — is what the desktop's `authenticate({ token })` decodes. The raw
 * 32-character code alone would not work.
 */
export function DesktopDonePage() {
  const t = useTranslations("desktopAuth");
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
      <Card>
        <h1 className="mb-4 text-center text-2xl font-bold">{t("noCodeTitle")}</h1>
        <p className="text-center text-sm text-muted-foreground">{t("noCodeBody")}</p>
      </Card>
    );
  }

  if (phase.kind === "fallback") return <Fallback code={phase.code} />;

  return (
    <Card>
      <h1 className="mb-4 text-center text-2xl font-bold" aria-live="polite">
        {t("returningTitle")}
      </h1>
      <p className="text-center text-sm text-muted-foreground">{t("returningBody")}</p>
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full mt-10 max-w-md p-6">{children}</div>;
}

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
    <Card>
      <h1 className="mb-4 text-center text-2xl font-bold">{t("fallbackTitle")}</h1>
      <p className="mb-6 text-center text-sm text-muted-foreground">{t("fallbackBody")}</p>
      <div className="space-y-3">
        <Button
          className="w-full"
          onClick={() => {
            window.location.href = desktopCallbackUrl(code);
          }}
        >
          {t("openAgain")}
        </Button>
        <Button variant="outline" className="w-full" onClick={() => void copyCode()}>
          {t("copyCode")}
        </Button>
      </div>
      <label className="mt-6 block text-sm font-medium" htmlFor="desktop-sign-in-code">
        {t("codeLabel")}
      </label>
      <textarea
        id="desktop-sign-in-code"
        readOnly
        rows={3}
        value={code}
        onFocus={(e) => e.currentTarget.select()}
        className="mt-2 w-full resize-none rounded-md border bg-muted p-2 font-mono text-xs break-all"
      />
      <p className="mt-2 text-xs text-muted-foreground">{t("codeNote")}</p>
      <p aria-live="polite" className="mt-4 text-center text-sm">
        {copy === "copied" ? t("copied") : copy === "failed" ? t("copyFailed") : ""}
      </p>
      <p className="mt-6 text-center text-xs text-muted-foreground">{t("closeTab")}</p>
    </Card>
  );
}
