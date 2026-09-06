import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useTranslations } from "@kaipu/i18n";

import SignInForm from "@/components/sign-in-form";

function LoginPage() {
  const t = useTranslations("auth");
  return (
    <div className="mx-auto w-full mt-10 max-w-md p-6">
      <SignInForm />
      <div className="mt-4 text-center text-sm text-muted-foreground">
        {t("needAccount")}{" "}
        <Link to="/auth/signup" className="text-primary hover:underline">
          {t("signUp")}
        </Link>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/auth/login")({
  component: LoginPage,
  beforeLoad: async (ctx) => {
    const { isAuthenticated } = ctx.context;
    if (isAuthenticated) {
      throw redirect({ to: "/recordings" });
    }
  },
});
