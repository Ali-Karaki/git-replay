// `?` keyboard cheatsheet overlay — dismiss with any key or a click.

import { SHORTCUTS } from "../../lib/shortcuts";

export function Cheatsheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="palette-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette cheatsheet">
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
