//! Application state: the opened-repository registry and the cache-backed
//! service layer. Tauri commands are thin async wrappers over these methods.

use crate::cache::CacheStore;
use crate::error::{AppError, ErrorKind};
use crate::git::types::*;
use crate::git::{self, Repo};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

/// Cached working-tree directory map: (repo_id, HEAD sha) → dir → entries.
#[derive(Default)]
struct WtCache {
    key: Option<(u32, String)>,
    dirs: HashMap<String, Vec<TreeEntry>>,
}

#[derive(Clone)]
pub struct AppState {
    repos: Arc<Mutex<HashMap<u32, Repo>>>,
    cache: Arc<Mutex<Option<CacheStore>>>,
    wt_cache: Arc<Mutex<WtCache>>,
    next_repo_id: Arc<AtomicU32>,
}

impl AppState {
    pub fn new(cache: Option<CacheStore>) -> Self {
        Self {
            repos: Arc::new(Mutex::new(HashMap::new())),
            cache: Arc::new(Mutex::new(cache)),
            wt_cache: Arc::new(Mutex::new(WtCache::default())),
            next_repo_id: Arc::new(AtomicU32::new(1)),
        }
    }

    fn cache(&self) -> std::sync::MutexGuard<'_, Option<CacheStore>> {
        self.cache.lock().expect("cache mutex poisoned")
    }

    fn repo(&self, id: u32) -> Result<Repo, AppError> {
        self.repos
            .lock()
            .expect("repos mutex poisoned")
            .get(&id)
            .cloned()
            .ok_or_else(|| AppError::new(ErrorKind::InvalidState, "repository is no longer open"))
    }

    // -- repository registry -------------------------------------------------

    pub fn open_repository(&self, path: &str) -> Result<RepoInfo, AppError> {
        let canonical = std::fs::canonicalize(path)
            .map_err(|_| AppError::new(ErrorKind::RepoNotFound, format!("repository not found at {path}")))?;

        // Reuse an existing handle for the same repo.
        {
            let repos = self.repos.lock().expect("repos mutex poisoned");
            if let Some(existing) = repos.values().find(|r| r.path == canonical) {
                return git::history::repo_info(existing);
            }
        }

        // Bare repos and non-worktrees are rejected with a clear message.
        let probe = git::run_git(&canonical, &["rev-parse", "--is-inside-work-tree"])
            .map_err(|e| AppError::git("could not inspect the directory", e))?;
        let inside = git::lossy(&probe);
        if !inside.contains("true") {
            return Err(AppError::new(
                ErrorKind::NotAWorkTree,
                "the selected folder is not a Git working tree",
            ));
        }

        let id = self.next_repo_id.fetch_add(1, Ordering::SeqCst);
        let repo = Repo { id, path: canonical };
        let info = git::history::repo_info(&repo)?;
        self.repos.lock().expect("repos mutex poisoned").insert(id, repo);
        Ok(info)
    }

    // -- refs ------------------------------------------------------------------

    pub fn branches(&self, repo_id: u32) -> Result<Vec<BranchInfo>, AppError> {
        git::history::list_branches(&self.repo(repo_id)?)
    }

    pub fn tags(&self, repo_id: u32) -> Result<Vec<TagInfo>, AppError> {
        git::history::list_tags(&self.repo(repo_id)?)
    }

    pub fn recent_commits(&self, repo_id: u32, limit: u32) -> Result<Vec<CommitMeta>, AppError> {
        let repo = self.repo(repo_id)?;
        git::history::recent_commits(&repo, limit)
    }

    // -- replay resolution ------------------------------------------------------

    pub fn resolve_replay(
        &self,
        repo_id: u32,
        base_ref: Option<String>,
        head_ref: Option<String>,
        use_merge_base: bool,
        first_parent: bool,
    ) -> Result<ReplayRange, AppError> {
        let repo = self.repo(repo_id)?;
        git::history::resolve_replay(&repo, base_ref.as_deref(), head_ref.as_deref(), use_merge_base, first_parent)
    }

    // -- commit data ------------------------------------------------------------

    pub fn commit_detail(&self, repo_id: u32, sha: &str, parent_index: Option<usize>) -> Result<CommitDetail, AppError> {
        let repo = self.repo(repo_id)?;
        if let Some(cache) = self.cache().as_ref() {
            if let Some(hit) = cache.get_detail(repo_id, sha, parent_index) {
                return Ok(hit);
            }
        }
        let meta = git::history::log_metas(&repo, &[&format!("{sha}^..{sha}")])?
            .into_iter()
            .next()
            .ok_or_else(|| AppError::new(ErrorKind::ObjectNotFound, format!("commit not found: {sha}")))?;
        let detail = git::changes::commit_detail(&repo, &meta, parent_index)?;
        if let Some(cache) = self.cache().as_ref() {
            cache.put_detail(repo_id, sha, parent_index, &detail);
            cache.put_commit(repo_id, &meta);
        }
        Ok(detail)
    }

    // -- diffs / snapshots --------------------------------------------------------

    pub fn file_diff(&self, repo_id: u32, sha: &str, path: &str, parent_index: Option<usize>) -> Result<FileDiff, AppError> {
        let repo = self.repo(repo_id)?;
        if let Some(cache) = self.cache().as_ref() {
            if let Some(hit) = cache.get_diff(repo_id, sha, parent_index, path) {
                return Ok(hit);
            }
        }
        let meta = git::history::log_metas(&repo, &[&format!("{sha}^..{sha}")])?
            .into_iter()
            .next()
            .ok_or_else(|| AppError::new(ErrorKind::ObjectNotFound, format!("commit not found: {sha}")))?;
        let diff = git::diff::file_diff(&repo, &meta, parent_index, path)?;
        if let Some(cache) = self.cache().as_ref() {
            cache.put_diff(repo_id, sha, parent_index, path, &diff);
        }
        Ok(diff)
    }

    pub fn tree(&self, repo_id: u32, treeish: &str) -> Result<Vec<TreeEntry>, AppError> {
        let repo = self.repo(repo_id)?;
        // Working-tree listings are synthesized from the index (spec 35).
        if let Some(dir) = treeish.strip_prefix("wt:") {
            return self.working_tree_dir(&repo, dir);
        }
        // Resolve to a tree SHA first so the cache key is content-addressed.
        // (`rev:path^{tree}` is not valid git syntax — peel in two steps.)
        let out = git::run_git(&repo.path, &["rev-parse", "--verify", treeish])
            .map_err(|e| AppError::git("could not read the directory tree", e))?;
        let resolved = git::trim_line(&git::lossy(&out)).to_string();
        let out = git::run_git(&repo.path, &["rev-parse", "--verify", &format!("{resolved}^{{tree}}")])
            .map_err(|e| AppError::git("could not read the directory tree", e))?;
        let tree_sha = git::trim_line(&git::lossy(&out)).to_string();
        if let Some(cache) = self.cache().as_ref() {
            if let Some(hit) = cache.get_tree(repo_id, &tree_sha) {
                return Ok(hit);
            }
        }
        let entries = git::snapshot::tree_entries(&repo, &tree_sha)?;
        if let Some(cache) = self.cache().as_ref() {
            cache.put_tree(repo_id, &tree_sha, &entries);
        }
        Ok(entries)
    }

    pub fn file_at_commit(&self, repo_id: u32, sha: &str, path: &str) -> Result<FileAtCommit, AppError> {
        let repo = self.repo(repo_id)?;
        // Working-tree frame: index version for tracked, disk for untracked.
        if sha == "WORKTREE" {
            return self.working_file(&repo, path);
        }
        // Blob contents are cached by blob SHA, so resolve first.
        let spec = format!("{sha}:{path}");
        let out = git::run_git(&repo.path, &["rev-parse", "--verify", &spec]).map_err(|e| {
            AppError::new(ErrorKind::ObjectNotFound, format!("path not found at this commit: {path}")).with_git(e)
        })?;
        let blob_sha = git::trim_line(&git::lossy(&out)).to_string();
        if let Some(cache) = self.cache().as_ref() {
            if let Some((content, size)) = cache.get_blob(repo_id, &blob_sha) {
                return build_file_at_commit(repo_id, &repo, sha, path, &blob_sha, content, size);
            }
        }
        let file = git::snapshot::file_at_commit(&repo, sha, path)?;
        if file.kind == FileKind::Text || file.kind == FileKind::Binary {
            if let Some(cache) = self.cache().as_ref() {
                let raw = git::snapshot::blob_data(&repo, &blob_sha)?;
                cache.put_blob(repo_id, &blob_sha, &raw, file.size);
            }
        }
        Ok(file)
    }

    pub fn snapshot_stats(&self, repo_id: u32, sha: &str) -> Result<SnapshotStats, AppError> {
        let repo = self.repo(repo_id)?;
        if let Some(cache) = self.cache().as_ref() {
            if let Some(hit) = cache.get_stats(repo_id, sha) {
                return Ok(hit);
            }
        }
        let stats = git::snapshot::snapshot_stats(&repo, sha)?;
        if let Some(cache) = self.cache().as_ref() {
            cache.put_stats(repo_id, sha, &stats);
        }
        Ok(stats)
    }

    // -- evolution / search -------------------------------------------------------

    pub fn file_evolution(&self, repo_id: u32, base: &str, head: &str, path: &str) -> Result<Vec<EvolutionEntry>, AppError> {
        let repo = self.repo(repo_id)?;
        if let Some(cache) = self.cache().as_ref() {
            if let Some(hit) = cache.get_evolution(repo_id, base, head, path) {
                return Ok(hit);
            }
        }
        let entries = git::evolution::file_evolution(&repo, base, head, path)?;
        if let Some(cache) = self.cache().as_ref() {
            cache.put_evolution(repo_id, base, head, path, &entries);
        }
        Ok(entries)
    }

    pub fn search(&self, repo_id: u32, base: &str, head: &str, query: &str, limit: u32) -> Result<Vec<SearchResult>, AppError> {
        let repo = self.repo(repo_id)?;
        git::search::search_replay(&repo, base, head, query, limit)
    }

    // -- working tree (spec 35) ------------------------------------------------------

    pub fn working_tree_frame(&self, repo_id: u32) -> Result<WorkingTreeFrame, AppError> {
        let repo = self.repo(repo_id)?;
        git::working_tree::working_tree_frame(&repo)
    }

    pub fn working_file_diff(&self, repo_id: u32, path: &str) -> Result<FileDiff, AppError> {
        let repo = self.repo(repo_id)?;
        git::working_tree::working_file_diff(&repo, path)
    }

    /// Working-tree directory listing for `dir` ("" = root), synthesized from
    /// the index (`ls-files --stage`) plus untracked files. Cached per
    /// (repo, HEAD) since the index only changes with the checkout.
    fn working_tree_dir(&self, repo: &Repo, dir: &str) -> Result<Vec<TreeEntry>, AppError> {
        let head = git::run_git(&repo.path, &["rev-parse", "HEAD"])
            .map_err(|e| AppError::git("could not read HEAD", e))?;
        let head = git::trim_line(&git::lossy(&head)).to_string();
        let mut guard = self.wt_cache.lock().expect("wt cache poisoned");
        if guard.key.as_ref() != Some(&(repo.id, head.clone())) {
            guard.dirs = build_wt_dirs(repo)?;
            guard.key = Some((repo.id, head));
        }
        Ok(guard.dirs.get(dir).cloned().unwrap_or_default())
    }

    /// File content in the working tree: index version for tracked paths
    /// (`git rev-parse :path`), disk content for untracked ones.
    fn working_file(&self, repo: &Repo, path: &str) -> Result<FileAtCommit, AppError> {
        if let Some(blob_sha) = git::working_tree::index_blob_sha(repo, path)? {
            let out = git::run_git(&repo.path, &["cat-file", "-s", &blob_sha])
                .map_err(|e| AppError::git("could not read file size", e))?;
            let size: u64 = git::trim_line(&git::lossy(&out)).parse().unwrap_or(0);
            let data = git::snapshot::blob_data(repo, &blob_sha)?;
            if let Some(cache) = self.cache().as_ref() {
                cache.put_blob(repo.id, &blob_sha, &data, size);
            }
            return Ok(file_from_bytes(path, &blob_sha, data, size));
        }
        // Untracked: read from disk.
        let data = std::fs::read(repo.path.join(path)).map_err(|e| AppError::io("could not read file", e))?;
        let size = data.len() as u64;
        Ok(file_from_bytes(path, "", data, size))
    }

    // -- head state / change detection (spec 34) ---------------------------------------

    pub fn head_state(&self, repo_id: u32) -> Result<HeadState, AppError> {
        let repo = self.repo(repo_id)?;
        git::working_tree::head_state(&repo)
    }

    // -- pull requests (spec 9.4, 20) ---------------------------------------------------

    pub fn resolve_pr(&self, repo_id: u32, input: &str, version: Option<&str>) -> Result<PrReplay, AppError> {
        let repo = self.repo(repo_id)?;
        git::pr::resolve_pr(&repo, input, version)
    }

    pub fn commit_url(&self, repo_id: u32, sha: &str) -> Result<Option<String>, AppError> {
        let repo = self.repo(repo_id)?;
        Ok(git::pr::commit_url(&repo, sha))
    }
}

/// Build the flat working-tree file list and group it into a nested
/// directory map (dir path → immediate entries, dirs included).
fn build_wt_dirs(repo: &Repo) -> Result<HashMap<String, Vec<TreeEntry>>, AppError> {
    // Index files: "<mode> <sha> <stage>\t<path>".
    let staged = git::run_git(&repo.path, &["ls-files", "--stage", "-z"])
        .map_err(|e| AppError::git("could not read the index", e))?;
    let mut flat: Vec<(String, String, String)> = Vec::new(); // (path, mode, sha)
    for row in staged.split(|&b| b == 0) {
        if row.is_empty() {
            continue;
        }
        let Some((head, path)) = split_tab(row) else { continue };
        let parts: Vec<&[u8]> = head.split(|&b| b == b' ').collect();
        if parts.len() < 2 {
            continue;
        }
        flat.push((git::lossy(path), git::lossy(parts[0]), git::lossy(parts[1])));
    }
    // Untracked files: no mode/sha.
    let untracked = git::run_git(&repo.path, &["ls-files", "--others", "--exclude-standard", "-z"])
        .map_err(|e| AppError::git("could not list untracked files", e))?;
    for path in untracked.split(|&b| b == 0) {
        if path.is_empty() {
            continue;
        }
        let path = git::lossy(path);
        if !flat.iter().any(|(p, _, _)| p == &path) {
            flat.push((path, "100644".to_string(), String::new()));
        }
    }

    // Nested map.
    let mut dirs: HashMap<String, Vec<TreeEntry>> = HashMap::new();
    dirs.insert(String::new(), Vec::new());
    for (path, mode, sha) in flat {
        let mut parts: Vec<&str> = path.split('/').collect();
        let name = parts.pop().unwrap_or_default();
        // Register every ancestor directory as an entry of its parent.
        let mut current = String::new();
        for part in &parts {
            let dir_entries = dirs.entry(current.clone()).or_default();
            let dir_key = if current.is_empty() { (*part).to_string() } else { format!("{current}/{part}") };
            if !dir_entries.iter().any(|e| e.name == *part && e.kind == "tree") {
                dir_entries.push(TreeEntry {
                    name: (*part).to_string(),
                    kind: "tree".into(),
                    mode: "040000".into(),
                    size: 0,
                    object: format!("wt:{dir_key}"),
                });
            }
            current = dir_key;
        }
        let dir_entries = dirs.entry(current.clone()).or_default();
        if !dir_entries.iter().any(|e| e.name == name) {
            dir_entries.push(TreeEntry {
                name: name.to_string(),
                kind: if mode.starts_with("160000") { "commit".into() } else { "blob".into() },
                mode: mode.clone(),
                size: 0,
                object: if mode.starts_with("160000") { sha } else { String::new() },
            });
        }
    }
    // Sort each dir: dirs first, then names.
    for entries in dirs.values_mut() {
        entries.sort_by(|a, b| {
            let ak = if a.kind == "tree" { 0 } else { 1 };
            let bk = if b.kind == "tree" { 0 } else { 1 };
            ak.cmp(&bk).then_with(|| a.name.cmp(&b.name))
        });
    }
    Ok(dirs)
}

fn split_tab(bytes: &[u8]) -> Option<(&[u8], &[u8])> {
    bytes.iter().position(|&b| b == b'\t').map(|i| (&bytes[..i], &bytes[i + 1..]))
}

/// Wrap raw bytes into the `FileAtCommit` shape (mode/symlink/binary sniff).
fn file_from_bytes(path: &str, blob_sha: &str, data: Vec<u8>, size: u64) -> FileAtCommit {
    use base64::Engine;
    if git::is_binary(&data) {
        return FileAtCommit {
            path: path.to_string(),
            blob_sha: blob_sha.to_string(),
            size,
            kind: FileKind::Binary,
            content: None,
            content_base64: Some(base64::engine::general_purpose::STANDARD.encode(&data)),
            symlink_target: None,
            submodule_sha: None,
        };
    }
    FileAtCommit {
        path: path.to_string(),
        blob_sha: blob_sha.to_string(),
        size,
        kind: FileKind::Text,
        content: Some(git::lossy(&data)),
        content_base64: None,
        symlink_target: None,
        submodule_sha: None,
    }
}

/// Rebuild a cached blob into the full `FileAtCommit` shape.
fn build_file_at_commit(
    repo_id: u32,
    repo: &Repo,
    sha: &str,
    path: &str,
    blob_sha: &str,
    content: Vec<u8>,
    size: u64,
) -> Result<FileAtCommit, AppError> {
    use base64::Engine;
    // Symlinks are tiny blobs whose content is the target; disambiguate via
    // the parent entry mode (one cached ls-tree call).
    let mode = git::snapshot::parent_entry_mode(repo, sha, path)
        .unwrap_or(None)
        .unwrap_or_else(|| "100644".to_string());
    let _ = repo_id;
    if mode.starts_with("120000") {
        return Ok(FileAtCommit {
            path: path.to_string(),
            blob_sha: blob_sha.to_string(),
            size,
            kind: FileKind::Symlink,
            content: None,
            content_base64: None,
            symlink_target: Some(git::lossy(&content).trim_end().to_string()),
            submodule_sha: None,
        });
    }
    if git::is_binary(&content) {
        return Ok(FileAtCommit {
            path: path.to_string(),
            blob_sha: blob_sha.to_string(),
            size,
            kind: FileKind::Binary,
            content: None,
            content_base64: Some(base64::engine::general_purpose::STANDARD.encode(&content)),
            symlink_target: None,
            submodule_sha: None,
        });
    }
    Ok(FileAtCommit {
        path: path.to_string(),
        blob_sha: blob_sha.to_string(),
        size,
        kind: FileKind::Text,
        content: Some(git::lossy(&content)),
        content_base64: None,
        symlink_target: None,
        submodule_sha: None,
    })
}
