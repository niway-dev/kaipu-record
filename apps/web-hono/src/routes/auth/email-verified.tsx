import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslations } from "@kaipu/i18n";
import { Button, Input, Label } from "@kaipu/web-ui";

import { authClient } from "@/lib/auth/auth-client";
import { NOINDEX } from "@/lib/seo";

function EmailVerifiedPage() {
  const t = useTranslations("auth");
  const { error } = Route.useSearch();
  const [resent, setResent] = useState(false);
  const [pending, setPending] = useState(false);

  if (!error) {
    return (
      <div className="mx-auto w-full mt-10 max-w-md p-6">
        <h1 className="mb-6 text-center text-3xl font-bold">{t("verifiedTitle")}</h1>
        <p className="text-center text-sm text-muted-foreground">{t("verifiedBody")}</p>
        <div className="mt-4 text-center text-sm text-muted-foreground">
          <Link to="/auth/login" className="text-primary hover:underline">
            {t("signIn")}
          </Link>
        </div>
      </div>
    );
  }

  async function resend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    setPending(true);
    await authClient
      .sendVerificationEmail({ email, callbackURL: "/auth/email-verified" })
      .catch(() => undefined);
    setPending(false);
    setResent(true);
  }

  return (
    <div className="mx-auto w-full mt-10 max-w-md p-6">
      <h1 className="mb-6 text-center text-3xl font-bold">{t("verifiedError")}</h1>
      {resent ? (
        <p className="text-center text-sm text-muted-foreground">{t("verifiedResendSent")}</p>
      ) : (
        <form onSubmit={(e) => void resend(e)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{t("email")}</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? t("submitting") : t("verifiedResend")}
          </Button>
        </form>
      )}
    </div>
  );
}

export const Route = createFileRoute("/auth/email-verified")({
  head: () => NOINDEX,
  // Hand-written rather than a zod schema: route options stay in the entry chunk,
  // so a zod import here would ship zod to every page, public ones included.
  validateSearch: (search: Record<string, unknown>): { error?: string } => ({
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  component: EmailVerifiedPage,
});
