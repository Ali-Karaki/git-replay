// `?` keyboard cheatsheet overlay — dismiss with any key or a click.
// Click-outside uses a document listener, so the backdrop itself carries no
// mouse handlers (a purely presentational element).

import { useEffect, useRef } from "react";
import { SHORTCUTS } from "../../lib/shortcuts";

export function Cheatsheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="palette-overlay">
      <div ref={panelRef} className="palette cheatsheet">
        <div className="cheatsheet-title">Keyboard shortcuts</div>
        <div className="kbd-table">
          {SHORTCUTS.map(([key, action]) => (
            <div key={key} className="kbd-row">
              <span className="kbd-keys">{key}</span>
              <span className="dim">{action}</span>
            </div>
          ))}
        </div>
        <div className="palette-footer dim">Esc or click outside to close</div>
      </div>
    </div>
  );
}
