// Store logic tests (spec 48): frame math, index clamping, playback
// boundaries — the navigation invariants the replay experience depends on.

import { beforeEach, describe, expect, it } from "vitest";
import type { CommitMeta, ReplayRange } from "../lib/types";
import { frameCommit, frameCount, frameSha, useReplay } from "./replay";

function meta(sha: string, parents: string[] = [], subject = "subject"): CommitMeta {
  return {
    sha,
    parents,
    subject,
    body: "",
    author: { name: "a", email: "a@x" },
    committer: { name: "c", email: "c@x" },
    authorTs: 0,
    commitTs: 0,
  };
}

const range: ReplayRange = {
  baseSha: "base0000",
  baseTs: 0,
  headSha: "c3",
  commits: [meta("c1", ["base0000"], "one"), meta("c2", ["c1"], "two"), meta("c3", ["c2"], "three")],
};

beforeEach(() => {
  useReplay.setState({
    repo: null,
    range: null,
    hasWorkingTree: false,
    index: 0,
    playing: false,
    headState: null,
    wtFrame: null,
    pr: null,
    selectedFile: null,
    mergeParent: 0,
  });
});

describe("frame math", () => {
  it("counts base + commits (+ working tree)", () => {
    expect(frameCount(range, false)).toBe(4);
    expect(frameCount(range, true)).toBe(5);
  });

  it("maps indices to shas", () => {
    expect(frameSha(range, 0)).toBe("base0000");
    expect(frameSha(range, 1)).toBe("c1");
    expect(frameSha(range, 3)).toBe("c3");
    expect(frameSha(range, 4, true)).toBe("WORKTREE");
    // Out-of-range indices clamp to the last commit when there is no wt frame.
    expect(frameSha(range, 99)).toBe("c3");
  });

  it("returns null commits for base and working-tree frames", () => {
    expect(frameCommit(range, 0)).toBeNull();
    expect(frameCommit(range, 4)).toBeNull();
    expect(frameCommit(range, 2)?.sha).toBe("c2");
  });
});

describe("index navigation", () => {
  beforeEach(() => {
    useReplay.setState({ range, hasWorkingTree: false });
  });

  it("clamps at both ends", () => {
    useReplay.getState().setIndex(99);
    expect(useReplay.getState().index).toBe(3);
    useReplay.getState().setIndex(-5);
    expect(useReplay.getState().index).toBe(0);
  });

  it("steps by delta with clamping", () => {
    useReplay.setState({ index: 1 });
    useReplay.getState().step(5);
    expect(useReplay.getState().index).toBe(3);
    useReplay.getState().step(-5);
    expect(useReplay.getState().index).toBe(0);
  });

  it("pauses playback when reaching the last frame", () => {
    useReplay.setState({ index: 2, playing: true });
    useReplay.getState().setIndex(3);
    expect(useReplay.getState().playing).toBe(false);
  });

  it("restarts from the base when play is pressed at the end", () => {
    useReplay.setState({ index: 3, playing: false });
    useReplay.getState().setPlaying(true);
    expect(useReplay.getState().index).toBe(0);
    expect(useReplay.getState().playing).toBe(true);
  });

  it("reaches the working-tree frame as the last frame", () => {
    useReplay.setState({ hasWorkingTree: true, index: 3 });
    useReplay.getState().setIndex(4);
    expect(useReplay.getState().index).toBe(4);
    expect(frameSha(range, 4, true)).toBe("WORKTREE");
  });

  it("resets the merge parent when moving frames", () => {
    useReplay.setState({ index: 0, mergeParent: 1 });
    useReplay.getState().setIndex(1);
    expect(useReplay.getState().mergeParent).toBe(0);
  });
});
