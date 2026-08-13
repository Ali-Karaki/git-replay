# Architecture

## Overview

Git Replay is a local-first Tauri desktop application. The core question it answers is:
*how did this codebase get from state A to state B?*

The architecture is split across four layers with strict responsibility boundaries:

```
┌────────────────────────────────────────────────────────────┐
│ React main thread                                          │
│ rendering · interaction · playback · keyboard · layout     │
├────────────────────────────────────────────────────────────┤
│ Web Workers                                                │
│ syntax highlighting · word-level diffs · large transforms  │
├────────────────────────────────────────────────────────────┤
│ Tauri / Rust engine (local "backend")                      │
│ git operations · commit graph · trees · blobs · diffs      │
│ rename detection · cache management                        │
├────────────────────────────────────────────────────────────┤
│ Git repository (source of truth) · SQLite (derived cache)  │
└────────────────────────────────────────────────────────────┘
```

## Layer contracts

### Git → Rust

The engine shells out to the system Git CLI using **plumbing commands with `-z`
(NUL-separated) output** exclusively. Human-formatted output is never parsed.

| Concern          | Commands                                                            |
|------------------|---------------------------------------------------------------------|
| Refs / resolve   | `rev-parse`, `merge-base`                                           |
| History          | `rev-list --topo-order`, `log -z --format=...`                      |
| File changes     | `diff-tree -r --root -M -C --name-status -z`, `diff --numstat -z`   |
| Stats            | `diff --shortstat`                                                  |
| Patches          | `diff --no-ext-diff --no-color -M`                                  |
| Snapshots        | `ls-tree -l -z <tree-sha>`, `cat-file`                              |
| Evolution        | `log --raw -z --format=%H <base>..<head> -- <path>`                 |
| Search           | `log --grep --fixed-strings`, pathspec globs                        |

Key semantic decisions:

- **Commit ordering** is topological (`rev-list --topo-order`), never timestamp order.
  Author/committer dates can lie (rebases, cherry-picks, clock skew); ancestry cannot.
- **Root commits** are diffed against the empty tree (`4b825dc6...`) via `--root`.
- **Merge commits** are always diffed against an explicit parent (first parent by
  default, user-selectable). Never the combined diff.
- **Renames/copies** use git's own `-M -C` detection; the app never invents continuity.
- **Tree listing is content-addressed**: subdirectories are listed by their tree object
  SHA (`ls-tree <tree-sha>`), which avoids pathspec escaping entirely and makes tree
  listings cacheable by SHA.

### Rust → React

Tauri commands expose typed domain models (see `src-tauri/src/git/`). React never sees
raw shell output. The internal replay model mirrors the spec:

```ts
type Replay = { base: CommitRef; head: CommitRef; commits: ReplayCommit[] }
```

Frames are `[base] + commits` (topo order, oldest first). Frame 0 is the baseline
snapshot; frames 1..N are commits.

Heavy operations (`resolve_replay`, `get_snapshot_stats`, `get_file_evolution`,
`search_replay`) run in `spawn_blocking` so the IPC thread never blocks.

### React → Workers

Presentation-only CPU work (hljs syntax highlighting, word-level diffing of paired
lines) runs in a dedicated Web Worker with a request/response protocol keyed by
(blobSha, line range, language). Results are cached; the main thread only ever renders.

## Caching

SQLite at the OS cache dir (`replay_cache.db`), keyed by canonical repo path:

- `commits` — metadata by SHA
- `file_changes` — per (sha, parent_index) JSON
- `diffs` — patch per (sha, parent_index, path)
- `blobs` — content-addressed by blob SHA
- `trees` — listing per tree SHA
- `stats` / `evolution` — derived aggregates

Everything is derived data: deleting the database degrades to recomputation, never to
data loss. Git is the only source of truth.

The frontend additionally keeps an in-memory commit cache and prefetches ±2 frames
around the playhead so stepping feels instantaneous.

## Error model

`AppError` in `src-tauri/src/errors.rs` maps git/io failures to user-meaningful
messages (Repository not found, Ref not found, Not a work tree, …) with the raw git
stderr kept in a `detail` field for "Show details" surfaces.

## Known trade-offs (v1)

- System Git CLI is required (see ADR-0002). No libgit2 dependency.
- Commit message fields are split on ASCII control separators (`%x1f`); a commit
  message containing `0x1f` would be truncated on that field. Accepted for v1.
- Paths are assumed UTF-8 (`String::from_utf8_lossy`); non-UTF-8 paths display lossy.
- Adaptive playback timing and change-map visualization are not yet implemented;
  manual stepping always works.
- Timeline aggregation for very large histories is by day-bucket; the canvas renderer
  never creates DOM nodes per commit.
