# Contributing to Git Replay

Thanks for your interest! Git Replay is a local-first Tauri app that replays
how a Git repository evolved. This guide gets you from clone to pull request.

## Ground rules

- **Git is the source of truth.** The engine shells out to the system Git CLI
  with machine-readable (`-z`) output only. Never parse human-formatted git
  output; never reimplement git semantics the CLI already provides.
- **Replay is the product.** Features should answer questions about *time,
  continuity, and progression*. Code review, CI, and project management are
  non-goals (see `convo_with_gpt.txt` for the full spec).
- **Core functionality works offline.** Nothing is ever uploaded.
- **Tests are expected** for anything that touches git semantics or frame
  navigation. The suite exists precisely because real git output is full of
  surprises (see the byte-level notes in `docs/architecture.md`).

## Setup

Prerequisites: Node.js 20+, Rust stable (MSVC toolchain on Windows), system Git.
On Linux you also need `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`,
`librsvg2-dev` (see `.github/workflows/ci.yml`).

```sh
git clone <your-fork-url>
cd git_replay
cd apps/desktop
npm install
npm run tauri dev          # run the app
```

Try it against `fixtures/demo-repo` (build it with `sh scripts/make-demo-fixture.sh`).

## Tests

```sh
cd apps/desktop
npm test                                # UI tests (vitest)
npm run build                           # typecheck + frontend build
cd src-tauri && cargo test              # engine tests (44, against real git fixtures)
```

The Rust fixture tests build *real* repositories with the git CLI in temp
directories and compare the engine against git's own output — snapshot vs
`ls-tree`, diffs vs `git diff`, evolution vs `--follow`, ordering vs topology.
When a test fails, it usually means git's actual output differs from an
assumption; probe it empirically before changing the parser.

## Layout

```
apps/desktop/
  src/                  React frontend
    lib/                pure helpers + IPC + caches (unit-tested)
    stores/replay.ts    zustand playback state
    features/           one folder per feature (step, snapshot, timeline, …)
    workers/            hljs syntax highlighting
  src-tauri/
    src/git/            the engine: plumbing-command layer per concern
    src/cache.rs        SQLite derived cache (delete-safe by design)
    src/state.rs        service layer + repo registry
    src/commands.rs     thin IPC wrappers
    tests/              programmatic fixtures + invariant tests
docs/                   architecture + decisions (ADRs)
```

## Commit & PR conventions

- Conventional-style subjects: `feat(engine): …`, `fix(ui): …`, `test: …`,
  `docs: …`, `ci: …`.
- One logical change per commit; keep `main` green (all three suites pass).
- PR template asks for: what/why, how it was tested, and screenshots for UI
  changes.
- New git-parsing code should come with a fixture test that pins the actual
  byte format it was written against.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By
participating, you agree to uphold its terms.
