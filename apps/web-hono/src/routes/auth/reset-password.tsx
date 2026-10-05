import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useTranslations } from "@kaipu/i18n";
import { Button, Input, Label } from "@kaipu/web-ui";

import { authClient } from "@/lib/auth/auth-client";
import { NOINDEX } from "@/lib/seo";

function ResetPasswordPage() {
  const t = useTranslations("auth");
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!token) {
    return (
      <div className="mx-auto w-full mt-10 max-w-md p-6">
        <h1 className="mb-6 text-center text-3xl font-bold">{t("resetTitle")}</h1>
        <p className="text-center text-sm text-muted-foreground">{t("resetMissingToken")}</p>
        <div className="mt-4 text-center text-sm text-muted-foreground">
          <Link to="/auth/forgot-password" className="text-primary hover:underline">
            {t("forgotTitle")}
          </Link>
        </div>
      </div>
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const newPassword = String(new FormData(event.currentTarget).get("password") ?? "");
    setPending(true);
    setError(null);
    const result = await authClient.resetPassword({ newPassword, token: token! });
    setPending(false);
    if (result.error) {
      setError(t("resetInvalid"));
      return;
    }
    toast.success(t("resetSuccess"));
    // Success: all sessions were revoked server-side; go sign in again.
    void navigate({ to: "/auth/login" });
  }

  return (
    <div className="mx-auto w-full mt-10 max-w-md p-6">
      <h1 className="mb-6 text-center text-3xl font-bold">{t("resetTitle")}</h1>
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">{t("password")}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? t("submitting") : t("resetSubmit")}
        </Button>
      </form>
      {error ? (
        <p role="alert" className="mt-4 text-center text-sm text-red-500">
          {error}{" "}
          <Link to="/auth/forgot-password" className="text-primary hover:underline">
            {t("forgotTitle")}
          </Link>
        </p>
      ) : null}
    </div>
  );
}

export const Route = createFileRoute("/auth/reset-password")({
  head: () => NOINDEX,
  // Hand-written rather than a zod schema: route options stay in the entry chunk,
  // so a zod import here would ship zod to every page, public ones included.
  validateSearch: (search: Record<string, unknown>): { token?: string } => ({
    token: typeof search.token === "string" ? search.token : undefined,
  }),
  component: ResetPasswordPage,
});
