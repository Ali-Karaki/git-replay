# Changelog

All notable changes to Git Replay are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
versions with [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Window zoom: Ctrl++ / Ctrl+- / Ctrl+0 (Cmd on macOS) scales the whole app.

### Changed

- Welcome, Settings, and About follow a VS Code / Cursor workbench
  layout: Get Started columns, a settings editor with a category list,
  and a documentation-style About page.
- Step view always opens the first changed file in the current commit.

### Removed

- Overview (change map): the file × commit activity grid.
- Whitespace-only and generated-file filters. Gitignore and
  gitattributes already decide what Git reports.

## [0.1.0] — 2026-08-13

### Added

- Replay any repository: branch (merge-base aware), commit range, tags →
  releases, GitHub pull requests (with force-push version history via `gh`),
  and entire-repository replays.
- Canvas timeline with day-bucket aggregation for huge histories, zooming,
  scrubbing, and heuristic chapter grouping (raw commits always visible).
- Step view: per-commit changes with rename/copy detection, merge-parent
  selection, unified/split diffs, word-level marks, syntax highlighting via a
  Web Worker, generated/whitespace filters, image diffs.
- Snapshot view: content-addressed file tree with per-commit badges, text
  viewer, images, binary/symlink/submodule notices, markdown preview, LOC
  stats.
- File evolution with rename-chain following and file-only playback.
- Working Tree frame for uncommitted staged + unstaged changes.
- Change map: file × commit activity grid.
- Adaptive playback, replay search (messages, paths, pickaxe), command palette,
  session resume, repository-change detection, keyboard-first navigation,
  light/dark themes.
- SQLite derived cache (delete-safe); prefetching of adjacent frames.
- 101 automated tests: 56 engine tests against real git fixtures (including a
  500-commit history) and 45 vitest UI tests, plus an in-app end-to-end audit.
