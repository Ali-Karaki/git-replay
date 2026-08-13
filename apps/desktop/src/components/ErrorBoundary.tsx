// Last line of defense: any uncaught render error shows a recoverable panel
// instead of a blank or frozen window ("nothing happened" must be impossible).

import { Component, type ReactNode } from "react";
import { WarningIcon } from "./Icons";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="crash-panel">
          <WarningIcon size={22} />
          <h1>Something went wrong</h1>
          <p className="dim">Git Replay hit an unexpected error while rendering.</p>
          <pre className="error-detail">{String(this.state.error?.stack ?? this.state.error)}</pre>
          <div className="crash-actions">
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              Reload
            </button>
            <button
              className="btn"
              onClick={() => {
                this.setState({ error: null });
              }}
            >
              Try to continue
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
