//! Application state: the opened-repository registry and the cache-backed
//! service layer. Tauri commands are thin async wrappers over these methods.

use crate::cache::CacheStore;
use crate::error::{AppError, ErrorKind};
use crate::git::types::*;
use crate::git::{self, Repo};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct AppState {
    repos: Arc<Mutex<HashMap<u32, Repo>>>,
    cache: Arc<Mutex<Option<CacheStore>>>,
    next_repo_id: Arc<AtomicU32>,
}

impl AppState {
    pub fn new(cache: Option<CacheStore>) -> Self {
        Self {
            repos: Arc::new(Mutex::new(HashMap::new())),
            cache: Arc::new(Mutex::new(cache)),
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
        // Resolve to a tree SHA first so the cache key is content-addressed.
        let out = git::run_git(&repo.path, &["rev-parse", "--verify", &format!("{treeish}^{{tree}}")])
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
