import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import z from "zod";

import { SignupLegalNotice } from "@/components/legal/signup-legal-notice";
import CloudPromotion from "@/components/cloud-promotion";
import { GoogleButton } from "@/components/google-button";
import { authClient } from "@/lib/auth/auth-client";
import { resolvePostSignInPath } from "@/lib/post-sign-in";

import { Button, Input, Label } from "@kaipu/web-ui";
import { useTranslations } from "@kaipu/i18n";

export default function SignUpForm({ redirectTo }: { redirectTo?: string }) {
  const router = useRouter();
  const t = useTranslations("auth");

  const form = useForm({
    defaultValues: {
      email: "",
      password: "",
      name: "",
    },
    onSubmit: async ({ value }) => {
      await authClient.signUp.email(
        {
          email: value.email,
          password: value.password,
          name: value.name,
        },
        {
          onSuccess: async () => {
            await router.invalidate();
            router.history.push(resolvePostSignInPath({ redirect: redirectTo }));
            toast.success(t("signUpSuccess"));
          },
          onError: (error) => {
            toast.error(error.error.message || error.error.statusText);
          },
        },
      );
    },
    validators: {
      onSubmit: z.object({
        name: z.string().min(2, t("nameMin")),
        email: z.email(t("invalidEmail")),
        password: z.string().min(8, t("passwordMin")),
      }),
    },
  });

  return (
    <>
      <h1 className="mb-6 text-center text-3xl font-bold">{t("createAccount")}</h1>

      <CloudPromotion />

      <GoogleButton mode="sign-up" redirectTo={redirectTo} />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
        className="space-y-4"
      >
        <div>
          <form.Field name="name">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>{t("name")}</Label>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                {field.state.meta.errors.map((error) => (
                  <p key={error?.message} className="text-red-500">
                    {error?.message}
                  </p>
                ))}
              </div>
            )}
          </form.Field>
        </div>

        <div>
          <form.Field name="email">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>{t("email")}</Label>
                <Input
                  id={field.name}
                  name={field.name}
                  type="email"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                {field.state.meta.errors.map((error) => (
                  <p key={error?.message} className="text-red-500">
                    {error?.message}
                  </p>
                ))}
              </div>
            )}
          </form.Field>
        </div>

        <div>
          <form.Field name="password">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>{t("password")}</Label>
                <Input
                  id={field.name}
                  name={field.name}
                  type="password"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                {field.state.meta.errors.map((error) => (
                  <p key={error?.message} className="text-red-500">
                    {error?.message}
                  </p>
                ))}
              </div>
            )}
          </form.Field>
        </div>

        <SignupLegalNotice />

        <form.Subscribe>
          {(state) => (
            <Button
              type="submit"
              className="w-full"
              disabled={!state.canSubmit || state.isSubmitting}
            >
              {state.isSubmitting ? t("submitting") : t("signUp")}
            </Button>
          )}
        </form.Subscribe>
      </form>
    </>
  );
}
