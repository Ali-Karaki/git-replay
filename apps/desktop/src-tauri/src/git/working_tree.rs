//! The synthetic Working Tree frame: HEAD → staged + unstaged changes.
//! Untracked files appear as their own status; diffs for tracked files come
//! from `git diff HEAD`, untracked patches are synthesized from disk.

use super::changes::{parse_name_status, parse_numstat, parse_shortstat};
use super::{is_binary, lossy, run_git, Repo};
use crate::error::AppError;
use crate::git::types::{FileChange, FileStatus, WorkingTreeFrame};

/// Changes in the working tree relative to HEAD (staged + unstaged).
pub fn working_tree_frame(repo: &Repo) -> Result<WorkingTreeFrame, AppError> {
    // Tracked changes.
    let names = {
        let args: Vec<&str> = vec!["diff", "HEAD", "--name-status", "-z", "-M", "-C"];
        let out = run_git(&repo.path, &args).map_err(|e| AppError::git("could not read working tree changes", e))?;
        parse_name_status(&out)
    };
    let numstat = {
        let args: Vec<&str> = vec!["diff", "HEAD", "--numstat", "-z", "-M", "-C"];
        let out = run_git(&repo.path, &args).map_err(|e| AppError::git("could not read working tree changes", e))?;
        parse_numstat(&out)
    };
    let stats = {
        let args: Vec<&str> = vec!["diff", "HEAD", "--shortstat", "-M"];
        let out = run_git(&repo.path, &args).map_err(|e| AppError::git("could not read working tree changes", e))?;
        parse_shortstat(&lossy(&out))
    };

    let mut files = Vec::with_capacity(names.len());
    for (idx, n) in names.into_iter().enumerate() {
        let (additions, deletions) = match numstat.get(idx) {
            Some((a, d, _)) => (*a, *d),
            None => (-1, -1),
        };
        let binary = additions < 0 || deletions < 0;
        files.push(FileChange {
            old_path: n.old_path,
            new_path: n.new_path,
            status: n.status,
            similarity: n.similarity,
            additions: if binary { 0 } else { additions },
            deletions: if binary { 0 } else { deletions },
            binary,
            whitespace_only: false,
        });
    }

    // Untracked files.
    let untracked = {
        let args: Vec<&str> = vec!["ls-files", "--others", "--exclude-standard", "-z"];
        let out = run_git(&repo.path, &args).map_err(|e| AppError::git("could not list untracked files", e))?;
        let mut list: Vec<String> = lossy(&out).split('\0').filter(|s| !s.is_empty()).map(String::from).collect();
        list.sort();
        list
    };
    let untracked_count = untracked.len();
    for path in untracked {
        let full = repo.path.join(&path);
        let (size, binary) = match std::fs::metadata(&full) {
            Ok(m) if m.is_file() => {
                let data = std::fs::read(&full).unwrap_or_default();
                (data.len() as u64, is_binary(&data))
            }
            _ => (0, false),
        };
        files.push(FileChange {
            old_path: None,
            new_path: path,
            status: FileStatus::Untracked,
            similarity: None,
            additions: if binary { 0 } else { -1 },
            deletions: 0,
            binary,
            whitespace_only: false,
        });
        let _ = size;
    }

    Ok(WorkingTreeFrame { files, stats, untracked: untracked_count })
}

/// Diff of `path` in the working tree (tracked: `git diff HEAD`; untracked:
/// synthesized all-added patch from disk).
pub fn working_file_diff(repo: &Repo, path: &str) -> Result<crate::git::types::FileDiff, AppError> {
    let tracked = {
        let out = run_git(&repo.path, &["ls-files", "--error-unmatch", "--", path]);
        out.is_ok()
    };
    if tracked {
        let args: Vec<&str> = vec!["diff", "HEAD", "--no-ext-diff", "--no-color", "-M", "--", path];
        let out = run_git(&repo.path, &args).map_err(|e| AppError::git("could not compute working tree diff", e))?;
        let text = lossy(&out);
        let binary = text.starts_with("Binary files ") || text.contains("GIT binary patch");
        if text.trim().is_empty() {
            // Staged-only changes show nothing vs HEAD when the index matches
            // HEAD — fall back to the staged diff.
            let args: Vec<&str> = vec!["diff", "--cached", "--no-ext-diff", "--no-color", "-M", "--", path];
            let out = run_git(&repo.path, &args).map_err(|e| AppError::git("could not compute working tree diff", e))?;
            let text = lossy(&out);
            let binary = text.starts_with("Binary files ") || text.contains("GIT binary patch");
            return Ok(crate::git::types::FileDiff { patch: if binary { None } else { Some(text) }, binary });
        }
        return Ok(crate::git::types::FileDiff { patch: if binary { None } else { Some(text) }, binary });
    }

    // Untracked: synthesize an all-added patch.
    let data = std::fs::read(repo.path.join(path)).map_err(|e| AppError::io("could not read file", e))?;
    if is_binary(&data) {
        return Ok(crate::git::types::FileDiff { patch: None, binary: true });
    }
    let content = lossy(&data);
    let line_count = content.lines().count().max(1);
    let mut patch = String::new();
    patch.push_str(&format!("diff --git a/{path} b/{path}\n"));
    patch.push_str("new file mode 100644\n");
    patch.push_str("--- /dev/null\n");
    patch.push_str(&format!("+++ b/{path}\n"));
    patch.push_str(&format!("@@ -0,0 +1,{line_count} @@\n"));
    for line in content.lines() {
        patch.push('+');
        patch.push_str(line);
        patch.push('\n');
    }
    Ok(crate::git::types::FileDiff { patch: Some(patch), binary: false })
}

/// Index-version blob sha for a tracked path (`git rev-parse :path`), or None
/// for untracked files.
pub fn index_blob_sha(repo: &Repo, path: &str) -> Result<Option<String>, AppError> {
    let spec = format!(":{path}");
    match run_git(&repo.path, &["rev-parse", "--verify", &spec]) {
        Ok(out) => {
            let sha = lossy(&out);
            let sha = sha.trim();
            Ok(if sha.is_empty() { None } else { Some(sha.to_string()) })
        }
        Err(_) => Ok(None),
    }
}

/// The current HEAD identity + dirty flag, for change detection.
pub fn head_state(repo: &Repo) -> Result<crate::git::types::HeadState, AppError> {
    let out = run_git(&repo.path, &["rev-parse", "HEAD"]).map_err(|e| AppError::git("could not read HEAD", e))?;
    let sha = lossy(&out);
    let sha = sha.trim().to_string();
    let branch = crate::git::history::head_branch(repo)?;
    let dirty = {
        let out = run_git(&repo.path, &["status", "--porcelain"]);
        out.map(|o| !o.is_empty()).unwrap_or(false)
    };
    Ok(crate::git::types::HeadState { sha, branch, dirty })
}
