// Module-level query caches with in-flight dedup. Content-addressed where
// possible (blobs by sha, trees by tree sha, diffs by sha pair) so the same
// object is never fetched twice — even across history rewrites.

import { api } from "./ipc";
import type { CommitDetail, FileAtCommit, FileDiff, TreeEntry } from "./types";

interface Entry<T> {
  promise: Promise<T>;
  value?: T;
}

function cached<T>(map: Map<string, Entry<T>>, key: string, load: () => Promise<T>): Promise<T> {
  const hit = map.get(key);
  if (hit) return hit.promise;
  const entry: Entry<T> = { promise: Promise.resolve(undefined as unknown as T) };
  const promise = load()
    .then((v) => {
      entry.value = v;
      entry.promise = Promise.resolve(v);
      return v;
    })
    .catch((e) => {
      map.delete(key); // don't cache failures
      throw e;
    });
  entry.promise = promise;
  map.set(key, entry);
  return promise;
}

function cachedValue<T>(map: Map<string, Entry<T>>, key: string): T | null {
  const entry = map.get(key);
  return entry?.value ?? null;
}

// -- commit details ----------------------------------------------------------

// The engine treats a null parent index as the first parent (0), so the cache
// keys must too — otherwise the same detail is fetched twice under "def" and
// "0" keys, and callers that pass 0 (adaptive playback) miss entries written
// by callers that pass null (the views).
const detailKey = (repoId: number, sha: string, parentIndex: number | null) => `${repoId}|${sha}|${parentIndex ?? 0}`;

const details = new Map<string, Entry<CommitDetail>>();

export function getCommitDetail(repoId: number, sha: string, parentIndex: number | null): Promise<CommitDetail> {
  return cached(details, detailKey(repoId, sha, parentIndex), () => api.getCommitDetail(repoId, sha, parentIndex));
}

/** Synchronous peek — used by adaptive playback to size dwell times. */
export function getCachedCommitDetail(repoId: number, sha: string, parentIndex: number | null): CommitDetail | null {
  return cachedValue(details, detailKey(repoId, sha, parentIndex));
}

/** Fire-and-forget prefetch for adjacent frames. */
export function prefetchCommit(repoId: number, sha: string, parentIndex: number | null): void {
  // Prefetch failures are by definition not user-facing — never leave an
  // unhandled rejection behind during repo transitions.
  getCommitDetail(repoId, sha, parentIndex).catch(() => undefined);
}

// -- file diffs ----------------------------------------------------------------

const diffKey = (repoId: number, sha: string, parentIndex: number | null, path: string) =>
  `${repoId}|${sha}|${parentIndex ?? 0}|${path}`;

const diffs = new Map<string, Entry<FileDiff>>();

export function getFileDiff(repoId: number, sha: string, path: string, parentIndex: number | null): Promise<FileDiff> {
  return cached(diffs, diffKey(repoId, sha, parentIndex, path), () => api.getFileDiff(repoId, sha, path, parentIndex));
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
