# ADR-0002: System Git CLI instead of a git library

**Status:** accepted
**Date:** 2026-08-13

## Context

The engine needs the commit graph, merge-bases, trees, blobs, diffs with rename
detection, binary detection, and submodule semantics. Two options: embed a library
(`git2`, `gix`) or shell out to the system Git CLI.

## Decision

Shell out to **the system Git CLI**, using plumbing commands with machine-readable
(`-z`) output only.

## Rationale

- The spec: "Use native Git operations… where the Git CLI already provides correct
  behavior" and "System Git CLI initially".
- libgit2 diverges from git in subtle ways (rename detection defaults, merge semantics,
  attribute handling); git is the source of truth by definition.
- No FFI/build complexity on Windows; large-binary handling (LFS, partial clone) comes
  for free via the user's git.

## Consequences

- Git must be installed (acceptable; the audience is developers).
- IPC process spawning per operation — mitigated by SQLite caching and per-call
  batching (`cat-file --batch`, single `log -z` calls for metadata).
- Careful argument passing (no shell, no pathspec escaping — tree listings are
  addressed by object SHA to sidestep this).
