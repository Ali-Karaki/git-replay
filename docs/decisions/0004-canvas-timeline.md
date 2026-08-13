# ADR-0004: Timeline rendered on canvas

**Status:** accepted
**Date:** 2026-08-13

## Context

The timeline must scale from 5 commits to 100k+ without freezing, support scrubbing,
hover tooltips, zoom, and merge/branch styling. DOM-per-commit approaches require
virtualization and churn during playback.

## Decision

Render the timeline on a single **HTML canvas** (one redraw per frame via
requestAnimationFrame). Marks are drawn per commit; when marks drop below a pixel
threshold the timeline aggregates into day buckets automatically. Zoom multiplies
pixels-per-commit; a "fit" mode computes it from width.

## Consequences

- 10k commits = one canvas paint, not 10k DOM nodes.
- Hover/drag hit-testing is arithmetic on the same layout model used for painting.
- Tooltips are a single positioned DOM overlay rather than per-node popovers.
- Trade-off: no DOM-based accessibility per commit node; keyboard stepping (←/→) and
  the command palette are the accessible paths to any commit.
