# ADR-0005: Synthetic Working Tree frame

**Status:** accepted
**Date:** 2026-08-13

## Context

Git replay is commit-based, but developers also want to replay work in
progress. The spec (§35) asks for a synthetic final frame representing
HEAD → working tree without compromising the commit replay model.

## Decision

When the replay's head equals the repository's checked-out commit, append a
**Working Tree frame** that is computed entirely from git's index and worktree
state:

- Changes: `git diff HEAD` (+ untracked files from `ls-files --others`);
  untracked patches are synthesized as all-added diffs from disk.
- Snapshot: the index (`ls-files --stage`) plus untracked files, grouped into
  a virtual directory map — no tree objects are fabricated. Files resolve to
  their index blob (`rev-parse :path`) or disk content.
- The frame disappears automatically when HEAD changes (recomputed on
  repository refresh).

## Consequences

- The working tree is a *frame*, not a special mode: Step/Snapshot/File views
  work unchanged, with `WORKTREE`/`wt:` as sentinel shas in the service layer.
- The commit replay model is untouched; the frame exists only at the boundary.
- Virtual listings are cached per (repo, HEAD) and rebuilt when the checkout
  moves.
