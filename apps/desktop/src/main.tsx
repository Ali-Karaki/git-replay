import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles/tokens.css";
import "./styles/shell.css";
import "./styles/diff.css";
import "./styles/views.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

// Dev-only: VITE_SELFTEST=1 npm run tauri dev auto-runs the end-to-end
// self-test after startup and reports the results through the engine.
if (import.meta.env.DEV && import.meta.env.VITE_SELFTEST === "1") {
  (window as unknown as { __selftestErrors: string[] }).__selftestErrors = [];
  window.addEventListener("error", (e) => {
    (window as unknown as { __selftestErrors: string[] }).__selftestErrors.push(String(e.message));
  });
  window.addEventListener("unhandledrejection", (e) => {
    (window as unknown as { __selftestErrors: string[] }).__selftestErrors.push(`rejection: ${String(e.reason)}`);
  });
  const origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    (window as unknown as { __selftestErrors: string[] }).__selftestErrors.push(
      `console.error: ${args
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" ")
        .slice(0, 1000)}`,
    );
    origError(...args);
  };
  window.setTimeout(() => {
    void import("./lib/selfTest").then((m) => m.runSelfTest());
  }, 1200);
}
