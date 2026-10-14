import { useState, type ReactNode } from "react";
import { useFormatter, useTranslations } from "@kaipu/i18n";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@kaipu/web-ui";
import { authClient } from "@/lib/auth/auth-client";
import { hasPassword, useLinkedAccounts } from "@/hooks/use-linked-accounts";
import { Notice } from "./notice";

const PASSWORD_MIN = 8;

type FieldErrors = Partial<
  Record<"currentPassword" | "newPassword" | "confirmPassword" | "form", string>
>;

function ChangePasswordForm() {
  const t = useTranslations("account");
  const [values, setValues] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  const set = (key: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setValues((v) => ({ ...v, [key]: e.target.value }));
    setDone(false);
  };

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: FieldErrors = {};
    if (!values.currentPassword) next.currentPassword = t("passwordRequired");
    if (values.newPassword.length < PASSWORD_MIN) next.newPassword = t("passwordTooShort");
    if (values.confirmPassword !== values.newPassword) next.confirmPassword = t("passwordMismatch");
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setPending(true);
    // Other sessions are revoked with no checkbox, as the password reset flow does.
    const result = await authClient.changePassword({
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
      revokeOtherSessions: true,
    });
    setPending(false);
    if (result.error) {
      setErrors(
        result.error.code === "INVALID_PASSWORD"
          ? { currentPassword: t("wrongCurrentPassword") }
          : { form: t("changePasswordFailed") },
      );
      return;
    }
    setValues({ currentPassword: "", newPassword: "", confirmPassword: "" });
    setDone(true);
  }

  const field = (id: keyof typeof values, label: string, autoComplete: string): ReactNode => (
    <div className="space-y-2">
      <Label htmlFor={`account-${id}`}>{label}</Label>
      <Input
        id={`account-${id}`}
        type="password"
        value={values[id]}
        onChange={set(id)}
        autoComplete={autoComplete}
        aria-invalid={errors[id] ? true : undefined}
        aria-describedby={errors[id] ? `account-${id}-error` : undefined}
      />
      {errors[id] && (
        <p id={`account-${id}-error`} role="alert" className="text-destructive text-sm">
          {errors[id]}
        </p>
      )}
    </div>
  );

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
      <h3 className="font-medium">{t("changePassword")}</h3>
      {field("currentPassword", t("currentPassword"), "current-password")}
      {field("newPassword", t("newPassword"), "new-password")}
      {field("confirmPassword", t("confirmPassword"), "new-password")}
      <p className="text-muted-foreground text-sm">{t("otherSessionsNote")}</p>
      {errors.form && (
        <p role="alert" className="text-destructive text-sm">
          {errors.form}
        </p>
      )}
      {done && (
        <p role="status" className="text-sm">
          {t("passwordChanged")}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? t("changePasswordSaving") : t("changePasswordSubmit")}
      </Button>
    </form>
  );
}

export function SignInMethodsSection({
  googleControls,
}: {
  /** Connect / disconnect Google and "set a password": owned by NIW2-219, hidden until it ships. */
  googleControls?: ReactNode;
}) {
  const t = useTranslations("account");
  const format = useFormatter();
  const accounts = useLinkedAccounts();

  const label = (providerId: string): string => {
    if (providerId === "credential") return t("methodPassword");
    if (providerId === "google") return t("methodGoogle");
    return t("methodOther", { provider: providerId });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("signInTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {accounts.isPending && (
          <p className="text-muted-foreground text-sm">{t("methodsLoading")}</p>
        )}
        {accounts.isError && <Notice tone="destructive" title={t("methodsFailed")} />}
        {accounts.data && (
          <ul className="space-y-2">
            {accounts.data.map((account) => (
              <li key={account.id} className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{label(account.providerId)}</span>
                <span className="text-muted-foreground text-sm">
                  {t("linkedOn", {
                    date: format.dateTime(new Date(account.createdAt), { dateStyle: "medium" }),
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
        {accounts.data && hasPassword(accounts.data) && <ChangePasswordForm />}
        {googleControls}
      </CardContent>
    </Card>
  );
}
