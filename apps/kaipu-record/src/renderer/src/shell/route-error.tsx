import { isRouteErrorResponse, useNavigate, useRouteError } from "react-router-dom";
import { useTranslations, type Translator } from "@kaipu/i18n";
import styles from "./route-error.module.css";

interface ErrorInfo {
  code?: string;
  title: string;
  detail: string;
}

type Translate = Translator<"routeError">;

function describe(error: unknown, t: Translate): ErrorInfo {
  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      return { code: "404", title: t("notFound"), detail: t("notFoundDetail") };
    }
    return {
      code: String(error.status),
      title: error.statusText || t("requestError"),
      detail: typeof error.data === "string" ? error.data : t("routeError"),
    };
  }
  if (error instanceof Error) {
    return { title: t("unexpected"), detail: error.message };
  }
  return { title: t("unexpected"), detail: t("unknownError") };
}

function ErrorCard({ info, screen }: { info: ErrorInfo; screen?: boolean }): React.JSX.Element {
  const navigate = useNavigate();
  const t = useTranslations("routeError");
  return (
    <div className={screen ? styles.screen : styles.wrap}>
      <div className={styles.box}>
        {info.code && <span className={styles.code}>{info.code}</span>}
        <h1 className={styles.title}>{info.title}</h1>
        <p className={styles.detail}>{info.detail}</p>
        <button type="button" className={styles.btn} onClick={() => navigate("/")}>
          {t("backToRecord")}
        </button>
      </div>
    </div>
  );
}

/**
 * Global router `errorElement`. Catches thrown render/loader errors anywhere in
 * the tree and any unmatched route (404) that isn't handled by a catch-all.
 */
export function RouteErrorBoundary(): React.JSX.Element {
  const error = useRouteError();
  const t = useTranslations("routeError");
  return <ErrorCard info={describe(error, t)} screen />;
}

/** In-shell catch-all (`path: "*"`) for unknown app paths — keeps the sidebar. */
export function NotFound(): React.JSX.Element {
  const t = useTranslations("routeError");
  return <ErrorCard info={{ code: "404", title: t("notFound"), detail: t("notFoundDetailApp") }} />;
}
