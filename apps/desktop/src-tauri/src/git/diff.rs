//! Raw file patches. Git produces the diff (with its own rename, binary and
//! mode-change semantics); the frontend parses the unified format for display.

use super::{literal_pathspec, lossy, run_git, Repo, EMPTY_TREE_SHA};
use crate::error::AppError;
use crate::git::types::{CommitMeta, FileDiff};

/// Diff of `path` between `meta`'s selected parent and the commit itself.
/// Root commits diff against the empty tree. Binary diffs carry no patch.
pub fn file_diff(repo: &Repo, meta: &CommitMeta, parent_index: Option<usize>, path: &str) -> Result<FileDiff, AppError> {
    let parent: Option<String> = if meta.parents.is_empty() {
        None
    } else {
        Some(meta.parents[parent_index.unwrap_or(0)].clone())
    };

    let mut args: Vec<String> = vec!["diff".into(), "-M".into(), "--no-ext-diff".into(), "--no-color".into()];
    match &parent {
        Some(p) => {
            args.push(p.clone());
            args.push(meta.sha.clone());
        }
        None => {
            args.push(EMPTY_TREE_SHA.into());
            args.push(meta.sha.clone());
        }
    }
    args.push("--".into());
    args.push(literal_pathspec(path));
    let out = run_git(&repo.path, &args).map_err(|e| AppError::git("could not compute file diff", e))?;
    let text = lossy(&out);

    // Binary diffs announce themselves with a stable marker line.
    let binary = text.starts_with("Binary files ") || text.contains("GIT binary patch");

    Ok(FileDiff { patch: if binary { None } else { Some(text) }, binary })
}
