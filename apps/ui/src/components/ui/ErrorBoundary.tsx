import { Component, type ReactNode } from "react";
import { Button } from "./Button";
import styles from "./ErrorBoundary.module.css";

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className={styles.wrapper} role="alert" aria-live="polite">
            <h2 className={styles.title}>Something went wrong</h2>
            <pre className={styles.message}>{this.state.error?.message}</pre>
            <Button
              variant="secondary"
              className={styles.retry}
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              Try again
            </Button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}

Object.defineProperty(ErrorBoundary, "displayName", { value: "ErrorBoundary" });
