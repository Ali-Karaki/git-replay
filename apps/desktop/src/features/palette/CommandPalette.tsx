// Ctrl+K command palette: keyboard-first navigation to any frame or action.

import { useEffect, useMemo, useRef, useState } from "react";
import { useReplay } from "../../stores/replay";
import { formatDateTime, shortSha } from "../../lib/format";
import { CheckIcon, ChevronRight } from "../../components/Icons";

interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      window.setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const s = useReplay();
  const set = useReplay.setState;

  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = [];
    if (s.range) {
      cmds.push({ id: "next", label: "Next commit", hint: "→", run: () => s.step(1) });
      cmds.push({ id: "prev", label: "Previous commit", hint: "←", run: () => s.step(-1) });
      cmds.push({ id: "play", label: s.playing ? "Pause" : "Play", hint: "Space", run: () => s.setPlaying(!s.playing) });
      cmds.push({ id: "first", label: "Go to base", hint: "Home", run: () => s.setIndex(0) });
      cmds.push({ id: "last", label: "Go to HEAD", hint: "End", run: () => s.setIndex(s.range!.commits.length) });
      // Jump-to-commit entries.
      s.range.commits.forEach((c, i) => {
        cmds.push({
          id: `commit-${c.sha}`,
          label: `Go to ${i + 1}: ${c.subject}`,
          hint: `${shortSha(c.sha)} · ${formatDateTime(c.commitTs)}`,
          run: () => s.setIndex(i + 1),
        });
      });
      cmds.push({ id: "view-step", label: `Step view${s.view === "step" ? " (current)" : ""}`, hint: "1", run: () => s.setView("step") });
      cmds.push({ id: "view-snapshot", label: `Snapshot view${s.view === "snapshot" ? " (current)" : ""}`, hint: "2", run: () => s.setView("snapshot") });
      cmds.push({ id: "view-evolution", label: `File evolution view${s.view === "evolution" ? " (current)" : ""}`, hint: "3", run: () => s.setView("evolution") });
      cmds.push({
        id: "diff-mode",
        label: `Toggle ${s.diffMode === "unified" ? "split" : "unified"} diff`,
        run: () => set({ diffMode: s.diffMode === "unified" ? "split" : "unified" }),
      });
      cmds.push({ id: "hide-generated", label: `${s.hideGenerated ? "Show" : "Hide"} generated files`, run: () => set({ hideGenerated: !s.hideGenerated }) });
      cmds.push({ id: "hide-ws", label: `${s.hideWhitespaceOnly ? "Show" : "Hide"} whitespace-only changes`, run: () => set({ hideWhitespaceOnly: !s.hideWhitespaceOnly }) });
      const sel = s.selectedFile;
      if (sel) {
        cmds.push({ id: "copy-path", label: `Copy file path: ${sel}`, run: () => void navigator.clipboard.writeText(sel) });
      }
    }
    cmds.push({ id: "open", label: "Open repository…", run: () => { onClose(); set({ repo: null, range: null }); } });
    cmds.push({ id: "change-range", label: "Change replay range…", hint: "when a repo is open", run: () => { onClose(); set({ range: null }); } });
    return cmds;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q) || (c.hint ?? "").toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => {
    setSelected(0);
  }, [filtered]);

  if (!open) return null;

  const run = (cmd: Command) => {
    onClose();
    cmd.run();
  };

  return (
    <div className="palette-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette">
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Type a command… (jump to any commit)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected((i) => Math.min(i + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && filtered[selected]) {
              run(filtered[selected]);
            } else if (e.key === "Escape") {
              onClose();
            }
          }}
        />
        <div className="palette-list">
          {filtered.length === 0 && <div className="palette-empty">No matching commands.</div>}
          {filtered.slice(0, 50).map((cmd, i) => (
            <button
              key={cmd.id}
              className={`palette-item ${i === selected ? "selected" : ""}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => run(cmd)}
            >
              <span className="palette-label">{cmd.label}</span>
              {i === selected && <CheckIcon size={12} />}
              {cmd.hint && <span className="palette-hint">{cmd.hint}</span>}
              <span className="palette-chevron"><ChevronRight size={12} /></span>
            </button>
          ))}
        </div>
        <div className="palette-footer dim">↑↓ navigate · Enter select · Esc close</div>
      </div>
    </div>
  );
}
