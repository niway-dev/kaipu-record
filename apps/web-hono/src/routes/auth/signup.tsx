import { NOINDEX } from "@/lib/seo";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useTranslations } from "@kaipu/i18n";

import SignUpForm from "@/components/sign-up-form";

export const Route = createFileRoute("/auth/signup")({
  head: () => NOINDEX,
  component: SignUpPage,
  beforeLoad: async (ctx) => {
    const { isAuthenticated } = ctx.context;
    if (isAuthenticated) {
      throw redirect({ to: "/recordings" });
    }
  },
});

function SignUpPage() {
  const t = useTranslations("auth");
  return (
    <div className="mx-auto w-full mt-10 max-w-md p-6">
      <SignUpForm />
      <div className="mt-4 text-center text-sm text-muted-foreground">
        {t("haveAccount")}{" "}
        <Link to="/auth/login" className="text-primary hover:underline">
          {t("signIn")}
        </Link>
      </div>
    </div>
  );
}
