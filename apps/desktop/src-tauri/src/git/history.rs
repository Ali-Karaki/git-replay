//! Refs, commit metadata, and replay range resolution.
//!
//! Commit ordering is always topological (`--topo-order`), never timestamp
//! order — author dates lie (rebases, cherry-picks, clock skew); ancestry
//! does not.

use super::{lossy, run_git, trim_line, Repo};
use crate::error::{AppError, ErrorKind, GitFailure};
use crate::git::types::{BranchInfo, CommitMeta, Identity, ReplayRange, RepoInfo, TagInfo};

/// `git log -z --format=...`: one record per commit, NUL-separated,
/// fields separated by US (0x1f).
const LOG_FORMAT: &str = "%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%s%x1f%b";
const FIELD_SEP: char = '\x1f';

/// Parse NUL-separated `git log -z` output produced with `LOG_FORMAT`.
pub fn parse_log_metas(bytes: &[u8]) -> Vec<CommitMeta> {
    parse_log_records(bytes).into_iter().filter_map(meta_from_fields).collect()
}

/// Parse NUL-separated `git log -z` output produced with `LOG_FORMAT_SHORT`.
/// Returns `(sha, subject, commit_ts)`.
pub fn parse_log_short(bytes: &[u8]) -> Vec<(String, String, i64)> {
    parse_log_records(bytes)
        .into_iter()
        .filter_map(|f| {
            if f.len() < 3 {
                None
            } else {
                Some((f[0].clone(), f[1].clone(), f[2].parse().unwrap_or(0)))
            }
        })
        .collect()
}

/// Split `-z` log output into per-commit field vectors.
fn parse_log_records(bytes: &[u8]) -> Vec<Vec<String>> {
    let text = lossy(bytes);
    text.split('\0')
        .filter(|rec| !rec.is_empty())
        .map(|rec| rec.split(FIELD_SEP).map(String::from).collect())
        .collect()
}

fn meta_from_fields(f: Vec<String>) -> Option<CommitMeta> {
    if f.len() < 10 {
        return None;
    }
    Some(CommitMeta {
        sha: f[0].clone(),
        parents: f[1].split(' ').filter(|p| !p.is_empty()).map(String::from).collect(),
        author: Identity { name: f[2].clone(), email: f[3].clone() },
        committer: Identity { name: f[5].clone(), email: f[6].clone() },
        author_ts: f[4].parse().unwrap_or(0),
        commit_ts: f[7].parse().unwrap_or(0),
        subject: f[8].trim().to_string(),
        body: f[9].trim().to_string(),
    })
}

/// Resolve a rev (branch, tag, SHA, HEAD) to a commit SHA.
pub fn resolve_sha(repo: &Repo, rev: &str) -> Result<String, AppError> {
    let spec = format!("{rev}^{{commit}}");
    let out = run_git(&repo.path, &["rev-parse", "--verify", &spec])
        .map_err(|e| classify_resolve_error(rev, e))?;
    let sha = trim_line(&lossy(&out)).to_string();
    if sha.is_empty() {
        return Err(AppError::new(ErrorKind::RefNotFound, format!("ref not found: {rev}")));
    }
    Ok(sha)
}

fn classify_resolve_error(rev: &str, failure: GitFailure) -> AppError {
    let stderr = failure.stderr.to_lowercase();
    if stderr.contains("unknown revision") || stderr.contains("ambiguous argument") || stderr.contains("bad revision") {
        AppError::new(ErrorKind::RefNotFound, format!("ref not found: {rev}"))
    } else if stderr.contains("not a git repository") {
        AppError::new(ErrorKind::NotAWorkTree, "not a Git working tree")
    } else if stderr.contains("does not have any commits") {
        AppError::new(ErrorKind::NoCommits, "no commits in this repository")
    } else {
        AppError::git(&format!("could not resolve {rev}"), failure)
    }
}

/// `git merge-base a b` → Some(sha), or None for unrelated histories.
pub fn merge_base(repo: &Repo, a: &str, b: &str) -> Result<Option<String>, AppError> {
    let out = run_git(&repo.path, &["merge-base", a, b])
        .map_err(|e| AppError::git("could not compute merge base", e))?;
    let sha = trim_line(&lossy(&out)).to_string();
    Ok(if sha.is_empty() { None } else { Some(sha) })
}

/// The root commit of `head`'s history (first root reported by rev-list).
pub fn root_commit(repo: &Repo, head: &str) -> Result<String, AppError> {
    let out = run_git(&repo.path, &["rev-list", "--max-parents=0", head])
        .map_err(|e| AppError::git("could not find the initial commit", e))?;
    let shas: Vec<String> = lossy(&out).split_whitespace().map(String::from).collect();
    shas.into_iter().next().ok_or_else(|| AppError::new(ErrorKind::NoCommits, "no commits in this repository"))
}

/// `git symbolic-ref --short HEAD` — None when HEAD is detached.
pub fn head_branch(repo: &Repo) -> Result<Option<String>, AppError> {
    // A detached HEAD makes symbolic-ref exit non-zero; that is expected.
    match run_git(&repo.path, &["symbolic-ref", "--short", "HEAD"]) {
        Ok(out) => {
            let name = trim_line(&lossy(&out)).to_string();
            Ok(if name.is_empty() { None } else { Some(name) })
        }
        Err(_) => Ok(None),
    }
}

/// Read commit metadata for a range, topologically ordered.
pub fn log_metas(repo: &Repo, args: &[&str]) -> Result<Vec<CommitMeta>, AppError> {
    let format_arg = format!("--format={LOG_FORMAT}");
    let mut full: Vec<&str> = vec!["log", "-z", "--topo-order", &format_arg];
    full.extend_from_slice(args);
    let out = run_git(&repo.path, &full).map_err(|e| AppError::git("could not read commit history", e))?;
    Ok(parse_log_metas(&out))
}

/// Resolve a replay range. `base_ref`/`head_ref` may be branches, tags, SHAs
/// or `HEAD`. With `use_merge_base`, the base becomes the merge base of the
/// two refs — the correct "Frame 0" for branch replays.
pub fn resolve_replay(
    repo: &Repo,
    base_ref: Option<&str>,
    head_ref: Option<&str>,
    use_merge_base: bool,
    first_parent: bool,
) -> Result<ReplayRange, AppError> {
    let head = resolve_sha(repo, head_ref.unwrap_or("HEAD"))?;

    let base = if use_merge_base {
        match merge_base(repo, base_ref.unwrap_or("HEAD"), &head)? {
            Some(b) => b,
            None => {
                return Err(AppError::new(
                    ErrorKind::NoMergeBase,
                    format!(
                        "no common ancestor between {} and the selected head",
                        base_ref.unwrap_or("HEAD")
                    ),
                ));
            }
        }
    } else {
        resolve_sha(repo, base_ref.unwrap_or("HEAD"))?
    };

    let range = format!("{base}..{head}");
    let mut extra: Vec<&str> = Vec::new();
    if first_parent {
        extra.push("--first-parent");
    }
    extra.push(&range);
    let mut metas = log_metas(repo, &extra)?;
    metas.reverse(); // oldest first: frames are [base] + commits
    let base_ts = log_metas(repo, &["-n", "1", &base])?.first().map(|m| m.commit_ts).unwrap_or(0);
    Ok(ReplayRange { base_sha: base, base_ts, head_sha: head, commits: metas })
}

/// Recent commits across all refs — feeds the commit picker.
pub fn recent_commits(repo: &Repo, limit: u32) -> Result<Vec<CommitMeta>, AppError> {
    let limit = limit.clamp(1, 2000).to_string();
    let args = ["--all", "-n", &limit];
    log_metas(repo, &args)
}

pub fn list_branches(repo: &Repo) -> Result<Vec<BranchInfo>, AppError> {
    let out = run_git(
        &repo.path,
        &["for-each-ref", "--format=%(refname:short)%00%(objectname)%00%(HEAD)", "refs/heads"],
    )
    .map_err(|e| AppError::git("could not list branches", e))?;
    let text = lossy(&out);
    // for-each-ref appends a newline after each ref's format output, so both
    // NUL and LF are field separators here.
    let fields: Vec<&str> = text.split(|c| c == '\0' || c == '\n').collect();
    let mut branches = Vec::with_capacity(fields.len() / 3);
    for chunk in fields.chunks(3) {
        if chunk.len() == 3 && !chunk[0].trim().is_empty() {
            branches.push(BranchInfo {
                name: chunk[0].trim().to_string(),
                sha: chunk[1].trim().to_string(),
                is_head: chunk[2].trim() == "*",
            });
        }
    }
    Ok(branches)
}

pub fn list_tags(repo: &Repo) -> Result<Vec<TagInfo>, AppError> {
    let out = run_git(
        &repo.path,
        &["for-each-ref", "--format=%(refname:short)%00%(*objectname)%00%(objectname)", "refs/tags"],
    )
    .map_err(|e| AppError::git("could not list tags", e))?;
    let text = lossy(&out);
    let fields: Vec<&str> = text.split(|c| c == '\0' || c == '\n').collect();
    let mut tags = Vec::with_capacity(fields.len() / 3);
    for chunk in fields.chunks(3) {
        if chunk.len() == 3 && !chunk[0].trim().is_empty() {
            // Prefer the peeled target (annotated tags), fall back to the tag object.
            let sha = if chunk[1].trim().is_empty() { chunk[2].trim() } else { chunk[1].trim() };
            tags.push(TagInfo { name: chunk[0].trim().to_string(), sha: sha.to_string() });
        }
    }
    Ok(tags)
}

/// Build `RepoInfo` for a freshly opened repo.
pub fn repo_info(repo: &Repo) -> Result<RepoInfo, AppError> {
    let head_sha = match resolve_sha(repo, "HEAD") {
        Ok(sha) => sha,
        Err(AppError { kind: ErrorKind::RefNotFound, .. }) => {
            return Err(AppError::new(ErrorKind::NoCommits, "no commits in this repository"));
        }
        Err(e) => return Err(e),
    };
    Ok(RepoInfo {
        id: repo.id,
        path: repo.path.to_string_lossy().into_owned(),
        default_branch: head_branch(repo)?,
        head_sha,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn metas(bytes: &[u8]) -> Vec<CommitMeta> {
        parse_log_metas(bytes)
    }

    #[test]
    fn parses_log_records() {
        let rec = b"abc123\x1fdef456 ghi789\x1fAlice\x1falice@x.io\x1f1000\x1fBob\x1fbob@x.io\x1f2000\x1fFix the thing\x1fbody line 1\nbody line 2\n\0";
        let m = metas(rec);
        assert_eq!(m.len(), 1);
        let m = &m[0];
        assert_eq!(m.sha, "abc123");
        assert_eq!(m.parents, vec!["def456", "ghi789"]);
        assert_eq!(m.author.name, "Alice");
        assert_eq!(m.author_ts, 1000);
        assert_eq!(m.committer.email, "bob@x.io");
        assert_eq!(m.subject, "Fix the thing");
        assert!(m.body.starts_with("body line 1"));
    }

    #[test]
    fn skips_malformed_records() {
        assert!(metas(b"garbage\0").is_empty());
    }
}
