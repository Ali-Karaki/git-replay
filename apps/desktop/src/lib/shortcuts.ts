// Single source of truth for the keyboard shortcut reference — used by the
// `?` cheatsheet overlay and the Settings page.

export const SHORTCUTS: Array<[string, string]> = [
  ["← / →", "previous / next commit"],
  ["Shift+← / →", "jump 5 commits"],
  ["] / [", "next / previous changed file"],
  ["Space", "play / pause"],
  ["Home / End", "base / HEAD"],
  ["1 / 2 / 3 / 4", "What changed / Browse code / File story / Overview"],
  ["/", "search commits, files, and changed content"],
  ["Ctrl+K", "command palette"],
  ["?", "this cheatsheet"],
  ["Esc", "close overlays"],
];
