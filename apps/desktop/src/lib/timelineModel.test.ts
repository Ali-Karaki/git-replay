// Timeline geometry (aggregation) + chapter heuristics — the pure model
// behind the canvas (ADR-0004).

import { describe, expect, it } from "vitest";
import {
  buildTimelineLayout,
  computeChapters,
  FIT_ZOOM_START,
  MAX_PX_PER_COMMIT,
  MIN_PX_PER_COMMIT,
  MIN_ZOOM_PX,
  nextZoomIn,
  nextZoomOut,
  TIMELINE_PAD,
  ZOOM_STEP,
} from "./timelineModel";
import type { CommitMeta, ReplayRange } from "./types";

function meta(subject: string, parents: string[] = [], commitTs = 1_700_000_000): CommitMeta {
  return {
    sha: subject,
    subject,
    parents,
    body: "",
    author: { name: "a", email: "a@x" },
    committer: { name: "c", email: "c@x" },
    authorTs: commitTs,
    commitTs,
  };
}

function makeRange(commits: CommitMeta[], hasWt = false, baseTs = 0): { range: ReplayRange; hasWt: boolean } {
  return {
    range: { baseSha: "base", baseTs, headSha: commits.at(-1)?.sha ?? "base", commits },
    hasWt,
  };
}

describe("computeChapters", () => {
  it("starts a chapter on the first commit and on prefix changes", () => {
    const { range, hasWt } = makeRange([
      meta("feat: add thing"),
      meta("feat: add other thing"),
      meta("fix: bug"),
      meta("fix: another bug"),
    ]);
    expect(computeChapters(range, hasWt)).toEqual([
      { start: 0, title: "Base" },
      { start: 1, title: "Feat" },
      { start: 3, title: "Fix" },
    ]);
  });

  it("starts a chapter after a long time gap", () => {
    const { range, hasWt } = makeRange([
      meta("work", ["base"], 1_700_000_000),
      meta("work", ["x"], 1_700_000_000 + 10 * 86_400), // +10 days
    ]);
    expect(computeChapters(range, hasWt).map((c) => c.start)).toEqual([0, 1, 2]);
  });

  it("gives a merge its own chapter, then a fresh one after it", () => {
    const { range, hasWt } = makeRange([
      meta("feat work", ["base"]),
      meta("Merge branch 'x'", ["a", "b"]),
      meta("after merge", ["m"]),
    ]);
    const chapters = computeChapters(range, hasWt);
    expect(chapters.map((c) => c.start)).toEqual([0, 1, 2, 3]);
    expect(chapters[2].title).toBe("Merge");
  });

  it("appends the working-tree chapter", () => {
    const { range, hasWt } = makeRange([meta("one"), meta("two")], true);
    expect(computeChapters(range, hasWt).at(-1)).toEqual({ start: 3, title: "Working Tree" });
  });
});

describe("buildTimelineLayout", () => {
  const commits = Array.from({ length: 100 }, (_, i) => meta(`c${i}`, ["p"], 1_700_000_000 + i * 3600));

  it("fits frames to width in fit mode", () => {
    const { range, hasWt } = makeRange(commits);
    const layout = buildTimelineLayout(range, hasWt, 1000, "fit");
    expect(layout.aggregated).toBe(false);
    // 101 frames across 968 usable px ≈ 9.58 px each.
    expect(layout.xOf(100)).toBeCloseTo(1000 - TIMELINE_PAD, 0);
    expect(layout.frameAt(layout.xOf(50))).toBe(50);
  });

  it("aggregates into day buckets when marks get too dense", () => {
    const { range, hasWt } = makeRange(commits);
    const layout = buildTimelineLayout(range, hasWt, 300, "fit");
    expect(layout.aggregated).toBe(true);
    const buckets = layout.buckets;
    expect(buckets).not.toBeNull();
    if (!buckets) return;
    const total = buckets.reduce((s, b) => s + b.count, 0);
    expect(total).toBe(101); // base + 100 commits, all bucketed
    // frameAt maps into a bucket's first index.
    const idx = layout.frameAt(TIMELINE_PAD + 1);
    expect(idx).toBe(buckets[0].firstIndex);
  });

  it("never aggregates when zoomed in", () => {
    const { range, hasWt } = makeRange(commits);
    const layout = buildTimelineLayout(range, hasWt, 300, 10);
    expect(layout.aggregated).toBe(false);
    expect(layout.pxPer).toBe(10);
  });

  it("includes the working-tree frame in the last bucket", () => {
    const { range, hasWt } = makeRange([meta("one")], true);
    // Narrow canvas: 2 frames must aggregate into day buckets.
    const layout = buildTimelineLayout(range, hasWt, 36, "fit");
    expect(layout.aggregated).toBe(true);
    const last = layout.buckets?.at(-1);
    expect(last).toBeDefined();
    if (!last) return;
    expect(last.lastIndex).toBe(2); // base=0, commit=1, working tree=2
    expect(layout.xOf(2)).toBeGreaterThan(TIMELINE_PAD);
  });

  it("clamps zoom to the max px-per-commit", () => {
    const { range, hasWt } = makeRange([meta("one")]);
    const layout = buildTimelineLayout(range, hasWt, 1000, 999);
    expect(layout.aggregated).toBe(false);
    expect(layout.pxPer).toBeLessThanOrEqual(48);
    // With one commit and huge zoom, the marks stay inside the canvas.
    expect(layout.xOf(1)).toBeLessThan(1000);
  });

  it("uses the minimum aggregation threshold", () => {
    expect(MIN_PX_PER_COMMIT).toBe(3);
  });

  it("pans when zoomed in (scroll offset shifts and clamps)", () => {
    const { range, hasWt } = makeRange(commits);
    const layout = buildTimelineLayout(range, hasWt, 300, 10, 50);
    expect(layout.aggregated).toBe(false);
    // xOf shifts by the scroll offset.
    expect(layout.xOf(0)).toBe(TIMELINE_PAD - 50);
    // frameAt inverts the offset.
    expect(layout.frameAt(TIMELINE_PAD - 50)).toBe(0);
    // Scroll clamps at the content end.
    const clamped = buildTimelineLayout(range, hasWt, 300, 10, 99999);
    expect(clamped.frameAt(300 - TIMELINE_PAD)).toBeLessThanOrEqual(100);
  });
});

describe("nextZoomIn / nextZoomOut", () => {
  it("zooms in from fit using the start size", () => {
    expect(nextZoomIn("fit")).toBe(FIT_ZOOM_START * ZOOM_STEP);
  });

  it("clamps zoom-in at the max px-per-commit", () => {
    expect(nextZoomIn(MAX_PX_PER_COMMIT)).toBe(MAX_PX_PER_COMMIT);
    expect(nextZoomIn(MAX_PX_PER_COMMIT - 1)).toBe(MAX_PX_PER_COMMIT);
  });

  it("snaps zoom-out to fit below the minimum", () => {
    expect(nextZoomOut(MIN_ZOOM_PX)).toBe("fit");
    expect(nextZoomOut(MIN_ZOOM_PX * ZOOM_STEP)).toBe(MIN_ZOOM_PX);
  });
});
