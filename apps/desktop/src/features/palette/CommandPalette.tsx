// Ctrl+K command palette: keyboard-first navigation to any frame or action.

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, ChevronRight } from "../../components/Icons";
import { copyText } from "../../lib/clipboard";
import { formatDateTime, shortSha } from "../../lib/format";
import { VIEWS } from "../../lib/views";
import { useReplay } from "../../stores/replay";

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
function commitCommand(
  commit: { sha: string; subject: string; commitTs: number },
  index: number,
  setIndex: (i: number) => void,
): Command {
  return {
    id: `commit-${commit.sha}`,
    label: `Go to ${index + 1}: ${commit.subject}`,
    hint: `${shortSha(commit.sha)} · ${formatDateTime(commit.commitTs)}`,
    run: () => setIndex(index + 1),
  };
}

export function CommandPalette({
  open,
  onClose,
  onShowCheatsheet,
}: {
  open: boolean;
  onClose: () => void;
  onShowCheatsheet?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      window.setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  // Click-outside closes the palette; a document listener keeps the backdrop
  // itself free of mouse handlers.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, onClose]);

  const s = useReplay();
  const set = useReplay.setState;

  // The expensive part of the palette — formatting every commit entry —
  // changes only with the range, not with every store tick.
  const commitEntries = useMemo<Command[]>(() => {
    if (!s.range || s.range.commits.length > JUMP_CAP) return [];
    return s.range.commits.map((c, i) => commitCommand(c, i, s.setIndex));
  }, [s.range, s.setIndex]);

  // Keyed on the whole store snapshot: every command's label and action
  // reads current state, and rebuilding is cheap.
  const commands = useMemo<Command[]>(() => {
    const range = s.range;
    const cmds: Command[] = [];
    if (range) {
      cmds.push({ id: "next", label: "Next commit", hint: "→", run: () => s.step(1) });
      cmds.push({ id: "prev", label: "Previous commit", hint: "←", run: () => s.step(-1) });
      cmds.push({
        id: "play",
        label: s.playing ? "Pause" : "Play",
        hint: "Space",
        run: () => s.setPlaying(!s.playing),
      });
      cmds.push({ id: "first", label: "Go to base", hint: "Home", run: () => s.setIndex(0) });
      cmds.push({ id: "last", label: "Go to HEAD", hint: "End", run: () => s.setIndex(range.commits.length) });
      // Jump-to-commit entries — only for small enough ranges; larger ones
      // get on-demand commit search while typing (see `commitSearch`).
      cmds.push(...commitEntries);
      for (const v of VIEWS) {
        cmds.push({
          id: `view-${v.id}`,
          label: `${v.label} view${s.view === v.id ? " (current)" : ""}`,
          hint: v.key,
          run: () => s.setView(v.id),
        });
      }
      if (s.hasWorkingTree) {
        cmds.push({ id: "go-wt", label: "Go to Working Tree frame", run: () => s.setIndex(range.commits.length + 1) });
      }
      cmds.push({
        id: "chapters",
        label: `${s.groupChapters ? "Hide" : "Show"} timeline chapters`,
        run: () => set({ groupChapters: !s.groupChapters }),
      });
      cmds.push({
        id: "adaptive",
        label: `${s.adaptivePlayback ? "Disable" : "Enable"} adaptive playback`,
        run: () => set({ adaptivePlayback: !s.adaptivePlayback }),
      });
      cmds.push({
        id: "diff-mode",
        label: `Toggle ${s.diffMode === "unified" ? "split" : "unified"} diff`,
        run: () => set({ diffMode: s.diffMode === "unified" ? "split" : "unified" }),
      });
      const sel = s.selectedFile;
      if (sel) {
        cmds.push({ id: "copy-path", label: `Copy file path: ${sel}`, run: () => void copyText(sel) });
      }
    }
    // Only meaningful while the sidebar exists (any repo screen other than
    // settings/about) — elsewhere it would flip persisted state invisibly.
    if (s.repo !== null && s.screen !== "settings" && s.screen !== "about") {
      cmds.push({
        id: "collapse-sidebar",
        label: `${s.sidebarCollapsed ? "Expand" : "Collapse"} sidebar`,
        run: () => set({ sidebarCollapsed: !s.sidebarCollapsed }),
      });
    }
    cmds.push({
      id: "ui-zoom-in",
      label: "Zoom in",
      hint: "Ctrl++",
      run: () => s.zoomUiIn(),
    });
    cmds.push({
      id: "ui-zoom-out",
      label: "Zoom out",
      hint: "Ctrl+-",
      run: () => s.zoomUiOut(),
    });
    cmds.push({
      id: "ui-zoom-reset",
      label: "Reset zoom",
      hint: "Ctrl+0",
      run: () => s.resetUiZoom(),
    });
    cmds.push({
      id: "open",
      label: "Open repository…",
      run: () => {
        onClose();
        set({ repo: null, range: null });
      },
    });
    cmds.push({
      id: "change-range",
      label: "Change replay range…",
      run: () => {
        onClose();
        set({ range: null });
      },
    });
    cmds.push({
      id: "settings",
      label: "Settings",
      run: () => {
        onClose();
        s.setScreen("settings");
      },
    });
    cmds.push({
      id: "about",
      label: "About Git Replay",
      run: () => {
        onClose();
        s.setScreen("about");
      },
    });
    cmds.push({
      id: "help",
      label: "Keyboard shortcuts",
      hint: "?",
      run: () => {
        onClose();
        onShowCheatsheet?.();
      },
    });
    return cmds;
  }, [s, commitEntries, onClose, onShowCheatsheet]);

  // Precomputed search index over the range's commits: lowercased subject,
  // SHA, and the 1-based commit number (so "250" jumps to commit 250).
  // Lowercasing happens once per range — keystrokes never re-allocate.
  const commitIndex = useMemo(() => {
    if (!s.range) return null;
    return s.range.commits.map((c, i) => ({ c, i, lower: c.subject.toLowerCase(), num: String(i + 1) }));
  }, [s.range]);

  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), COMMIT_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  // On-demand commit jumps. On small ranges the per-commit entries above
  // already cover subjects, so this only adds what they can't: full-SHA
  // prefixes. On large ranges it is the only commit source (subject, SHA,
  // or commit-number prefix).
  const commitSearch = useMemo<Command[]>(() => {
    if (!commitIndex) return [];
    const q = debouncedQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    const isSha = /^[0-9a-f]{7,}$/.test(q);
    const large = commitIndex.length > JUMP_CAP;
    if (!large && !isSha) return [];
    return commitIndex
      .filter(({ c, lower, num }) =>
        isSha ? c.sha.startsWith(q) : lower.includes(q) || c.sha.startsWith(q) || num.startsWith(q),
      )
      .slice(0, 20)
      .map(({ c, i }) => commitCommand(c, i, s.setIndex));
  }, [commitIndex, debouncedQuery, s.setIndex]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    const matches = commands.filter(
      (c) => c.label.toLowerCase().includes(q) || (c.hint ?? "").toLowerCase().includes(q),
    );
    // Commands first (Enter should run a command when one matches, never a
    // commit jump), prefix matches above substring matches, then commit
    // search results — deduped against the entries above.
    matches.sort((a, b) => Number(b.label.toLowerCase().startsWith(q)) - Number(a.label.toLowerCase().startsWith(q)));
    const ids = new Set(matches.map((c) => c.id));
    return [...matches, ...commitSearch.filter((c) => !ids.has(c.id))];
  }, [commands, commitSearch, query]);

  if (!open) return null;

  const run = (cmd: Command) => {
    onClose();
    cmd.run();
  };

  const visible = filtered.slice(0, 50);

  return (
    <div className="palette-overlay">
      <div ref={panelRef} className="palette">
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Type a command… (or a commit's subject / SHA to jump)"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            // Reset the highlight per keystroke — not on store ticks
            // (playback, toggles, etc.), which would yank selection.
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected((i) => Math.min(i + 1, visible.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && visible[selected]) {
              run(visible[selected]);
            } else if (e.key === "Escape") {
              onClose();
            }
          }}
        />
        <div className="palette-list">
          {visible.length === 0 && <div className="palette-empty">No matching commands.</div>}
          {visible.map((cmd, i) => (
            <button
              type="button"
              key={cmd.id}
              className={`palette-item ${i === selected ? "selected" : ""}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => run(cmd)}
            >
              <span className="palette-label">{cmd.label}</span>
              {i === selected && <CheckIcon size={12} />}
              {cmd.hint && <span className="palette-hint">{cmd.hint}</span>}
              <span className="palette-chevron">
                <ChevronRight size={12} />
              </span>
            </button>
          ))}
        </div>
        <div className="palette-footer dim">↑↓ navigate · Enter select · Esc close</div>
      </div>
    </div>
  );
}
