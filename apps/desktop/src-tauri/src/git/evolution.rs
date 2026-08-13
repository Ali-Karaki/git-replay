//! File evolution: every commit within a replay range that touched a path,
//! with rename continuity (git's own -M detection per commit).
//!
//! Two `git log -z` calls (--raw for statuses/renames, --numstat for line
//! counts) are merged per commit. Results run head→base; the UI reverses.

use super::{literal_pathspec, lossy, run_git, Repo};
use crate::error::AppError;
use crate::git::types::{EvolutionEntry, FileStatus};

/// One parsed file entry from a `git log --raw/--name-status` record.
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

/// Parse `git log -z --format=%H%x1f%s%x1f%ct --name-status -M -C` output.
///
/// Record shape: `sha\x1fsubject\x1fct` then entries `M\0path\0` /
/// `R100\0old\0new\0`. A token that looks like a full SHA starts a record.
fn parse_raw_log(bytes: &[u8]) -> Vec<RawCommit> {
    let mut commits: Vec<RawCommit> = Vec::new();
    let mut i = 0usize;
    while i < bytes.len() {
        // Skip separators.
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
            // Between entries (and before the next record) git emits NULs.
            while i < bytes.len() && bytes[i] == 0 {
                i += 1;
            }
            if i >= bytes.len() {
                break;
            }
            // A hex token long enough to be an object id → next record.
            if looks_like_sha(bytes, i) {
                break;
            }
            // Status token: letter(s) + optional score, NUL-terminated.
            let start = i;
            while i < bytes.len() && bytes[i] != 0 {
                i += 1;
            }
            let token = &bytes[start..i];
            i += 1;
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
            entries.push(RawEntry { status, similarity, old_path, new_path });
        }
        commits.push(RawCommit { sha, subject, commit_ts, entries });
    }
    commits
}

/// Read `sha\x1fsubject\x1fct` (followed by `\0` or `\n`).
fn read_record_header(bytes: &[u8], i: &mut usize) -> Option<(String, String, i64)> {
    let start = *i;
    while *i < bytes.len() && bytes[*i] != 0 && bytes[*i] != b'\n' {
        *i += 1;
    }
    let area = lossy(&bytes[start..*i]);
    // Consume the terminator.
    if *i < bytes.len() {
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

/// Parse `git log -z --format=%H%x1f%s%x1f%ct --numstat -M -C` output into
/// per-commit `(additions, deletions, path)` rows.
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
            // add\0del\0path\0 (+ empty old-name slot for renames)
            let mut fields: Vec<String> = Vec::new();
            for _ in 0..3 {
                let s = i;
                while i < bytes.len() && bytes[i] != 0 {
                    i += 1;
                }
                fields.push(lossy(&bytes[s..i]));
                i += 1;
            }
            let mut path = fields[2].clone();
            if path.is_empty() {
                let s = i;
                while i < bytes.len() && bytes[i] != 0 {
                    i += 1;
                }
                path = lossy(&bytes[s..i]);
                i += 1;
            }
            if path.is_empty() {
                break;
            }
            let add = if fields[0] == "-" { -1 } else { fields[0].parse().unwrap_or(-1) };
            let del = if fields[1] == "-" { -1 } else { fields[1].parse().unwrap_or(-1) };
            rows.push((add, del, path));
        }
        out.push((sha, rows));
    }
    out
}

/// Every commit in `base..head` that touched `path`, in topological order,
/// following rename chains backwards (creation commits before a rename are
/// included; rename continuity is git's own -M/-C detection per commit).
pub fn file_evolution(repo: &Repo, base: &str, head: &str, path: &str) -> Result<Vec<EvolutionEntry>, AppError> {
    // Canonical topo order of the range, used to order the merged results.
    let range = format!("{base}..{head}");
    let order: std::collections::HashMap<String, usize> = {
        let out = run_git(&repo.path, &["rev-list", "--topo-order", &range])
            .map_err(|e| AppError::git("could not trace file history", e))?;
        lossy(&out).split_whitespace().enumerate().map(|(i, s)| (s.to_string(), i)).collect()
    };

    let mut queue: std::collections::VecDeque<String> = std::collections::VecDeque::from([path.to_string()]);
    let mut visited_paths: std::collections::HashSet<String> =
        std::collections::HashSet::from([path.to_string()]);
    let mut seen: std::collections::HashSet<(String, String)> = std::collections::HashSet::new();
    let mut entries: Vec<EvolutionEntry> = Vec::new();

    while let Some(p) = queue.pop_front() {
        for e in file_evolution_single(repo, base, head, &p)? {
            // Follow the chain backwards: when this path arrived via a
            // rename/copy, also trace the old path.
            if matches!(e.status, FileStatus::Renamed | FileStatus::Copied) {
                if let Some(old) = &e.old_path {
                    if old != &p && visited_paths.insert(old.clone()) {
                        queue.push_back(old.clone());
                    }
                }
            }
            let key = (e.sha.clone(), format!("{:?}:{}", e.old_path, e.new_path));
            if seen.insert(key) {
                entries.push(e);
            }
        }
    }

    entries.sort_by_key(|e| order.get(&e.sha).copied().unwrap_or(usize::MAX));
    Ok(entries)
}

/// Commits in `base..head` touching the literal `path` (no rename following),
/// head→base order.
fn file_evolution_single(repo: &Repo, base: &str, head: &str, path: &str) -> Result<Vec<EvolutionEntry>, AppError> {
    let range = format!("{base}..{head}");
    let format = "--format=%H%x1f%s%x1f%ct";
    let spec = literal_pathspec(path);

    let raw = {
        let args: Vec<&str> = vec!["log", "-z", "--topo-order", format, "-M", "-C", "--raw", &range, "--", &spec];
        let out = run_git(&repo.path, &args).map_err(|e| AppError::git("could not trace file history", e))?;
        parse_raw_log(&out)
    };

    let nums = {
        let args: Vec<&str> = vec!["log", "-z", "--topo-order", format, "-M", "-C", "--numstat", &range, "--", &spec];
        let out = run_git(&repo.path, &args).map_err(|e| AppError::git("could not trace file history", e))?;
        parse_numstat_log(&out)
    };

    // Merge line counts by commit + path (deleted files are keyed by their
    // old path, everything else by the new path).
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
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_raw_log_records() {
        let bytes = b"abc1234567890abc1234567890abc1234567\x1fFix stuff\x1f1700000000\nM\0src/a.ts\0R100\0old.ts\0new.ts\0\0def1234567890def1234567890def1234567\x1fMore\x1f1700000100\nA\0added.ts\0";
        let commits = parse_raw_log(bytes);
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].sha, "abc1234567890abc1234567890abc1234567");
        assert_eq!(commits[0].subject, "Fix stuff");
        assert_eq!(commits[0].entries.len(), 2);
        assert_eq!(commits[0].entries[1].status, FileStatus::Renamed);
        assert_eq!(commits[0].entries[1].old_path.as_deref(), Some("old.ts"));
        assert_eq!(commits[1].entries[0].status, FileStatus::Added);
    }

    #[test]
    fn parses_numstat_log_records() {
        let bytes = b"abc1234567890abc1234567890abc1234567\x1fFix\x1f1700000000\n84\012\0src/a.ts\0\0def1234567890def1234567890def1234567\x1fMore\x1f1700000100\n-\0-\0img.png\0";
        let commits = parse_numstat_log(bytes);
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].1, vec![(84, 12, "src/a.ts".into())]);
        assert_eq!(commits[1].1, vec![(-1, -1, "img.png".into())]);
    }
}
