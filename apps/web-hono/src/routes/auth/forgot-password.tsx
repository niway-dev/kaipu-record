import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslations } from "@kaipu/i18n";
import { Button, Input, Label } from "@kaipu/web-ui";

import { authClient } from "@/lib/auth/auth-client";
import { NOINDEX } from "@/lib/seo";

function ForgotPasswordPage() {
  const t = useTranslations("auth");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    setPending(true);
    // Always report success — never reveal whether the account exists.
    await authClient
      .requestPasswordReset({ email, redirectTo: "/auth/reset-password" })
      .catch(() => undefined);
    setPending(false);
    setSent(true);
  }

  return (
    <div className="mx-auto w-full mt-10 max-w-md p-6">
      <h1 className="mb-6 text-center text-3xl font-bold">{t("forgotTitle")}</h1>
      {sent ? (
        <p className="text-center text-sm text-muted-foreground">{t("forgotSent")}</p>
      ) : (
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("forgotBody")}</p>
          <div className="space-y-2">
            <Label htmlFor="email">{t("email")}</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? t("submitting") : t("forgotSubmit")}
          </Button>
        </form>
      )}
      <div className="mt-4 text-center text-sm text-muted-foreground">
        <Link to="/auth/login" className="text-primary hover:underline">
          {t("signIn")}
        </Link>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/auth/forgot-password")({
  head: () => NOINDEX,
  component: ForgotPasswordPage,
});
