import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div style={{ padding: "2rem", textAlign: "center" }}>
            <h2>Something went wrong</h2>
            <pre style={{ fontSize: "0.85rem", color: "var(--error)", marginTop: "1rem" }}>
              {this.state.error?.message}
            </pre>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              style={{ marginTop: "1rem" }}
            >
              Try again
            </button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
