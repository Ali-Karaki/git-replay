// Ctrl+K command palette: keyboard-first navigation to any frame or action.

import { useEffect, useMemo, useRef, useState } from "react";
import { useReplay } from "../../stores/replay";
import { formatDateTime, shortSha } from "../../lib/format";
import { copyText } from "../../lib/clipboard";
import { CheckIcon, ChevronRight } from "../../components/Icons";

interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

/** Ranges larger than this don't get one palette entry per commit — instead
 *  commit jumps appear while typing (see `commitSearch`). */
const JUMP_CAP = 300;

/** Matches the debounce used by the inline search bar. */
const COMMIT_SEARCH_DEBOUNCE_MS = 250;

/** A "Go to N: subject" jump entry for one commit. */
function commitCommand(commit: { sha: string; subject: string; commitTs: number }, index: number, setIndex: (i: number) => void): Command {
  return {
    id: `commit-${commit.sha}`,
    label: `Go to ${index + 1}: ${commit.subject}`,
    hint: `${shortSha(commit.sha)} · ${formatDateTime(commit.commitTs)}`,
    run: () => setIndex(index + 1),
  };
}

export function CommandPalette({
  open, onClose, onShowCheatsheet,
}: { open: boolean; onClose: () => void; onShowCheatsheet?: () => void }) {
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
    const range = s.range;
    const cmds: Command[] = [];
    if (range) {
      cmds.push({ id: "next", label: "Next commit", hint: "→", run: () => s.step(1) });
      cmds.push({ id: "prev", label: "Previous commit", hint: "←", run: () => s.step(-1) });
      cmds.push({ id: "play", label: s.playing ? "Pause" : "Play", hint: "Space", run: () => s.setPlaying(!s.playing) });
      cmds.push({ id: "first", label: "Go to base", hint: "Home", run: () => s.setIndex(0) });
      cmds.push({ id: "last", label: "Go to HEAD", hint: "End", run: () => s.setIndex(range.commits.length) });
      // Jump-to-commit entries — only for small enough ranges; larger ones
      // get on-demand commit search while typing (see `commitSearch`).
      if (range.commits.length <= JUMP_CAP) {
        range.commits.forEach((c, i) => cmds.push(commitCommand(c, i, s.setIndex)));
      }
      cmds.push({ id: "view-step", label: `What changed view${s.view === "step" ? " (current)" : ""}`, hint: "1", run: () => s.setView("step") });
      cmds.push({ id: "view-snapshot", label: `Browse code view${s.view === "snapshot" ? " (current)" : ""}`, hint: "2", run: () => s.setView("snapshot") });
      cmds.push({ id: "view-evolution", label: `File story view${s.view === "evolution" ? " (current)" : ""}`, hint: "3", run: () => s.setView("evolution") });
      cmds.push({ id: "view-map", label: `Overview view${s.view === "map" ? " (current)" : ""}`, hint: "4", run: () => s.setView("map") });
      if (s.hasWorkingTree) {
        cmds.push({ id: "go-wt", label: "Go to Working Tree frame", run: () => s.setIndex(range.commits.length + 1) });
      }
      cmds.push({ id: "chapters", label: `${s.groupChapters ? "Hide" : "Show"} timeline chapters`, run: () => set({ groupChapters: !s.groupChapters }) });
      cmds.push({ id: "adaptive", label: `${s.adaptivePlayback ? "Disable" : "Enable"} adaptive playback`, run: () => set({ adaptivePlayback: !s.adaptivePlayback }) });
      cmds.push({
        id: "diff-mode",
        label: `Toggle ${s.diffMode === "unified" ? "split" : "unified"} diff`,
        run: () => set({ diffMode: s.diffMode === "unified" ? "split" : "unified" }),
      });
      cmds.push({ id: "hide-generated", label: `${s.hideGenerated ? "Show" : "Hide"} generated files`, run: () => set({ hideGenerated: !s.hideGenerated }) });
      cmds.push({ id: "hide-ws", label: `${s.hideWhitespaceOnly ? "Show" : "Hide"} whitespace-only changes`, run: () => set({ hideWhitespaceOnly: !s.hideWhitespaceOnly }) });
      const sel = s.selectedFile;
      if (sel) {
        cmds.push({ id: "copy-path", label: `Copy file path: ${sel}`, run: () => void copyText(sel) });
      }
    }
    cmds.push({ id: "collapse-sidebar", label: `${s.sidebarCollapsed ? "Expand" : "Collapse"} sidebar`, run: () => set({ sidebarCollapsed: !s.sidebarCollapsed }) });
    cmds.push({ id: "open", label: "Open repository…", run: () => { onClose(); set({ repo: null, range: null }); } });
    cmds.push({ id: "change-range", label: "Change replay range…", run: () => { onClose(); set({ range: null }); } });
    cmds.push({ id: "settings", label: "Settings", run: () => { onClose(); s.setScreen("settings"); } });
    cmds.push({ id: "about", label: "About Git Replay", run: () => { onClose(); s.setScreen("about"); } });
    cmds.push({ id: "help", label: "Keyboard shortcuts", hint: "?", run: () => { onClose(); onShowCheatsheet?.(); } });
    return cmds;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, open]);

  // For ranges too large for per-commit entries, surface matching commits as
  // the user types. Lowercased subjects are precomputed once per range and
  // the query is debounced, so keystrokes on huge histories never trigger a
  // full-array scan with per-item allocations.
  const commitIndex = useMemo(() => {
    const range = s.range;
    if (!range || range.commits.length <= JUMP_CAP) return null;
    return range.commits.map((c, i) => ({ c, i, lower: c.subject.toLowerCase() }));
  }, [s.range]);

  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), COMMIT_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const commitSearch = useMemo<Command[]>(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!commitIndex || q.length < 3) return [];
    return commitIndex
      .filter(({ c, lower }) => lower.includes(q) || c.sha.startsWith(q))
      .slice(0, 20)
      .map(({ c, i }) => commitCommand(c, i, s.setIndex));
  }, [commitIndex, debouncedQuery, s.setIndex]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    const matches = commands.filter((c) => c.label.toLowerCase().includes(q) || (c.hint ?? "").toLowerCase().includes(q));
    return [...commitSearch, ...matches];
  }, [commands, commitSearch, query]);

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
          placeholder="Type a command… (or a commit's subject / SHA to jump)"
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
