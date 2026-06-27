import React from "react";
import { captureException } from "./analytics-client";
import styles from "./error-boundary.module.css";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Last line of defense: a render crash shows a calm fallback (in neutral Spanish)
 * instead of a white screen, and the full exception goes to PostHog.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    captureException(error, { componentStack: info.componentStack });
  }

  handleReload = (): void => {
    this.setState({ hasError: false });
    window.location.reload();
  };

  render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className={styles.fallback} role="alert">
        <h1 className={styles.title}>Algo salió mal</h1>
        <p className={styles.body}>
          Tuvimos un problema inesperado. Ya lo registramos. Puedes recargar para seguir.
        </p>
        <button type="button" className={styles.button} onClick={this.handleReload}>
          Recargar
        </button>
      </div>
    );
  }
}
