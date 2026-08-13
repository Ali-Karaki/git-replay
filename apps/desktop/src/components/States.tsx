// Loading, empty, and error states — deliberately polished.

import { useState } from "react";
import { WarningIcon } from "./Icons";

export function Skeleton({ rows }: { rows: number }) {
  // A single element: a repeating gradient draws the placeholder lines.
  return <div className="skeleton" aria-hidden="true" style={{ height: rows * 22 }} />;
}

export function ErrorPanel({
  error,
  onRetry,
}: {
  error: { message: string; detail?: string | null };
  onRetry?: () => void;
}) {
  const [showDetail, setShowDetail] = useState(false);
  return (
    <div className="error-panel" role="alert">
      <div className="error-panel-top">
        <WarningIcon size={16} />
        <span>{error.message}</span>
      </div>
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry}>
          Try again
        </button>
      )}
      {error.detail && (
        <>
          <button type="button" className="btn-ghost" onClick={() => setShowDetail(!showDetail)}>
            {showDetail ? "Hide details" : "Show details"}
          </button>
          {showDetail && <pre className="error-detail">{error.detail}</pre>}
        </>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon?: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-icon">{icon}</div>}
      <div className="empty-title">{title}</div>
      {hint && <div className="empty-hint">{hint}</div>}
    </div>
  );
}
