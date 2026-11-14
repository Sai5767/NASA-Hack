import { Component } from "react";

/** Catches rendering errors so a bug shows a clear message instead of a blank page. */
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Visible in the browser console for debugging.
    console.error("Trend Detective crashed while rendering:", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <p className="eyebrow">Signal lost</p>
        <h1>Something went wrong on this screen</h1>
        <p className="dim">The investigation is fine; the display hit an unexpected error. Reloading usually fixes it.</p>
        <pre className="mono">{String(this.state.error?.message ?? this.state.error)}</pre>
        <div className="crash-actions">
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Reload</button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              window.location.hash = "";
              window.location.reload();
            }}
          >
            Start over
          </button>
        </div>
      </div>
    );
  }
}
