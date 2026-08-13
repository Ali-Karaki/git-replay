// Global keyboard navigation. Inputs/textareas never trap these bindings
// (except Escape and Ctrl+K, which are handled globally).

import { useEffect } from "react";
import { useReplay } from "../stores/replay";

const JUMP = 5;

export function useKeyboard(opts: {
  onOpenPalette: () => void;
  onClosePalette: () => void;
  onFocusSearch: () => void;
  paletteOpen: boolean;
}) {
  const { onOpenPalette, onClosePalette, onFocusSearch, paletteOpen } = opts;

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

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
        case "1":
          s.setView("step");
          break;
        case "2":
          s.setView("snapshot");
          break;
        case "3":
          s.setView("evolution");
          break;
        case "4":
          s.setView("map");
          break;
        case "/":
          e.preventDefault();
          onFocusSearch();
          break;
        default:
          break;
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onOpenPalette, onClosePalette, onFocusSearch, paletteOpen]);
}
