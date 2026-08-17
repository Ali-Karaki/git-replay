// Single source of truth for the replay views: ids, friendly labels,
// keyboard shortcuts, and one-line descriptions. Used by the sidebar, the
// command palette, the keyboard bindings, and the shortcuts reference —
// renaming a view here renames it everywhere.

import type { ViewMode } from "../stores/replay";

export interface ViewDef {
  id: ViewMode;
  label: string;
  key: string;
  sub: string;
}

export const VIEWS: ViewDef[] = [
  { id: "step", label: "What changed", key: "1", sub: "Commits, files, diffs" },
  { id: "snapshot", label: "Browse code", key: "2", sub: "Files at any point" },
  { id: "evolution", label: "File story", key: "3", sub: "Follow one file" },
];
