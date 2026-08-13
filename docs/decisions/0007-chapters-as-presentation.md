# ADR-0007: Chapters are a presentation layer, never a rewrite

**Status:** accepted
**Date:** 2026-08-13

## Context

Bad commit messages ("fix2", "wip") hurt replay quality. The spec (§21)
allows grouped history — manual, heuristic, or AI-assisted — under one hard
invariant: raw history is always accessible and is never silently replaced.

## Decision

- Chapters are computed by a **pure heuristic** over the raw commit list:
  conventional-commit prefix changes, >3-day time gaps, and merge boundaries
  (a merge gets its own chapter; post-merge work starts fresh).
- They are drawn on the timeline as separators + labels over the raw marks,
  toggled off by default. Clicking a chapter jumps to its first commit.
- The raw commit list remains the only navigation model everywhere else.

## Consequences

- Invariant 3/4 hold structurally: chapters can't hide or reorder commits
  because the raw marks are always rendered underneath.
- The heuristic lives in `lib/timelineModel.ts` and is unit-tested.
- Manual chapter editing or AI summaries can be added later on the same
  presentation layer without touching the engine.
