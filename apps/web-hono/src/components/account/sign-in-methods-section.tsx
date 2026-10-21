import { useState, type ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { KeyRound, Mail, TriangleAlert } from "lucide-react";
import { useFormatter, useTranslations } from "@kaipu/i18n";
import { authClient } from "@/lib/auth/auth-client";
import { hasPassword, useLinkedAccounts } from "@/hooks/use-linked-accounts";
import { kl } from "../dashboard/dashboard.stylex";
import {
  Button,
  Card,
  Field,
  FieldPair,
  FormMessage,
  FormPanel,
  GoogleMark,
  Notice,
} from "@/components/dashboard/ui";

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
    <Field
      id={`account-${id}`}
      label={label}
      type="password"
      value={values[id]}
      onChange={set(id)}
      autoComplete={autoComplete}
      error={errors[id]}
    />
  );

  return (
    <FormPanel title={t("changePassword")} intro={t("otherSessionsNote")}>
      <form onSubmit={(e) => void submit(e)} noValidate>
        {field("currentPassword", t("currentPassword"), "current-password")}
        <FieldPair>
          {field("newPassword", t("newPassword"), "new-password")}
          {field("confirmPassword", t("confirmPassword"), "new-password")}
        </FieldPair>
        {errors.form && <FormMessage tone="error">{errors.form}</FormMessage>}
        {done && <FormMessage tone="ok">{t("passwordChanged")}</FormMessage>}
        <Button type="submit" variant="pink" size="sm" disabled={pending}>
          {pending ? t("changePasswordSaving") : t("changePasswordSubmit")}
        </Button>
      </form>
    </FormPanel>
  );
}

function MethodIcon({ providerId }: { providerId: string }) {
  if (providerId === "google") return <GoogleMark />;
  if (providerId === "credential") return <Mail size={16} aria-hidden />;
  return <KeyRound size={16} aria-hidden />;
}

export function SignInMethodsSection({
  googleControls,
}: {
  /** Connect / disconnect Google and "set a password" (NIW2-219). */
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
    <Card title={t("signInTitle")}>
      {accounts.isPending && <p {...stylex.props(s.muted)}>{t("methodsLoading")}</p>}
      {accounts.isError && (
        <Notice
          tone="danger"
          role="alert"
          icon={<TriangleAlert size={18} />}
          title={t("methodsFailed")}
        />
      )}
      {accounts.data && (
        <ul {...stylex.props(s.list)}>
          {accounts.data.map((account) => (
            <li key={account.id} {...stylex.props(s.method)}>
              <span aria-hidden {...stylex.props(s.methodIcon)}>
                <MethodIcon providerId={account.providerId} />
              </span>
              <div {...stylex.props(s.methodText)}>
                <p {...stylex.props(s.methodTitle)}>{label(account.providerId)}</p>
                <p {...stylex.props(s.methodSub)}>
                  {t("linkedOn", {
                    date: format.dateTime(new Date(account.createdAt), { dateStyle: "medium" }),
                  })}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {accounts.data && hasPassword(accounts.data) && <ChangePasswordForm />}
      {googleControls}
    </Card>
  );
}

const s = stylex.create({
  muted: { margin: 0, fontSize: "14px", color: kl.dim },
  list: { margin: 0, padding: 0, listStyle: "none" },
  method: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "12px",
    paddingBlock: "13px",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: kl.bd,
  },
  methodIcon: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: "36px",
    height: "36px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: kl.bd,
    borderRadius: "10px",
    backgroundColor: kl.bg2,
    color: kl.dim,
  },
  methodText: { flex: "1", minWidth: 0 },
  methodTitle: { margin: 0, fontSize: "14.5px", fontWeight: 600, color: kl.tx },
  methodSub: {
    margin: 0,
    marginTop: "3px",
    fontFamily: kl.fontMono,
    fontSize: "11.5px",
    color: kl.faint,
  },
});
