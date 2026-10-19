import { Link } from "@tanstack/react-router";
import { useTranslations } from "@kaipu/i18n";

const ITEMS = [
  { to: "/dashboard", key: "navHome", exact: true },
  { to: "/dashboard/profile", key: "navProfile", exact: false },
  { to: "/dashboard/settings", key: "navSettings", exact: false },
  { to: "/dashboard/recordings", key: "navRecordings", exact: false },
] as const;

/** The signed-in hub's own navigation. The header only says "Dashboard"; these are its rooms. */
export function DashboardNav() {
  const t = useTranslations("dashboard");
  return (
    <nav aria-label={t("navLabel")} className="flex flex-wrap gap-1 border-b pb-2">
      {ITEMS.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          activeOptions={{ exact: item.exact }}
          className="text-muted-foreground hover:text-foreground rounded-md px-3 py-1.5 text-sm transition-colors"
          activeProps={{ className: "bg-muted text-foreground", "aria-current": "page" }}
        >
          {t(item.key)}
        </Link>
      ))}
    </nav>
  );
}
