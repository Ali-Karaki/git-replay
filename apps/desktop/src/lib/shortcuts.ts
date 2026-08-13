// Single source of truth for the keyboard shortcut reference — used by the
// `?` cheatsheet overlay and the Settings page. The view row is derived from
// the shared VIEWS table so it can never drift from the actual bindings.

import { VIEWS } from "./views";

export const SHORTCUTS: Array<[string, string]> = [
  ["← / →", "previous / next commit"],
  ["Shift+← / →", "jump 5 commits"],
  ["] / [", "next / previous changed file"],
  ["Space", "play / pause"],
  ["Home / End", "base / HEAD"],
  [VIEWS.map((v) => v.key).join(" / "), VIEWS.map((v) => v.label).join(" / ")],
  ["/", "search commits, files, and changed content"],
  ["Ctrl+K", "command palette"],
  ["?", "this cheatsheet"],
  ["Esc", "close overlays"],
];
