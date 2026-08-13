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

export type FileStatus = "added" | "modified" | "deleted" | "renamed" | "copied" | "typeChanged" | "untracked";

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
  kind: "message" | "path" | "content";
}

export interface AppError {
  kind: string;
  message: string;
  detail: string | null;
}

export interface WorkingTreeFrame {
  files: FileChange[];
  stats: CommitStats;
  untracked: number;
}

export interface PrVersion {
  number: number;
  afterSha: string;
  beforeSha: string | null;
  createdAt: number | null;
}

export interface PrReplay {
  title: string;
  number: number;
  url: string;
  range: ReplayRange;
  versions: PrVersion[];
  resolvedVersion: number | null;
}

export interface HeadState {
  sha: string;
  branch: string | null;
  dirty: boolean;
}

export interface CacheInfo {
  path: string;
  sizeBytes: number;
}

export interface ChatSettings {
  provider: string;
  model: string;
  baseUrl: string;
  hasKey: boolean;
}

export const CHAT_PROVIDERS: Array<{ id: string; label: string; defaultModel: string }> = [
  { id: "anthropic", label: "Anthropic (Claude)", defaultModel: "claude-opus-5" },
  { id: "deepseek", label: "DeepSeek", defaultModel: "deepseek-chat" },
  { id: "openai", label: "OpenAI", defaultModel: "" },
  { id: "openrouter", label: "OpenRouter", defaultModel: "" },
  { id: "custom_openai", label: "Custom (OpenAI-compatible)", defaultModel: "" },
  { id: "custom_anthropic", label: "Custom (Anthropic-compatible)", defaultModel: "" },
];

export interface ChatEvent {
  id: string;
  text?: string;
  error?: string;
  done?: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  error?: boolean;
}
