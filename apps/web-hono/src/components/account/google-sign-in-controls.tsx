import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "@kaipu/i18n";
import { Button, Input, Label } from "@kaipu/web-ui";
import { GoogleMark } from "@/components/google-button";
import { hasPassword, linkedAccountsKey, useLinkedAccounts } from "@/hooks/use-linked-accounts";
import { authClient } from "@/lib/auth/auth-client";
import { googleStartErrorKey } from "@/lib/google-auth";
import { client } from "@/lib/orpc-client";

const PASSWORD_MIN = 8;
const PROFILE_PATH = "/dashboard/profile";

/** FR10: a Google-only user adds a password, so the desktop app can sign them in. The session stays. */
function SetPasswordForm({ onSaved }: { onSaved: () => Promise<void> }) {
  const t = useTranslations("account");
  const [values, setValues] = useState({ newPassword: "", confirmPassword: "" });
  const [errors, setErrors] = useState<
    Partial<Record<"newPassword" | "confirmPassword" | "form", string>>
  >({});
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: typeof errors = {};
    if (values.newPassword.length < PASSWORD_MIN) next.newPassword = t("passwordTooShort");
    if (values.confirmPassword !== values.newPassword) next.confirmPassword = t("passwordMismatch");
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setPending(true);
    try {
      await client.me.setPassword({ newPassword: values.newPassword });
      setValues({ newPassword: "", confirmPassword: "" });
      await onSaved();
    } catch (err) {
      const status = (err as { status?: number }).status;
      setErrors({ form: status === 409 ? t("setPasswordExists") : t("setPasswordFailed") });
    } finally {
      setPending(false);
    }
  }

  const field = (id: "newPassword" | "confirmPassword", label: string) => (
    <div className="space-y-2">
      <Label htmlFor={`set-${id}`}>{label}</Label>
      <Input
        id={`set-${id}`}
        type="password"
        autoComplete="new-password"
        value={values[id]}
        onChange={(e) => setValues((v) => ({ ...v, [id]: e.target.value }))}
        aria-invalid={errors[id] ? true : undefined}
        aria-describedby={errors[id] ? `set-${id}-error` : undefined}
      />
      {errors[id] && (
        <p id={`set-${id}-error`} role="alert" className="text-destructive text-sm">
          {errors[id]}
        </p>
      )}
    </div>
  );

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
      <h3 className="font-medium">{t("setPasswordTitle")}</h3>
      <p className="text-muted-foreground text-sm">{t("setPasswordIntro")}</p>
      {field("newPassword", t("newPassword"))}
      {field("confirmPassword", t("confirmPassword"))}
      {errors.form && (
        <p role="alert" className="text-destructive text-sm">
          {errors.form}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? t("setPasswordSaving") : t("setPasswordSubmit")}
      </Button>
    </form>
  );
}

/**
 * Google rows of "Sign-in methods" (NIW2-219): connect (linkSocial), disconnect (never the last
 * method; the API refuses it too) and "Set a password" for Google-only accounts. Rendered in
 * SignInMethodsSection's `googleControls` slot; shares its accounts query.
 */
export function GoogleSignInControls() {
  const t = useTranslations("account");
  const tAuth = useTranslations("auth");
  const queryClient = useQueryClient();
  const accounts = useLinkedAccounts();
  const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);
  const [message, setMessage] = useState<{ tone: "status" | "alert"; text: string } | null>(null);

  if (!accounts.data) return null;
  const googleAccount = accounts.data.find((a) => a.providerId === "google");
  const hasGoogle = googleAccount !== undefined;
  const withPassword = hasPassword(accounts.data);
  const refresh = () => queryClient.invalidateQueries({ queryKey: linkedAccountsKey() });

  async function connect() {
    setBusy("connect");
    setMessage(null);
    const result = await authClient.linkSocial({
      provider: "google",
      callbackURL: PROFILE_PATH,
      // Better Auth appends `?error=<code>`; the profile route shows it.
      errorCallbackURL: PROFILE_PATH,
    });
    // On success the browser is on its way to Google.
    if (result?.error) {
      setBusy(null);
      setMessage({
        tone: "alert",
        text: tAuth(
          result.error.code === "PROVIDER_NOT_FOUND"
            ? googleStartErrorKey(result.error)
            : "oauthErrorUnableToLink",
        ),
      });
    }
  }

  async function disconnect() {
    if (!googleAccount) return;
    setBusy("disconnect");
    setMessage(null);
    // Better Auth 1.7 selects the row by its own account id (from listAccounts), not provider.
    const result = await authClient.unlinkAccount({ accountId: googleAccount.id });
    setBusy(null);
    if (result.error) {
      // FAILED_TO_UNLINK_LAST_ACCOUNT: the server's FR9 refusal. 403 is SESSION_NOT_FRESH:
      // unlinking needs a session younger than `freshAge` (one day, from sign-in).
      const text =
        result.error.code === "FAILED_TO_UNLINK_LAST_ACCOUNT"
          ? t("googleLastMethod")
          : result.error.status === 403
            ? t("googleNotFresh")
            : t("googleDisconnectFailed");
      setMessage({ tone: "alert", text });
      return;
    }
    setMessage({ tone: "status", text: t("googleDisconnected") });
    await refresh();
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {hasGoogle ? (
          <>
            <Button
              type="button"
              variant="outline"
              // FR9: never the last method. The server refuses it as well.
              disabled={!withPassword || busy !== null}
              onClick={() => void disconnect()}
            >
              {busy === "disconnect" ? t("googleDisconnecting") : t("googleDisconnect")}
            </Button>
            {!withPassword && (
              <p className="text-muted-foreground text-sm">{t("googleLastMethod")}</p>
            )}
          </>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            disabled={busy !== null}
            onClick={() => void connect()}
          >
            <GoogleMark />
            {busy === "connect" ? t("googleConnecting") : t("googleConnect")}
          </Button>
        )}
      </div>
      {message && (
        <p
          role={message.tone}
          className={message.tone === "alert" ? "text-destructive text-sm" : "text-sm"}
        >
          {message.text}
        </p>
      )}
      {!withPassword && (
        <SetPasswordForm
          onSaved={async () => {
            // The list refresh swaps this form for "Change password"; the message stays here.
            setMessage({ tone: "status", text: t("setPasswordDone") });
            await refresh();
          }}
        />
      )}
    </div>
  );
}
