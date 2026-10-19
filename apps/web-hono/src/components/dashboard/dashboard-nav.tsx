import { Link } from "@tanstack/react-router";
import { useTranslations } from "@kaipu/i18n";

const ITEMS = [
  { to: "/dashboard", key: "navHome", exact: true },
  { to: "/dashboard/profile", key: "navProfile", exact: false },
  { to: "/dashboard/settings", key: "navSettings", exact: false },
  { to: "/dashboard/recordings", key: "navRecordings", exact: false },
] as const;

/** Sub-navigation of the signed-in hub. The open page is marked with `aria-current="page"`. */
export function DashboardNav() {
  const t = useTranslations("dashboard");
  return (
    <nav aria-label={t("navLabel")} className="border-b">
      <ul className="container mx-auto flex max-w-4xl gap-1 overflow-x-auto px-4">
        {ITEMS.map((item) => (
          <li key={item.to}>
            <Link
              to={item.to}
              activeOptions={{ exact: item.exact }}
              className="text-muted-foreground hover:text-foreground block border-b-2 border-transparent px-3 py-3 text-sm whitespace-nowrap transition-colors"
              activeProps={{ className: "!border-primary !text-foreground font-medium" }}
            >
              {t(item.key)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
