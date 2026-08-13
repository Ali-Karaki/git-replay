// Domain model mirroring the Rust engine's serialized types.
// React components consume these — never raw shell output.

export interface Identity {
  name: string;
  email: string;
}

export interface CommitMeta {
  sha: string;
  parents: string[];
  author: Identity;
  committer: Identity;
  authorTs: number;
  commitTs: number;
  subject: string;
  body: string;
}

export type FileStatus = "added" | "modified" | "deleted" | "renamed" | "copied" | "typeChanged";

export interface FileChange {
  oldPath: string | null;
  newPath: string;
  status: FileStatus;
  similarity: number | null;
  additions: number;
  deletions: number;
  binary: boolean;
  whitespaceOnly: boolean;
}

export interface CommitStats {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface CommitDetail {
  meta: CommitMeta;
  stats: CommitStats;
  files: FileChange[];
}

export interface BranchInfo {
  name: string;
  sha: string;
  isHead: boolean;
}

export interface TagInfo {
  name: string;
  sha: string;
}

export interface RepoInfo {
  id: number;
  path: string;
  defaultBranch: string | null;
  headSha: string;
}

export interface ReplayRange {
  baseSha: string;
  baseTs: number;
  headSha: string;
  commits: CommitMeta[];
}

export interface TreeEntry {
  name: string;
  kind: "blob" | "tree" | "commit";
  mode: string;
  size: number;
  object: string;
}

export interface FileDiff {
  patch: string | null;
  binary: boolean;
}

export type FileKind = "text" | "binary" | "symlink" | "submodule";

export interface FileAtCommit {
  path: string;
  blobSha: string;
  size: number;
  kind: FileKind;
  content: string | null;
  contentBase64: string | null;
  symlinkTarget: string | null;
  submoduleSha: string | null;
}

export interface EvolutionEntry {
  sha: string;
  subject: string;
  commitTs: number;
  status: FileStatus;
  oldPath: string | null;
  newPath: string;
  similarity: number | null;
  additions: number;
  deletions: number;
}

export interface SnapshotStats {
  files: number;
  dirs: number;
  loc: number | null;
}

export interface SearchResult {
  sha: string;
  subject: string;
  commitTs: number;
}

export interface AppError {
  kind: string;
  message: string;
  detail: string | null;
}
