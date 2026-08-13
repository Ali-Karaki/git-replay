// Store ↔ engine interaction tests with the IPC layer mocked: opening a repo
// transitions state correctly, and every failure lands in the visible error
// state — nothing may fail silently.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/ipc", () => ({
  api: {
    openRepository: vi.fn(),
    listBranches: vi.fn(),
    listTags: vi.fn(),
    getHeadState: vi.fn(),
    resolveReplay: vi.fn(),
    getRecentCommits: vi.fn(),
    getCommitDetail: vi.fn(),
    getFileDiff: vi.fn(),
    getTree: vi.fn(),
    getFileAtCommit: vi.fn(),
    getFileEvolution: vi.fn(),
    getSnapshotStats: vi.fn(),
    searchReplay: vi.fn(),
    getWorkingTree: vi.fn(),
    getWorkingFileDiff: vi.fn(),
    resolvePrReplay: vi.fn(),
    getCommitUrl: vi.fn(),
    getCacheInfo: vi.fn(),
    clearCache: vi.fn(),
  },
}));

import { api } from "../lib/ipc";
import { frameCount, useReplay } from "./replay";
import type { ReplayRange } from "../lib/types";

const mocked = vi.mocked(api, true);

const repoInfo = { id: 7, path: "C:/repos/demo", defaultBranch: "main", headSha: "abc" };
const range: ReplayRange = {
  baseSha: "base", baseTs: 0, headSha: "abc",
  commits: [
    { sha: "c1", parents: ["base"], subject: "one", body: "", author: { name: "a", email: "a" }, committer: { name: "a", email: "a" }, authorTs: 1, commitTs: 1 },
    { sha: "c2", parents: ["c1"], subject: "two", body: "", author: { name: "a", email: "a" }, committer: { name: "a", email: "a" }, authorTs: 2, commitTs: 2 },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  useReplay.setState({
    repo: null, range: null, branches: [], tags: [], headState: null,
    error: null, errorDetail: null, busy: false, recentRepos: [], session: null,
  });
});

describe("openRepo", () => {
  it("transitions to the range setup with refs and head state", async () => {
    mocked.openRepository.mockResolvedValue(repoInfo);
    mocked.listBranches.mockResolvedValue([{ name: "main", sha: "abc", isHead: true }]);
    mocked.listTags.mockResolvedValue([]);
    mocked.getHeadState.mockResolvedValue({ sha: "abc", branch: "main", dirty: false });

    const ok = await useReplay.getState().openRepo("C:/repos/demo");
    const s = useReplay.getState();
    expect(ok).toBe(true);
    expect(s.repo?.id).toBe(7);
    expect(s.range).toBeNull();
    expect(s.error).toBeNull();
    expect(s.branches).toHaveLength(1);
    expect(s.headState?.sha).toBe("abc");
    expect(s.recentRepos[0]).toBe("C:/repos/demo");
  });

  it("surfaces engine failures in the visible error state", async () => {
    mocked.openRepository.mockRejectedValue({ message: "not a Git working tree", detail: "raw stderr" });

    const ok = await useReplay.getState().openRepo("C:/repos/not-a-repo");
    const s = useReplay.getState();
    expect(ok).toBe(false);
    expect(s.repo).toBeNull();
    expect(s.error).toBe("not a Git working tree");
    expect(s.errorDetail).toBe("raw stderr");
    expect(s.busy).toBe(false);
  });

  it("surfaces failures from the follow-up ref calls", async () => {
    mocked.openRepository.mockResolvedValue(repoInfo);
    mocked.listBranches.mockRejectedValue({ message: "git failed" });
    mocked.listTags.mockResolvedValue([]);
    mocked.getHeadState.mockResolvedValue({ sha: "abc", branch: "main", dirty: false });

    const ok = await useReplay.getState().openRepo("C:/repos/demo");
    expect(ok).toBe(false);
    expect(useReplay.getState().error).toBe("git failed");
  });
});

describe("finishResolve", () => {
  it("computes the working-tree frame only when the head is checked out", () => {
    useReplay.setState({ repo: repoInfo, headState: { sha: "abc", branch: "main", dirty: false } });
    useReplay.getState().finishResolve(range, null);
    expect(useReplay.getState().hasWorkingTree).toBe(true);

    useReplay.getState().finishResolve({ ...range, headSha: "other" }, null);
    expect(useReplay.getState().hasWorkingTree).toBe(false);
  });

  it("saves a resumable session", () => {
    useReplay.setState({ repo: repoInfo, headState: { sha: "abc", branch: "main", dirty: false } });
    useReplay.getState().finishResolve(range, null);
    const session = useReplay.getState().session;
    expect(session?.repoPath).toBe("C:/repos/demo");
    expect(session?.headSha).toBe("abc");
    expect(frameCount(range, true)).toBe(4); // base + 2 commits + working tree
  });
});
