# ADR-0003: SQLite as a derived cache, never a second source of truth

**Status:** accepted
**Date:** 2026-08-13

## Context

Diffing and metadata extraction over large histories is expensive. The spec calls for
SQLite caching with the invariant: "Deleting the SQLite database must never destroy
unique repository information."

## Decision

A single SQLite database in the OS cache directory stores derived data keyed by
canonical repo path and git object SHAs: commit metadata, per-commit file changes,
patches, blob contents, tree listings, snapshot stats, evolution results.

## Consequences

- The database is rebuildable from Git by construction — no schema stores anything not
  derivable by re-running plumbing commands.
- Blob/tree caching is content-addressed, so it survives history rewrites for any
  object that still exists.
- rusqlite `bundled` avoids a system SQLite dependency on Windows.
