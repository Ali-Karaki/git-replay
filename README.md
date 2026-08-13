# Git Replay

**Replay how software evolved.**

A local-first desktop application that lets a developer replay the evolution of a Git
repository over time. Select a branch, commit range, tag range, or an entire repository —
then step through it like a timeline: watch what changed at each commit, browse the full
project snapshot at any point in history, and follow a single file through its whole life.

It is a development timelapse player, not a Git client.

The full product specification lives in [`convo_with_gpt.txt`](convo_with_gpt.txt)
(product summary, UX spec, invariants, and implementation order).

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

```sh
cd apps/desktop
npm install
npm run tauri dev        # run the app
npm run build            # typecheck + build the frontend
cd src-tauri && cargo test   # engine tests against programmatic fixture repos
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
| `1` / `2` / `3` | Step / Snapshot / File Evolution view |
| `/` | search |
| `Ctrl+K` | command palette |

## Product invariants

1. Git is authoritative.
2. Replay is the primary product.
3. Raw Git history is always accessible — never silently rewritten or hidden.
4. Core functionality works offline.
5. Deleting the cache never deletes repository information.
6. Previous/Next navigation feels instantaneous.
7. Large repositories never block the UI thread.
