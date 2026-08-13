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
| File changes     | `diff-tree -r --root -M -C --name-status -z`, `diff-tree --numstat -z` |
| Stats            | `diff-tree --shortstat`                                             |
| Patches          | `diff-tree -r -p --root -M`                                         |
| Snapshots        | `ls-tree -l -z <tree-sha>`, `cat-file`                              |
| Evolution        | `log --follow --raw/--numstat -z` (rename chains via git)           |
| Search           | `log --grep --fixed-strings`, pathspec globs, `-S` pickaxe          |
| Working tree     | `diff HEAD`, `ls-files --stage/--others`, `rev-parse :path`         |
| Pull requests    | `gh pr view` / `gh api graphql` (force-push events), `git fetch`    |

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
- **Working tree frames** (spec 35) are synthetic: `diff HEAD` for changes, index
  listings (`ls-files --stage` + untracked) for snapshots — no tree objects are
  fabricated, and the frame exists only while the replay head is the repo's HEAD.
- **PR replays** fetch `refs/pull/N/head` (or use `gh`) and feed the same resolve
  path as local refs; force-push versions come from GitHub's
  `HEAD_REF_FORCE_PUSHED` timeline events via `gh api graphql`.
- **Chapters** are a pure presentation heuristic over raw commits (prefix changes,
  time gaps, merges) — the raw timeline is always one toggle away.

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

## Testing

- **Engine** (`cargo test`, 44 tests): fixtures are real repositories built by
  the git CLI in temp dirs (linear, merge, rename, copy, binary, symlink via
  `update-index --cacheinfo`, gitlink, tags, skewed author dates, working-tree
  edits, 500-commit history). Invariants are compared against git's own output:
  snapshot == `ls-tree`, diff == `git diff`, evolution == `--follow`, stats ==
  `--shortstat`, plus cache-deletion invariance.
- **UI** (`npm test`, vitest): store frame math and playback boundaries, the
  unified-diff parser and split pairing, chapter heuristics, the markdown
  renderer, and formatting helpers.

## Error model

`AppError` in `src-tauri/src/errors.rs` maps git/io failures to user-meaningful
messages (Repository not found, Ref not found, Not a work tree, …) with the raw git
stderr kept in a `detail` field for "Show details" surfaces.

## Known trade-offs

- System Git CLI is required (see ADR-0002). No libgit2 dependency.
- Commit message fields are split on ASCII control separators (`%x1f`); a commit
  message containing `0x1f` would be truncated on that field.
- Paths are assumed UTF-8 (`String::from_utf8_lossy`); non-UTF-8 paths display lossy.
- Adaptive playback uses commit stats already in the prefetch cache, falling back to
  the fixed rate — never worse than fixed, never a surprise.
- Timeline aggregation for very large histories is by day-bucket; the canvas renderer
  never creates DOM nodes per commit. The change map caps at the first 500 commits /
  150 files with the cap shown in the header.
- PR force-push versions depend on what GitHub still lets you fetch; versions that
  were garbage-collected report a clear "no longer fetchable" error.
- Repository-change detection polls HEAD every 4s while visible (cheap), rather than
  watching the filesystem.
- Chapter grouping is heuristic (message prefixes, >3-day gaps, merge boundaries);
  manual/AI chapter modes remain open extensions on the same presentation layer.
