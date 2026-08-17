// Global keyboard navigation. Inputs/textareas never trap these bindings
// (except Escape and Ctrl+K, which are handled globally).

import { useEffect } from "react";
import { getCachedCommitDetail } from "../lib/dataCaches";
import { VIEWS } from "../lib/views";
import { frameSha, useReplay } from "../stores/replay";

const JUMP = 5;

export function useKeyboard(opts: {
  onOpenPalette: () => void;
  onClosePalette: () => void;
  onFocusSearch: () => void;
  onToggleCheatsheet: () => void;
  paletteOpen: boolean;
}) {
  const { onOpenPalette, onClosePalette, onFocusSearch, onToggleCheatsheet, paletteOpen } = opts;

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      if (e.key === "Escape") {
        if (paletteOpen) {
          e.preventDefault();
          onClosePalette();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenPalette();
        return;
      }
      if (typing) return;

      if (e.key === "?") {
        e.preventDefault();
        onToggleCheatsheet();
        return;
      }

      const s = useReplay.getState();
      if (!s.range) return;

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          s.step(e.shiftKey ? -JUMP : -1);
          break;
        case "ArrowRight":
          e.preventDefault();
          s.step(e.shiftKey ? JUMP : 1);
          break;
        case " ":
          e.preventDefault();
          s.setPlaying(!s.playing);
          break;
        case "Home":
          e.preventDefault();
          s.setIndex(0);
          break;
        case "End":
          e.preventDefault();
          s.setIndex(s.range.commits.length);
          break;
        case "/":
          e.preventDefault();
          onFocusSearch();
          break;
        case "]":
        case "[": {
          e.preventDefault();
          const st = useReplay.getState();
          if (!st.repo || !st.range || st.index === 0) break;
          const sha = frameSha(st.range, st.index, st.hasWorkingTree);
          const files =
            sha === "WORKTREE" ? st.wtFrame?.files : getCachedCommitDetail(st.repo.id, sha, st.mergeParent)?.files;
          if (!files || files.length === 0) break;
          const paths = files.map((f) => f.newPath);
          const cur = st.selectedFile ? paths.indexOf(st.selectedFile) : -1;
          const next = e.key === "]" ? (cur + 1) % paths.length : cur <= 0 ? paths.length - 1 : cur - 1;
          st.setSelectedFile(paths[next]);
          break;
        }
        default: {
          // View keys 1–3 are data-driven from the shared VIEWS table.
          const v = VIEWS.find((v) => v.key === e.key);
          if (v) s.setView(v.id);
          break;
        }
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onOpenPalette, onClosePalette, onFocusSearch, onToggleCheatsheet, paletteOpen]);
}
