import { isRouteErrorResponse, useNavigate, useRouteError } from "react-router-dom";
import styles from "./route-error.module.css";

interface ErrorInfo {
  code?: string;
  title: string;
  detail: string;
}

function describe(error: unknown): ErrorInfo {
  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      return {
        code: "404",
        title: "Page not found",
        detail: "This page doesn’t exist or has moved.",
      };
    }
    return {
      code: String(error.status),
      title: error.statusText || "Request error",
      detail:
        typeof error.data === "string" ? error.data : "Something went wrong handling this route.",
    };
  }
  if (error instanceof Error) {
    return { title: "Unexpected error", detail: error.message };
  }
  return { title: "Unexpected error", detail: "An unknown error occurred." };
}

function ErrorCard({ info, screen }: { info: ErrorInfo; screen?: boolean }): React.JSX.Element {
  const navigate = useNavigate();
  return (
    <div className={screen ? styles.screen : styles.wrap}>
      <div className={styles.box}>
        {info.code && <span className={styles.code}>{info.code}</span>}
        <h1 className={styles.title}>{info.title}</h1>
        <p className={styles.detail}>{info.detail}</p>
        <button type="button" className={styles.btn} onClick={() => navigate("/")}>
          Back to Record
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
  return <ErrorCard info={describe(error)} screen />;
}

/** In-shell catch-all (`path: "*"`) for unknown app paths — keeps the sidebar. */
export function NotFound(): React.JSX.Element {
  return (
    <ErrorCard
      info={{
        code: "404",
        title: "Page not found",
        detail: "The page you’re looking for doesn’t exist.",
      }}
    />
  );
}
