//! Per-commit file changes: statuses (with git rename/copy detection),
//! per-file line counts, and commit-level stats.
//!
//! Merge commits are diffed against an explicit parent — the first parent by
//! default, any parent on request — never as a combined diff.

use super::{lossy, run_git, Repo};
use crate::error::AppError;
use crate::git::types::{CommitDetail, CommitStats, CommitMeta, FileChange, FileStatus};

/// One parsed `--name-status` record (status letter + paths).
pub(crate) struct RawNameStatus {
    status: FileStatus,
    similarity: Option<u8>,
    old_path: Option<String>,
    new_path: String,
}

/// Parse `git diff-tree -r --name-status -z` output:
/// entries are `M\0path\0`, `R100\0old\0new\0`, … with stray NULs between.
pub(crate) fn parse_name_status(bytes: &[u8]) -> Vec<RawNameStatus> {
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
        // `diff-tree --root` (single-argument form) prefixes the entries with
        // the commit sha — skip it.
        if token.len() >= 40 && token.iter().all(|b| b.is_ascii_hexdigit()) {
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

/// Parse `git diff --numstat -z` output (also diff-tree/log variants):
/// `add\tdel\t\0path\0` per file, `-\t-\t\0path\0` for binary, and rename
/// rows `add\tdel\t\0new\0old\0`. Returns `(additions, deletions, new_path)`
/// with -1 for binary rows — the new path keeps rows mergeable with
/// `--name-status` output.
pub(crate) fn parse_numstat(bytes: &[u8]) -> Vec<(i64, i64, String)> {
    // Rows are NUL-terminated: `add\tdel\tpath\0`. Rename rows leave the
    // third tab-field empty and carry `\0old\0new\0` after it instead.
    let tokens: Vec<&[u8]> = bytes.split(|&b| b == 0).collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < tokens.len() {
        let head = tokens[i];
        i += 1;
        if head.is_empty() {
            continue;
        }
        let parts: Vec<&[u8]> = head.split(|&b| b == b'\t').collect();
        if parts.len() < 2 {
            continue; // commit-sha header, stray separators, ...
        }
        let add = numstat_num(parts[0]);
        let del = numstat_num(parts[1]);
        let path = parts.get(2).copied().unwrap_or(b"");
        if path.is_empty() {
            // Rename row: the following NUL-separated tokens are [old, new].
            let mut paths: Vec<String> = Vec::new();
            while i < tokens.len() && !tokens[i].is_empty() && paths.len() < 2 {
                paths.push(lossy(tokens[i]));
                i += 1;
            }
            if paths.len() == 2 {
                out.push((add, del, paths[1].clone()));
            }
        } else {
            out.push((add, del, lossy(path)));
        }
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
pub(crate) fn parse_shortstat(text: &str) -> CommitStats {
    let mut stats = CommitStats { files_changed: 0, insertions: 0, deletions: 0 };
    for part in text.split(',') {
        let part = part.trim();
        // diff-tree prefixes the stat with the commit sha line; the number is
        // always the last whitespace-separated token before the suffix.
        if let Some(rest) = part.strip_suffix("file changed").or_else(|| part.strip_suffix("files changed")) {
            stats.files_changed = rest.split_whitespace().next_back().and_then(|n| n.parse().ok()).unwrap_or(0);
        } else if let Some(rest) = part.strip_suffix("insertion(+)").or_else(|| part.strip_suffix("insertions(+)")) {
            stats.insertions = rest.split_whitespace().next_back().and_then(|n| n.parse().ok()).unwrap_or(0);
        } else if let Some(rest) = part.strip_suffix("deletion(-)").or_else(|| part.strip_suffix("deletions(-)")) {
            stats.deletions = rest.split_whitespace().next_back().and_then(|n| n.parse().ok()).unwrap_or(0);
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

    // 2. Per-file line counts (same diff, same order). diff-tree --root
    //    handles root commits against the empty tree natively.
    let numstat = match &parent {
        Some(p) => {
            let args: Vec<&str> = vec!["diff-tree", "-r", "--root", "-M", "-C", "--numstat", "-z", p, &meta.sha];
            let out = run_git(&repo.path, &args).map_err(|e| AppError::git("could not read file stats", e))?;
            parse_numstat(&out)
        }
        None => {
            let args: Vec<&str> = vec!["diff-tree", "-r", "--root", "-M", "-C", "--numstat", "-z", &meta.sha];
            let out = run_git(&repo.path, &args).map_err(|e| AppError::git("could not read file stats", e))?;
            parse_numstat(&out)
        }
    };

    // 3. Whitespace-only changes: same diff ignoring all whitespace; a file
    //    whose count is 0/0 there (but non-zero normally) is ws-only.
    let ws_paths: std::collections::HashSet<String> = {
        let out = match &parent {
            Some(p) => {
                let args: Vec<&str> =
                    vec!["diff-tree", "-r", "--root", "-M", "-C", "--numstat", "-z", "--ignore-all-space", p, &meta.sha];
                run_git(&repo.path, &args).map_err(|e| AppError::git("could not read whitespace stats", e))?
            }
            None => {
                let args: Vec<&str> =
                    vec!["diff-tree", "-r", "--root", "-M", "-C", "--numstat", "-z", "--ignore-all-space", &meta.sha];
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
            let args: Vec<&str> = vec!["diff-tree", "-r", "--root", "-M", "--shortstat", p, &meta.sha];
            let out = run_git(&repo.path, &args).map_err(|e| AppError::git("could not read commit stats", e))?;
            parse_shortstat(&lossy(&out))
        }
        None => {
            let args: Vec<&str> = vec!["diff-tree", "-r", "--root", "-M", "--shortstat", &meta.sha];
            let out = run_git(&repo.path, &args).map_err(|e| AppError::git("could not read commit stats", e))?;
            parse_shortstat(&lossy(&out))
        }
    };

    // 5. Merge the three per-file views by index (identical diffs → identical order).
    let mut files = Vec::with_capacity(names.len());
    for (idx, n) in names.into_iter().enumerate() {
        let (additions, deletions) = match numstat.get(idx) {
            Some((a, d, _)) => (*a, *d),
            None => (-1, -1),
        };
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
        // Real format: "add\tdel\tpath\0"; rename rows leave path empty and
        // carry \0old\0new\0 after it.
        let bytes = b"84\t12\tsrc/a.ts\0-\t-\timg.png\012\t3\t\0old.ts\0renamed.ts\0";
        let parsed = parse_numstat(bytes);
        assert_eq!(parsed.len(), 3);
        assert_eq!(parsed[0], (84, 12, "src/a.ts".into()));
        assert_eq!(parsed[1], (-1, -1, "img.png".into()));
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
