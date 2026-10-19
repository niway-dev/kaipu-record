import { Alert, AlertDescription } from "@kaipu/web-ui";
import { useTranslations } from "@kaipu/i18n";
import { oauthErrorKey } from "@/lib/google-auth";

/** The `?error=` Better Auth sends back after a Google sign-in or link, as copy (FR12). */
export function OAuthErrorAlert({ code }: { code?: string }) {
  const t = useTranslations("auth");
  if (!code) return null;
  return (
    <Alert variant="destructive" role="alert" className="mb-6">
      <AlertDescription>{t(oauthErrorKey(code))}</AlertDescription>
    </Alert>
  );
}
