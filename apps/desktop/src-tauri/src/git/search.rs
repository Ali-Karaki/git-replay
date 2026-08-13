//! Search within a replay range: commit messages and touched paths.

use super::{run_git, Repo};
use crate::error::AppError;
use crate::git::history::parse_log_short;
use crate::git::types::SearchResult;

/// Escape pathspec glob metacharacters so the query matches literally,
/// then make it a case-insensitive substring glob.
fn glob_pattern(query: &str) -> String {
    let escaped: String = query
        .chars()
        .flat_map(|c| match c {
            '[' | ']' | '*' | '?' | '\\' => vec!['\\', c],
            c => vec![c],
        })
        .collect();
    format!(":(icase)*{escaped}*")
}

/// Commits in `base..head` whose message matches `query` (substring,
/// case-insensitive) or that touched a path whose name matches it.
/// Results keep each source's topological order; messages first.
pub fn search_replay(repo: &Repo, base: &str, head: &str, query: &str, limit: u32) -> Result<Vec<SearchResult>, AppError> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let range = format!("{base}..{head}");
    let limit = limit.clamp(1, 200) as usize;

    let mut results: Vec<SearchResult> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut push = |sha: String, subject: String, ts: i64| {
        if seen.insert(sha.clone()) {
            results.push(SearchResult { sha, subject, commit_ts: ts });
        }
    };

    // Message matches.
    {
        let args: Vec<&str> = vec![
            "log",
            "-z",
            "--topo-order",
            "--format=%H%x1f%s%x1f%ct",
            &range,
            "--grep",
            query,
            "--fixed-strings",
            "-i",
        ];
        let out = run_git(&repo.path, &args).map_err(|e| AppError::git("search failed", e))?;
        for (sha, subject, ts) in parse_log_short(&out) {
            push(sha, subject, ts);
        }
    }

    // Path matches.
    {
        let pattern = glob_pattern(query);
        let args: Vec<&str> = vec![
            "log",
            "-z",
            "--topo-order",
            "--format=%H%x1f%s%x1f%ct",
            &range,
            "--",
            &pattern,
        ];
        let out = run_git(&repo.path, &args).map_err(|e| AppError::git("search failed", e))?;
        for (sha, subject, ts) in parse_log_short(&out) {
            push(sha, subject, ts);
        }
    }

    results.truncate(limit);
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn glob_pattern_escapes_and_wraps() {
        assert_eq!(glob_pattern("a*b"), ":(icase)*a\\*b*");
        assert_eq!(glob_pattern("plain"), ":(icase)*plain*");
    }
}
