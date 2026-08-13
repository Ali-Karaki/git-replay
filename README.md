# Git Replay

**Replay how software evolved.**

A local-first desktop application that lets a developer replay the evolution of a Git
repository over time. Select a branch, commit range, tag range, or an entire repository —
then step through it like a timeline: watch what changed at each commit, browse the full
project snapshot at any point in history, and follow a single file through its whole life.

It is a development timelapse player, not a Git client.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI](https://img.shields.io/badge/CI-passing-green.svg)](https://github.com/<owner>/git_replay/actions)
[![Tests](https://img.shields.io/badge/tests-81%20passing-green.svg)](#testing)

Git Replay answers one question: **how did this codebase get from state A to
state B?** Open a repository, pick what to watch (branch, commits, releases,
PR, or everything), and press Play — the evolution of the code replays like a
movie, frame by frame.

## Install

Download an installer from [GitHub Releases](https://github.com/<owner>/git_replay/releases) —
no compilation needed. Every `v*` tag is built automatically by CI
([release workflow](.github/workflows/release.yml)):

| Platform | Packages |
|----------|----------|
| Windows | `.msi` installer, `.exe` (NSIS) setup |
| macOS | `.dmg` for Intel (x64) and Apple Silicon (arm64) |
| Linux | `.deb`, `.AppImage` |

A `SHA256SUMS.txt` manifest is attached to each release. macOS builds are ad-hoc
signed until signing secrets are configured — right-click → Open on first launch.
On Linux, Git must be installed (`sudo apt install git`).

## Architecture

```
                 DESKTOP

           React + TypeScript
                  │
     ┌────────────┴────────────┐
     │                         │
 Web Workers               Zustand
     │                         │
     └────────────┬────────────┘
                IPC
                  │
            Tauri / Rust
                  │
            ┌─────┴─────┐
            │           │
         Git CLI      SQLite
            │        (derived cache)
            ▼
       repository
```

- **Git owns history.** The system Git CLI (plumbing commands, `-z` machine-readable
  output) is the only source of truth.
- **Rust interprets it.** Tauri commands expose typed domain models — commits, file
  changes, diffs, trees, blobs, evolution — never raw shell output.
- **SQLite accelerates.** A derived cache of commit metadata, file changes, diffs and
  blobs. Deleting the cache file never loses repository information.
- **Workers process presentation.** Syntax highlighting, word-level diffs, large
  transformations run off the React main thread.
- **React renders time.** Timeline, playback, step/snapshot/evolution views.

No backend. No Postgres. Core replay works fully offline.

## Repository layout

```
apps/desktop/          Tauri v2 desktop app (React + TypeScript frontend, Rust engine)
  src/                 Frontend: features/{repository,replay,timeline,step,diff,snapshot,evolution}
  src-tauri/           Rust: git/, cache/, commands/, errors/
fixtures/              Programmatic test repositories (built by Rust integration tests)
scripts/               make-demo-fixture.sh — builds a demo repo to try the app on
docs/                  Architecture and decisions
```

## Development

Prerequisites: Node.js 20+, Rust stable (MSVC toolchain on Windows), system Git.

Run everything from the repository root with `make`:

```sh
make dev          # run the app
make build        # typecheck + build the frontend
make test         # UI tests (vitest: store, diff, chapters, markdown)
make test-engine  # engine tests (cargo) against programmatic fixture repos
make lint         # biome check (make fix auto-formats)
make check        # everything: lint + build + all tests
make selftest     # the app with its in-app end-to-end audit
make kill         # kill a running app (it locks the cargo build)
make release      # production bundle (installers)
```

The same scripts exist under `apps/desktop` if you prefer:

```sh
cd apps/desktop
npm install
npm run tauri dev
npm run tauri build
npm run build
npm test
cd src-tauri && cargo test
```

### Try it

Any repository works — including this one. For a curated tour, build the demo
fixture and open `fixtures/demo-repo` (14 commits: branch + merge, a rename, a
binary, an empty commit, tags, and a 1200-line generated file):

```sh
sh scripts/make-demo-fixture.sh
```

Suggested replays on the demo repo:

- **main → main** — the whole story, root to HEAD.
- **main → feature/worker** — the worker branch as it was built (starts at the
  merge base).
- Then select `src/worker.ts` and open File Evolution (key `3`) to watch that
  one file grow.

### Keyboard

| Keys | Action |
|------|--------|
| `←` / `→` | previous / next commit |
| `Shift+←` / `Shift+→` | jump 5 commits |
| `Space` | play / pause |
| `Home` / `End` | base / HEAD |
| `1` / `2` / `3` / `4` | Step / Snapshot / File Evolution / Change Map view |
| `/` | search |
| `Ctrl+K` | command palette |

### Capabilities

- **Replay sources**: branch (merge-base aware), commit range, tags/releases,
  GitHub pull request (with force-push version history via `gh`), entire repository
- **Working Tree frame**: when the replay head is your checked-out commit, a synthetic
  final frame shows uncommitted staged + unstaged changes, including untracked files
- **Change map**: file × commit activity grid (created / modified / deleted / moved)
- **Adaptive playback**: small commits flash by, substantial ones pause — with a
  fixed-rate mode and always-working manual stepping
- **Chapters**: heuristic grouping on the timeline as an alternate presentation;
  raw commits always visible
- **Search**: commit messages, file paths, and changed content (pickaxe)
- **Repository watch**: new commits or branch switches surface a refresh banner
- **Session restore**: resume the last replay from the welcome screen

## Product invariants

1. Git is authoritative.
2. Replay is the primary product.
3. Raw Git history is always accessible — never silently rewritten or hidden.
4. Core functionality works offline.
5. Deleting the cache never deletes repository information.
6. Previous/Next navigation feels instantaneous.
7. Large repositories never block the UI thread.

## Open source

MIT licensed. Community files: [CONTRIBUTING.md](CONTRIBUTING.md),
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), [SECURITY.md](SECURITY.md),
[SUPPORT.md](SUPPORT.md), and issue/PR templates under `.github/`.
`docs/architecture.md` and `docs/decisions/` record the design — start there if
you want to contribute.
