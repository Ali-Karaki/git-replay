// Typed wrappers over the Tauri command surface (Rust snake_case args are
// converted from the camelCase keys automatically by Tauri v2).

import { invoke } from "@tauri-apps/api/core";
import type {
  BranchInfo, CommitDetail, CommitMeta, EvolutionEntry, FileAtCommit,
  FileDiff, ReplayRange, RepoInfo, SearchResult, SnapshotStats, TagInfo, TreeEntry,
} from "./types";

export const api = {
  openRepository(path: string): Promise<RepoInfo> {
    return invoke("open_repository", { path });
  },
  listBranches(repoId: number): Promise<BranchInfo[]> {
    return invoke("list_branches", { repoId });
  },
  listTags(repoId: number): Promise<TagInfo[]> {
    return invoke("list_tags", { repoId });
  },
  getRecentCommits(repoId: number, limit = 300): Promise<CommitMeta[]> {
    return invoke("get_recent_commits", { repoId, limit });
  },
  resolveReplay(repoId: number, opts: {
    baseRef: string | null;
    headRef: string | null;
    useMergeBase: boolean;
    firstParent: boolean;
  }): Promise<ReplayRange> {
    return invoke("resolve_replay", { repoId, ...opts });
  },
  getCommitDetail(repoId: number, sha: string, parentIndex: number | null): Promise<CommitDetail> {
    return invoke("get_commit_detail", { repoId, sha, parentIndex });
  },
  getFileDiff(repoId: number, sha: string, path: string, parentIndex: number | null): Promise<FileDiff> {
    return invoke("get_file_diff", { repoId, sha, path, parentIndex });
  },
  getTree(repoId: number, treeish: string): Promise<TreeEntry[]> {
    return invoke("get_tree", { repoId, treeish });
  },
  getFileAtCommit(repoId: number, sha: string, path: string): Promise<FileAtCommit> {
    return invoke("get_file_at_commit", { repoId, sha, path });
  },
  getFileEvolution(repoId: number, base: string, head: string, path: string): Promise<EvolutionEntry[]> {
    return invoke("get_file_evolution", { repoId, base, head, path });
  },
  getSnapshotStats(repoId: number, sha: string): Promise<SnapshotStats> {
    return invoke("get_snapshot_stats", { repoId, sha });
  },
  searchReplay(repoId: number, base: string, head: string, query: string, limit = 50): Promise<SearchResult[]> {
    return invoke("search_replay", { repoId, base, head, query, limit });
  },
};
