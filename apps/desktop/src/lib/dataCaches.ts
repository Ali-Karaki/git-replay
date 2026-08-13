// Module-level query caches with in-flight dedup. Content-addressed where
// possible (blobs by sha, trees by tree sha, diffs by sha pair) so the same
// object is never fetched twice — even across history rewrites.

import { api } from "./ipc";
import type { CommitDetail, FileAtCommit, FileDiff, TreeEntry } from "./types";

interface Entry<T> {
  promise: Promise<T>;
}

function cached<T>(map: Map<string, Entry<T>>, key: string, load: () => Promise<T>): Promise<T> {
  const hit = map.get(key);
  if (hit) return hit.promise;
  const promise = load()
    .then((v) => {
      map.set(key, { promise: Promise.resolve(v) });
      return v;
    })
    .catch((e) => {
      map.delete(key); // don't cache failures
      throw e;
    });
  map.set(key, { promise });
  return promise;
}

// -- commit details ----------------------------------------------------------

const detailKey = (repoId: number, sha: string, parentIndex: number | null) =>
  `${repoId}|${sha}|${parentIndex ?? "def"}`;

const details = new Map<string, Entry<CommitDetail>>();

export function getCommitDetail(repoId: number, sha: string, parentIndex: number | null): Promise<CommitDetail> {
  return cached(details, detailKey(repoId, sha, parentIndex), () =>
    api.getCommitDetail(repoId, sha, parentIndex),
  );
}

/** Fire-and-forget prefetch for adjacent frames. */
export function prefetchCommit(repoId: number, sha: string, parentIndex: number | null): void {
  void getCommitDetail(repoId, sha, parentIndex);
}

// -- file diffs ----------------------------------------------------------------

const diffKey = (repoId: number, sha: string, parentIndex: number | null, path: string) =>
  `${repoId}|${sha}|${parentIndex ?? "def"}|${path}`;

const diffs = new Map<string, Entry<FileDiff>>();

export function getFileDiff(repoId: number, sha: string, path: string, parentIndex: number | null): Promise<FileDiff> {
  return cached(diffs, diffKey(repoId, sha, parentIndex, path), () =>
    api.getFileDiff(repoId, sha, path, parentIndex),
  );
}

// -- tree listings (content-addressed by tree sha) ------------------------------

const trees = new Map<string, Entry<TreeEntry[]>>();

export function getTree(repoId: number, treeish: string): Promise<TreeEntry[]> {
  const key = `${repoId}|${treeish}`;
  return cached(trees, key, () => api.getTree(repoId, treeish));
}

// -- files at a commit -----------------------------------------------------------

const files = new Map<string, Entry<FileAtCommit>>();

export function getFileAtCommit(repoId: number, sha: string, path: string): Promise<FileAtCommit> {
  const key = `${repoId}|${sha}|${path}`;
  return cached(files, key, () => api.getFileAtCommit(repoId, sha, path));
}

export function clearCaches(): void {
  details.clear();
  diffs.clear();
  trees.clear();
  files.clear();
}
