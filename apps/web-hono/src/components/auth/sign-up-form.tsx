import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { useTranslations } from "@kaipu/i18n";

import { authClient } from "@/lib/auth/auth-client";
import { desktopDonePath, type DesktopAuthQuery } from "@/lib/desktop-auth";
import {
  ErrorBanner,
  FieldHint,
  PasswordField,
  PrimaryButton,
  QuietButton,
  TextField,
} from "./auth-ui";
import { isEmail, MIN_NAME, MIN_PASSWORD } from "./validation";

export interface SignUpValues {
  name: string;
  email: string;
}

/**
 * The email half of the "Create account" tab.
 *
 * Signing up signs the visitor in straight away, unverified; the verification link only unlocks
 * Kaipu Cloud and can be opened later in any browser (`emailVerification.sendOnSignUp` on the
 * API). So nothing waits for the link:
 *
 * - on the web, `onSignedUp` swaps the form for "Check your email" with a way into the library;
 * - from the desktop (`desktop` set, NIW2-471), the request carries the app's query, the electron
 *   plugin mints the code with the new session, and the visitor goes straight to the page that
 *   hands it to the app — told there that a link is on its way.
 */
export default function SignUpForm({
  desktop,
  defaultValues,
  onBack,
  onSignedUp,
}: {
  desktop?: DesktopAuthQuery;
  defaultValues?: Partial<SignUpValues>;
  onBack: () => void;
  onSignedUp: (email: string) => void;
}) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [name, setName] = useState(defaultValues?.name ?? "");
  const [email, setEmail] = useState(defaultValues?.email ?? "");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string }>({});
  const [failure, setFailure] = useState<"network" | "other" | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = {
      name: name.trim().length >= MIN_NAME ? undefined : t("nameMin"),
      email: isEmail(email) ? undefined : t("invalidEmail"),
      password: password.length >= MIN_PASSWORD ? undefined : t("passwordMin"),
    };
    setErrors(next);
    if (next.name || next.email || next.password) return;

    setPending(true);
    setFailure(null);
    const address = email.trim();
    try {
      const { error } = await authClient.signUp.email(
        { name: name.trim(), email: address, password },
        { query: desktop ? { ...desktop } : undefined },
      );
      if (error) {
        setPending(false);
        setFailure("other");
        return;
      }
    } catch {
      setPending(false);
      setFailure("network");
      return;
    }
    if (desktop) {
      router.history.push(desktopDonePath(desktop, { checkEmail: true }));
      return;
    }
    // No router.invalidate() here: /auth/signup sends a signed-in visitor away, and this one has to
    // stay for "Check your email". Its way forward is a full page load, which reads the session.
    onSignedUp(address);
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)}>
      <TextField
        first
        label={t("name")}
        name="name"
        autoComplete="name"
        placeholder={t("namePlaceholder")}
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={errors.name}
        autoFocus={!defaultValues?.email}
      />
      <TextField
        label={t("email")}
        type="email"
        name="email"
        autoComplete="email"
        inputMode="email"
        placeholder={t("emailPlaceholder")}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={errors.email}
      />
      <PasswordField
        label={t("password")}
        name="password"
        autoComplete="new-password"
        placeholder={t("passwordPlaceholderSignUp")}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={errors.password}
        aside={<FieldHint>{t("passwordHint")}</FieldHint>}
        autoFocus={!!defaultValues?.email}
      />
      {failure ? (
        <ErrorBanner>{failure === "network" ? t("errorNetwork") : t("signUpFailed")}</ErrorBanner>
      ) : null}
      <PrimaryButton type="submit" disabled={pending}>
        {pending ? t("submitting") : t("signUp")}
      </PrimaryButton>
      <QuietButton back block onClick={onBack}>
        {t("backToGoogle")}
      </QuietButton>
    </form>
  );
}
