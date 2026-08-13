//! File evolution: every commit within a replay range that touched a path,
//! with rename continuity.
//!
//! `git log --follow` does the heavy lifting: it follows the file backwards
//! through renames (git's own detection), so one --raw call plus one
//! --numstat call (for line counts) is the whole implementation.
//!
//! Output format facts (verified against git 2.53):
//! - With -z, each record is `sha\x1fsubject\x1fts\0\n` then diff entries.
//! - --raw entries: `:100644 100644 <old> <new> R083\0oldpath\0newpath\0`.
//! - --numstat entries: `add\tdel\t\0path\0` (renames: `\0new\0old\0`).

use super::{literal_pathspec, lossy, run_git, Repo};
use crate::error::AppError;
use crate::git::types::{EvolutionEntry, FileStatus};

/// One parsed file entry from a `git log --raw` record.
struct RawEntry {
    status: FileStatus,
    similarity: Option<u8>,
    old_path: Option<String>,
    new_path: String,
}

struct RawCommit {
    sha: String,
    subject: String,
    commit_ts: i64,
    entries: Vec<RawEntry>,
}

/// Parse `git log -z --format=%H%x1f%s%x1f%ct --raw -M` output.
fn parse_raw_log(bytes: &[u8]) -> Vec<RawCommit> {
    let mut commits: Vec<RawCommit> = Vec::new();
    let mut i = 0usize;
    while i < bytes.len() {
        while i < bytes.len() && bytes[i] == 0 {
            i += 1;
        }
        if i >= bytes.len() {
            break;
        }
        let (sha, subject, commit_ts) = match read_record_header(bytes, &mut i) {
            Some(h) => h,
            None => break,
        };
        let mut entries = Vec::new();
        loop {
            while i < bytes.len() && bytes[i] == 0 {
                i += 1;
            }
            if i >= bytes.len() || looks_like_sha(bytes, i) {
                break;
            }
            // Raw entry: ":mode mode old new R083" then NUL-terminated paths.
            let start = i;
            while i < bytes.len() && bytes[i] != 0 {
                i += 1;
            }
            let token = &bytes[start..i];
            i += 1;
            if token.is_empty() {
                continue;
            }
            let status_part = token.split(|&b| b == b' ').next_back().unwrap_or(token);
            if status_part.is_empty() {
                continue;
            }
            let (status, similarity) = match status_part[0] {
                b'R' | b'C' => {
                    let score = std::str::from_utf8(&status_part[1..]).ok().and_then(|s| s.parse().ok());
                    (FileStatus::from_git_letter(status_part[0]), score)
                }
                c => (FileStatus::from_git_letter(c), None),
            };
            let n_paths = if matches!(status_part[0], b'R' | b'C') { 2 } else { 1 };
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
            entries.push(RawEntry { status, similarity, old_path, new_path });
        }
        commits.push(RawCommit { sha, subject, commit_ts, entries });
    }
    commits
}

/// Read `sha\x1fsubject\x1fts` followed by `\0\n` (the -z record terminator).
fn read_record_header(bytes: &[u8], i: &mut usize) -> Option<(String, String, i64)> {
    let start = *i;
    while *i < bytes.len() && bytes[*i] != 0 && bytes[*i] != b'\n' {
        *i += 1;
    }
    let area = lossy(&bytes[start..*i]);
    // Consume the terminator: with -z the format line ends in `\0\n`.
    if *i < bytes.len() {
        *i += 1;
    }
    if *i < bytes.len() && (bytes[*i] == b'\n' || bytes[*i] == 0) {
        *i += 1;
    }
    let fields: Vec<&str> = area.split('\x1f').collect();
    if fields.len() < 3 || fields[0].len() < 40 {
        return None;
    }
    Some((fields[0].to_string(), fields[1].to_string(), fields[2].parse().unwrap_or(0)))
}

/// Does `bytes[i..]` start with a 40+ hex-char object id?
fn looks_like_sha(bytes: &[u8], i: usize) -> bool {
    let mut run = 0;
    while i + run < bytes.len() && bytes[i + run].is_ascii_hexdigit() {
        run += 1;
        if run >= 40 {
            return true;
        }
    }
    false
}

/// Parse `git log -z --format=%H%x1f%s%x1f%ct --numstat -M` output into
/// per-commit `(additions, deletions, new_path)` rows.
fn parse_numstat_log(bytes: &[u8]) -> Vec<(String, Vec<(i64, i64, String)>)> {
    let mut out: Vec<(String, Vec<(i64, i64, String)>)> = Vec::new();
    let mut i = 0usize;
    while i < bytes.len() {
        while i < bytes.len() && bytes[i] == 0 {
            i += 1;
        }
        if i >= bytes.len() {
            break;
        }
        let Some((sha, _, _)) = read_record_header(bytes, &mut i) else { break };
        let mut rows = Vec::new();
        loop {
            while i < bytes.len() && bytes[i] == 0 {
                i += 1;
            }
            if i >= bytes.len() || looks_like_sha(bytes, i) {
                break;
            }
            // Rows are NUL-terminated: `add\tdel\tpath\0`; rename rows leave
            // the path field empty and carry `\0old\0new\0` after it.
            let start = i;
            while i < bytes.len() && bytes[i] != 0 {
                i += 1;
            }
            let head = &bytes[start..i];
            i += 1;
            let parts: Vec<&[u8]> = head.split(|&b| b == b'\t').collect();
            if parts.len() < 2 {
                continue;
            }
            let add = num(parts[0]);
            let del = num(parts[1]);
            let path = parts.get(2).copied().unwrap_or(b"");
            if path.is_empty() {
                // Rename row: [old, new] follow as NUL-separated tokens.
                let mut paths: Vec<String> = Vec::new();
                while i < bytes.len() && bytes[i] != 0 && paths.len() < 2 {
                    let s = i;
                    while i < bytes.len() && bytes[i] != 0 {
                        i += 1;
                    }
                    paths.push(lossy(&bytes[s..i]));
                    i += 1;
                }
                if paths.len() == 2 {
                    rows.push((add, del, paths[1].clone()));
                }
            } else {
                rows.push((add, del, lossy(path)));
            }
        }
        out.push((sha, rows));
    }
    out
}

fn num(tok: &[u8]) -> i64 {
    if tok == b"-" {
        -1
    } else {
        std::str::from_utf8(tok).ok().and_then(|s| s.parse().ok()).unwrap_or(-1)
    }
}

/// Every commit in `base..head` that touched `path`, oldest first, following
/// renames backwards (creation commits before a rename are included).
pub fn file_evolution(repo: &Repo, base: &str, head: &str, path: &str) -> Result<Vec<EvolutionEntry>, AppError> {
    let range = format!("{base}..{head}");
    let format = "--format=%H%x1f%s%x1f%ct";
    let spec = literal_pathspec(path);

    let raw = {
        let args: Vec<&str> = vec!["log", "-z", "--topo-order", format, "--follow", "-M", "--raw", &range, "--", &spec];
        let out = run_git(&repo.path, &args).map_err(|e| AppError::git("could not trace file history", e))?;
        parse_raw_log(&out)
    };

    let nums = {
        let args: Vec<&str> = vec!["log", "-z", "--topo-order", format, "--follow", "-M", "--numstat", &range, "--", &spec];
        let out = run_git(&repo.path, &args).map_err(|e| AppError::git("could not trace file history", e))?;
        parse_numstat_log(&out)
    };

    // Merge line counts by commit + new path (deleted files are keyed by
    // their old path, everything else by the new path).
    let mut result = Vec::new();
    for raw_commit in raw {
        let num_rows = nums.iter().find(|(sha, _)| *sha == raw_commit.sha).map(|(_, r)| r);
        for e in raw_commit.entries {
            let key = if e.status == FileStatus::Deleted { e.old_path.as_deref() } else { Some(e.new_path.as_str()) };
            let (additions, deletions) = num_rows
                .and_then(|rows| {
                    rows.iter()
                        .find(|(_, _, p)| Some(p.as_str()) == key || e.old_path.as_deref() == Some(p.as_str()))
                        .map(|(a, d, _)| (*a, *d))
                })
                .unwrap_or((0, 0));
            result.push(EvolutionEntry {
                sha: raw_commit.sha.clone(),
                subject: raw_commit.subject.clone(),
                commit_ts: raw_commit.commit_ts,
                status: e.status,
                old_path: e.old_path,
                new_path: e.new_path,
                similarity: e.similarity,
                additions: if additions < 0 { 0 } else { additions },
                deletions: if deletions < 0 { 0 } else { deletions },
            });
        }
    }
    // log emits newest first; replay frames run oldest first.
    result.reverse();
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_raw_log_records() {
        // Real shape: format line ends in \0\n; raw entries carry the
        // ":mode mode old new R083" prefix.
        let bytes = b"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\x1fFix stuff\x1f1700000000\0\n:100644 100644 abc123 def456 M\0src/a.ts\0:100644 100644 94c99a3 f985857 R083\0old.ts\0new.ts\0\0bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\x1fMore\x1f1700000100\0\n:000000 100644 0000000 94c99a3 A\0added.ts\0";
        let commits = parse_raw_log(bytes);
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].sha, "a".repeat(40));
        assert_eq!(commits[0].subject, "Fix stuff");
        assert_eq!(commits[0].entries.len(), 2);
        assert_eq!(commits[0].entries[0].status, FileStatus::Modified);
        assert_eq!(commits[0].entries[1].status, FileStatus::Renamed);
        assert_eq!(commits[0].entries[1].similarity, Some(83));
        assert_eq!(commits[0].entries[1].old_path.as_deref(), Some("old.ts"));
        assert_eq!(commits[0].entries[1].new_path, "new.ts");
        assert_eq!(commits[1].entries[0].status, FileStatus::Added);
    }

    #[test]
    fn parses_numstat_log_records() {
        // Real shape: rows are `add\tdel\tpath\0` after the `\0\n` header.
        let bytes = b"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\x1fFix\x1f1700000000\0\n84\t12\tsrc/a.ts\0\0bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\x1fMore\x1f1700000100\0\n-\t-\timg.png\0";
        let commits = parse_numstat_log(bytes);
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].1, vec![(84, 12, "src/a.ts".into())]);
        assert_eq!(commits[1].1, vec![(-1, -1, "img.png".into())]);
    }
}
