//! Per-commit file changes: statuses (with git rename/copy detection),
//! per-file line counts, and commit-level stats.
//!
//! Merge commits are diffed against an explicit parent — the first parent by
//! default, any parent on request — never as a combined diff.

use super::{lossy, run_git, Repo, EMPTY_TREE_SHA};
use crate::error::AppError;
use crate::git::types::{CommitDetail, CommitStats, CommitMeta, FileChange, FileStatus};

/// One parsed `--name-status` record (status letter + paths).
struct RawNameStatus {
    status: FileStatus,
    similarity: Option<u8>,
    old_path: Option<String>,
    new_path: String,
}

/// Parse `git diff-tree -r --name-status -z` output:
/// entries are `M\0path\0`, `R100\0old\0new\0`, … with stray NULs between.
pub fn parse_name_status(bytes: &[u8]) -> Vec<RawNameStatus> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        // Skip record separators.
        while i < bytes.len() && bytes[i] == 0 {
            i += 1;
        }
        if i >= bytes.len() {
            break;
        }
        // Status token (letter, optionally + similarity score).
        let start = i;
        while i < bytes.len() && bytes[i] != 0 {
            i += 1;
        }
        let token = &bytes[start..i];
        i += 1; // consume NUL
        if token.is_empty() {
            continue;
        }
        let (status, similarity) = match token[0] {
            b'R' | b'C' => {
                let score = std::str::from_utf8(&token[1..]).ok().and_then(|s| s.parse().ok());
                (FileStatus::from_git_letter(token[0]), score)
            }
            c => (FileStatus::from_git_letter(c), None),
        };
        let n_paths = if matches!(token[0], b'R' | b'C') { 2 } else { 1 };
        let mut paths: Vec<String> = Vec::with_capacity(n_paths);
        for _ in 0..n_paths {
            let s = i;
            while i < bytes.len() && bytes[i] != 0 {
                i += 1;
            }
            paths.push(lossy(&bytes[s..i]));
            i += 1;
        }
        let (old_path, new_path) = if n_paths == 2 {
            (Some(paths[0].clone()), paths[1].clone())
        } else {
            (None, paths[0].clone())
        };
        out.push(RawNameStatus { status, similarity, old_path, new_path });
    }
    out
}

/// Parse `git diff --numstat -z` output: `add\0del\0path\0` per file,
/// `-\0-\0path\0` for binary, and an empty old-name slot for renames.
/// Returns `(additions, deletions, path)` with -1 for binary rows.
pub fn parse_numstat(bytes: &[u8]) -> Vec<(i64, i64, String)> {
    let tokens: Vec<&[u8]> = bytes.split(|&b| b == 0).collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i + 2 < tokens.len() {
        let add = numstat_num(tokens[i]);
        let del = numstat_num(tokens[i + 1]);
        let mut path = tokens[i + 2];
        let mut consumed = 3;
        // Renames carry an empty old-name slot before the new name.
        if path.is_empty() && i + 3 < tokens.len() {
            path = tokens[i + 3];
            consumed = 4;
        }
        if path.is_empty() {
            break;
        }
        out.push((add, del, lossy(path)));
        i += consumed;
    }
    out
}

fn numstat_num(tok: &[u8]) -> i64 {
    if tok == b"-" {
        -1
    } else {
        std::str::from_utf8(tok).ok().and_then(|s| s.parse().ok()).unwrap_or(-1)
    }
}

/// Parse `git diff --shortstat` output:
/// " 3 files changed, 84 insertions(+), 12 deletions(-)".
pub fn parse_shortstat(text: &str) -> CommitStats {
    let mut stats = CommitStats { files_changed: 0, insertions: 0, deletions: 0 };
    for part in text.split(',') {
        let part = part.trim();
        if let Some(rest) = part.strip_suffix("file changed").or_else(|| part.strip_suffix("files changed")) {
            stats.files_changed = rest.trim().parse().unwrap_or(0);
        } else if let Some(rest) = part.strip_suffix("insertion(+)").or_else(|| part.strip_suffix("insertions(+)")) {
            stats.insertions = rest.trim().parse().unwrap_or(0);
        } else if let Some(rest) = part.strip_suffix("deletion(-)").or_else(|| part.strip_suffix("deletions(-)")) {
            stats.deletions = rest.trim().parse().unwrap_or(0);
        }
    }
    stats
}

/// The commit object a diff is computed against, or None for root commits
/// (diffed against the empty tree).
fn diff_parent(meta: &CommitMeta, parent_index: Option<usize>) -> Option<String> {
    if meta.parents.is_empty() {
        None
    } else {
        Some(meta.parents[parent_index.unwrap_or(0)].clone())
    }
}

/// Full commit detail: metadata, stats, and per-file changes.
/// `parent_index` selects which parent a merge commit is compared against.
pub fn commit_detail(repo: &Repo, meta: &CommitMeta, parent_index: Option<usize>) -> Result<CommitDetail, AppError> {
    let parent = diff_parent(meta, parent_index);

    // 1. Statuses + rename/copy detection.
    let names = match &parent {
        Some(p) => {
            let mut args: Vec<&str> = vec!["diff-tree", "-r", "--root", "-M", "-C", "--name-status", "-z"];
            args.push(p);
            args.push(&meta.sha);
            let out = run_git(&repo.path, &args).map_err(|e| AppError::git("could not read file changes", e))?;
            parse_name_status(&out)
        }
        None => {
            let args: Vec<&str> = vec!["diff-tree", "-r", "--root", "-M", "-C", "--name-status", "-z", &meta.sha];
            let out = run_git(&repo.path, &args).map_err(|e| AppError::git("could not read file changes", e))?;
            parse_name_status(&out)
        }
    };

    // 2. Per-file line counts (same diff, same order).
    let numstat = match &parent {
        Some(p) => {
            let args: Vec<&str> = vec!["diff", "-M", "-C", "--numstat", "-z", p, &meta.sha];
            let out = run_git(&repo.path, &args).map_err(|e| AppError::git("could not read file stats", e))?;
            parse_numstat(&out)
        }
        None => {
            let args: Vec<&str> = vec!["diff", "-M", "-C", "--numstat", "-z", EMPTY_TREE_SHA, &meta.sha];
            let out = run_git(&repo.path, &args).map_err(|e| AppError::git("could not read file stats", e))?;
            parse_numstat(&out)
        }
    };

    // 3. Whitespace-only changes: same diff ignoring all whitespace; a file
    //    whose count is 0/0 there (but non-zero normally) is ws-only.
    let ws_paths: std::collections::HashSet<String> = {
        let args_base: Vec<&str> = vec!["diff", "-M", "-C", "--numstat", "-z", "--ignore-all-space"];
        let out = match &parent {
            Some(p) => {
                let mut args = args_base.clone();
                args.push(p);
                args.push(&meta.sha);
                run_git(&repo.path, &args).map_err(|e| AppError::git("could not read whitespace stats", e))?
            }
            None => {
                let mut args = args_base.clone();
                args.push(EMPTY_TREE_SHA);
                args.push(&meta.sha);
                run_git(&repo.path, &args).map_err(|e| AppError::git("could not read whitespace stats", e))?
            }
        };
        parse_numstat(&out)
            .into_iter()
            .filter(|(a, d, _)| *a == 0 && *d == 0)
            .map(|(_, _, p)| p)
            .collect()
    };

    // 4. Commit-level totals.
    let stats = match &parent {
        Some(p) => {
            let args: Vec<&str> = vec!["diff", "-M", "--shortstat", p, &meta.sha];
            let out = run_git(&repo.path, &args).map_err(|e| AppError::git("could not read commit stats", e))?;
            parse_shortstat(&lossy(&out))
        }
        None => {
            let args: Vec<&str> = vec!["diff", "-M", "--shortstat", EMPTY_TREE_SHA, &meta.sha];
            let out = run_git(&repo.path, &args).map_err(|e| AppError::git("could not read commit stats", e))?;
            parse_shortstat(&lossy(&out))
        }
    };

    // 5. Merge the three per-file views by index (identical diffs → identical order).
    let mut files = Vec::with_capacity(names.len());
    for (idx, n) in names.into_iter().enumerate() {
        let (additions, deletions, _) = numstat.get(idx).copied().unwrap_or((-1, -1, String::new()));
        let binary = additions < 0 || deletions < 0;
        let whitespace_only = !binary
            && additions + deletions > 0
            && (ws_paths.contains(&n.new_path) || n.old_path.as_ref().map_or(false, |o| ws_paths.contains(o)));
        files.push(FileChange {
            old_path: n.old_path,
            new_path: n.new_path,
            status: n.status,
            similarity: n.similarity,
            additions: if binary { 0 } else { additions },
            deletions: if binary { 0 } else { deletions },
            binary,
            whitespace_only,
        });
    }

    Ok(CommitDetail { meta: meta.clone(), stats, files })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_name_status_records() {
        let bytes = b"M\0src/a.ts\0A\0src/b.ts\0R100\0old.ts\0new.ts\0D\0gone.ts\0";
        let parsed = parse_name_status(bytes);
        assert_eq!(parsed.len(), 4);
        assert_eq!(parsed[0].status, FileStatus::Modified);
        assert_eq!(parsed[0].new_path, "src/a.ts");
        assert_eq!(parsed[1].status, FileStatus::Added);
        assert_eq!(parsed[2].status, FileStatus::Renamed);
        assert_eq!(parsed[2].similarity, Some(100));
        assert_eq!(parsed[2].old_path.as_deref(), Some("old.ts"));
        assert_eq!(parsed[2].new_path, "new.ts");
        assert_eq!(parsed[3].status, FileStatus::Deleted);
    }

    #[test]
    fn parses_numstat_records() {
        let bytes = b"84\012\0src/a.ts\0-\0-\0img.png\012\03\0\0renamed.ts\0";
        let parsed = parse_numstat(bytes);
        assert_eq!(parsed.len(), 3);
        assert_eq!(parsed[0], (84, 12, "src/a.ts".into()));
        assert_eq!(parsed[1], (-1, -1, "img.png".into()));
        // Rename row: empty old-name slot skipped.
        assert_eq!(parsed[2], (12, 3, "renamed.ts".into()));
    }

    #[test]
    fn parses_shortstat() {
        let s = parse_shortstat(" 3 files changed, 84 insertions(+), 12 deletions(-)");
        assert_eq!(s.files_changed, 3);
        assert_eq!(s.insertions, 84);
        assert_eq!(s.deletions, 12);
        let s = parse_shortstat(" 1 file changed, 1 insertion(+)");
        assert_eq!(s.files_changed, 1);
        assert_eq!(s.insertions, 1);
        assert_eq!(s.deletions, 0);
    }
}
