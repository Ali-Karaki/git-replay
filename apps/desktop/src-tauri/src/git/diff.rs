//! Raw file patches. Git produces the diff (with its own rename, binary and
//! mode-change semantics); the frontend parses the unified format for display.
//! diff-tree is used (not `git diff`) so root commits work via --root.

use super::{literal_pathspec, lossy, run_git, Repo};
use crate::error::AppError;
use crate::git::types::{CommitMeta, FileDiff};

/// Diff of `path` between `meta`'s selected parent and the commit itself.
/// Root commits diff against the empty tree (--root). Binary diffs carry no
/// patch.
pub fn file_diff(repo: &Repo, meta: &CommitMeta, parent_index: Option<usize>, path: &str) -> Result<FileDiff, AppError> {
    let parent: Option<String> = if meta.parents.is_empty() {
        None
    } else {
        Some(meta.parents[parent_index.unwrap_or(0)].clone())
    };

    let mut args: Vec<String> =
        vec!["diff-tree".into(), "-r".into(), "-p".into(), "--root".into(), "-M".into(), "--no-ext-diff".into(), "--no-color".into()];
    match &parent {
        Some(p) => {
            args.push(p.clone());
            args.push(meta.sha.clone());
        }
        None => {
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
