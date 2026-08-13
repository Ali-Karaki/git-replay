// Chapter heuristics (spec 21): prefix changes, time gaps, merge boundaries.
// Chapters are an alternate presentation — the raw commit list is untouched.

import { describe, expect, it } from "vitest";
import { computeChapters } from "./Timeline";
import type { CommitMeta, ReplayRange } from "../../lib/types";

function meta(subject: string, parents: string[] = [], commitTs = 1_700_000_000): CommitMeta {
  return {
    sha: subject, // unique enough for tests
    subject,
    parents,
    body: "",
    author: { name: "a", email: "a@x" },
    committer: { name: "c", email: "c@x" },
    authorTs: commitTs,
    commitTs,
  };
}

function makeRange(commits: CommitMeta[], hasWt = false): { range: ReplayRange; hasWt: boolean } {
  return {
    range: { baseSha: "base", baseTs: 0, headSha: commits.at(-1)?.sha ?? "base", commits },
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
    const chapters = computeChapters(range, hasWt);
    expect(chapters).toEqual([
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
    const chapters = computeChapters(range, hasWt);
    expect(chapters.map((c) => c.start)).toEqual([0, 1, 2]);
  });

  it("gives a merge its own chapter, then a fresh one after it", () => {
    const { range, hasWt } = makeRange([
      meta("feat work", ["base"]),
      meta("Merge branch 'x'", ["a", "b"]),
      meta("after merge", ["m"]),
    ]);
    const chapters = computeChapters(range, hasWt);
    expect(chapters.map((c) => c.start)).toEqual([0, 1, 2, 3]);
    expect(chapters[1].title).toBe("feat work");
    expect(chapters[2].title).toBe("Merge");
    expect(chapters[3].title).toBe("after merge");
  });

  it("appends the working-tree chapter", () => {
    const { range, hasWt } = makeRange([meta("one"), meta("two")], true);
    const chapters = computeChapters(range, hasWt);
    expect(chapters.at(-1)).toEqual({ start: 3, title: "Working Tree" });
  });
});
