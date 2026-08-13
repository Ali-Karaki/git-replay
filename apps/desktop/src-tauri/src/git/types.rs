//! Domain model shared with the frontend.
//!
//! React components consume these types over IPC — never raw shell output.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub name: String,
    pub email: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitMeta {
    pub sha: String,
    pub parents: Vec<String>,
    pub author: Identity,
    pub committer: Identity,
    /// Unix seconds.
    pub author_ts: i64,
    /// Unix seconds.
    pub commit_ts: i64,
    pub subject: String,
    pub body: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    TypeChanged,
    /// A file that exists only in the working tree (working-tree frame).
    Untracked,
}

impl FileStatus {
    pub fn from_git_letter(letter: u8) -> Self {
        match letter {
            b'A' => FileStatus::Added,
            b'D' => FileStatus::Deleted,
            b'R' => FileStatus::Renamed,
            b'C' => FileStatus::Copied,
            b'T' => FileStatus::TypeChanged,
            _ => FileStatus::Modified, // M, U, X, ...
        }
    }

    /// Short label for the UI.
    pub fn label(self) -> &'static str {
        match self {
            FileStatus::Added => "created",
            FileStatus::Modified => "modified",
            FileStatus::Deleted => "deleted",
            FileStatus::Renamed => "moved",
            FileStatus::Copied => "copied",
            FileStatus::TypeChanged => "type changed",
            FileStatus::Untracked => "untracked",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub old_path: Option<String>,
    pub new_path: String,
    pub status: FileStatus,
    /// Git similarity score 0-100 for renames/copies.
    pub similarity: Option<u8>,
    /// -1 when binary.
    pub additions: i64,
    /// -1 when binary.
    pub deletions: i64,
    pub binary: bool,
    /// True when the only differences are whitespace (`--ignore-all-space` numstat is 0/0).
    pub whitespace_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitStats {
    pub files_changed: u32,
    pub insertions: u64,
    pub deletions: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetail {
    pub meta: CommitMeta,
    pub stats: CommitStats,
    pub files: Vec<FileChange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub sha: String,
    pub is_head: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagInfo {
    pub name: String,
    pub sha: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    pub id: u32,
    pub path: String,
    /// Symbolic name of HEAD's branch, when HEAD is attached.
    pub default_branch: Option<String>,
    pub head_sha: String,
}

/// A resolved replay range: `[base] + commits` are the frames, oldest first.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayRange {
    pub base_sha: String,
    /// Commit timestamp of the base (for timeline aggregation).
    pub base_ts: i64,
    pub head_sha: String,
    /// Topologically ordered, oldest first. Excludes the base commit.
    pub commits: Vec<CommitMeta>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeEntry {
    pub name: String,
    /// "blob" | "tree" | "commit" (commit = submodule).
    pub kind: String,
    /// Octal mode string, e.g. "100644", "120000" (symlink), "160000" (submodule).
    pub mode: String,
    /// Blob size in bytes (0 for trees/submodules).
    pub size: u64,
    /// Object id: blob sha, tree sha, or the submodule's recorded commit sha.
    pub object: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    /// Raw unified diff text (git output). None for binary files.
    pub patch: Option<String>,
    pub binary: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileKind {
    Text,
    Binary,
    Symlink,
    Submodule,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAtCommit {
    pub path: String,
    pub blob_sha: String,
    pub size: u64,
    pub kind: FileKind,
    /// Text content (lossy UTF-8) for Text/Symlink kinds.
    pub content: Option<String>,
    /// Base64 for Binary kind (used to render images as data URLs).
    pub content_base64: Option<String>,
    /// Symlink target.
    pub symlink_target: Option<String>,
    /// Recorded submodule commit sha.
    pub submodule_sha: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvolutionEntry {
    pub sha: String,
    pub subject: String,
    pub commit_ts: i64,
    pub status: FileStatus,
    pub old_path: Option<String>,
    pub new_path: String,
    pub similarity: Option<u8>,
    /// -1 when binary.
    pub additions: i64,
    /// -1 when binary.
    pub deletions: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotStats {
    /// Blobs + submodule entries.
    pub files: u64,
    pub dirs: u64,
    /// Lines of code across text files; None when the tree is too large to count cheaply.
    pub loc: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub sha: String,
    pub subject: String,
    pub commit_ts: i64,
    /// How the commit matched: "message", "path", or "content" (pickaxe).
    pub kind: String,
}

/// The synthetic "Working Tree" frame: HEAD → staged + unstaged changes
/// (spec 35). Present only while the replay's head is the repo's HEAD.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkingTreeFrame {
    pub files: Vec<FileChange>,
    pub stats: CommitStats,
    pub untracked: usize,
}

/// A force-pushed version of a PR (spec 20), observed via the GitHub API.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrVersion {
    /// Sequence number, 1 = oldest observed.
    pub number: usize,
    /// SHA of the version's head commit.
    pub after_sha: String,
    /// SHA of the previous head (None for the first observed version).
    pub before_sha: Option<String>,
    pub created_at: Option<i64>,
}

/// A resolved PR replay: the range plus PR metadata for the header.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrReplay {
    pub title: String,
    pub number: u64,
    pub url: String,
    pub range: ReplayRange,
    /// Force-push versions, oldest first (includes the current head as last).
    pub versions: Vec<PrVersion>,
    /// The version this replay was resolved at (None = current head).
    pub resolved_version: Option<usize>,
}

/// Lightweight HEAD identity, used for repository-change detection.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeadState {
    pub sha: String,
    pub branch: Option<String>,
    pub dirty: bool,
}

/// Where the derived cache lives and how big it is (settings page).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheInfo {
    pub path: String,
    pub size_bytes: u64,
}
