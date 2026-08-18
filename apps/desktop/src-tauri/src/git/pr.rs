//! Pull requests as replay input (spec 9.4): the PR is just another way of
//! selecting a history. Uses the `gh` CLI when available (metadata, force-push
//! versions via GraphQL), with a plain `git fetch refs/pull/N/head` fallback
//! for public repositories. Core replay stays fully local after the fetch.

use super::{command, lossy, run_git, trim_line, Repo};
use crate::error::{AppError, ErrorKind};
use crate::git::history::resolve_replay;
use crate::git::types::{PrReplay, PrVersion, ReplayRange};

/// The GitHub slug (owner/repo) parsed from the origin remote, if any.
pub fn origin_slug(repo: &Repo) -> Option<(String, String)> {
    let out = run_git(&repo.path, &["config", "--get", "remote.origin.url"]).ok()?;
    let url = lossy(&out);
    let url = url.trim();
    parse_github_slug(url)
}

pub(crate) fn parse_github_slug(url: &str) -> Option<(String, String)> {
    let u = url.trim().trim_end_matches('/');
    if let Some(rest) = u.strip_prefix("https://github.com/").or_else(|| u.strip_prefix("http://github.com/")) {
        let rest = rest.strip_suffix(".git").unwrap_or(rest);
        let mut parts = rest.splitn(2, '/');
        return Some((parts.next()?.to_string(), parts.next()?.to_string()));
    }
    if let Some(rest) = u.strip_prefix("git@github.com:") {
        let rest = rest.strip_suffix(".git").unwrap_or(rest);
        let mut parts = rest.splitn(2, '/');
        return Some((parts.next()?.to_string(), parts.next()?.to_string()));
    }
    if let Some(rest) = u.strip_prefix("ssh://git@github.com/") {
        let rest = rest.strip_suffix(".git").unwrap_or(rest);
        let mut parts = rest.splitn(2, '/');
        return Some((parts.next()?.to_string(), parts.next()?.to_string()));
    }
    None
}

fn gh_available() -> bool {
    command("gh").arg("--version").stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null())
        .status().map(|s| s.success()).unwrap_or(false)
}

fn gh_json(args: &[&str]) -> Result<serde_json::Value, AppError> {
    let out = command("gh")
        .args(args)
        .env("GH_PROMPT_DISABLED", "1")
        .output()
        .map_err(|e| AppError::io("could not run gh CLI", e))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let stderr = stderr.trim();
        return Err(AppError::new(
            ErrorKind::GitFailed,
            format!("gh CLI failed: {}", stderr.lines().next().unwrap_or("unknown error")),
        ));
    }
    serde_json::from_slice(&out.stdout).map_err(|e| AppError::new(ErrorKind::GitFailed, format!("could not parse gh output: {e}")))
}

/// Extract a PR number from user input: `482`, `https://github.com/o/r/pull/482`
/// (with or without trailing path segments like `/files`).
fn parse_pr_number(input: &str) -> Option<u64> {
    let input = input.trim();
    if let Ok(n) = input.parse() {
        return Some(n);
    }
    let segments: Vec<&str> = input.split('/').collect();
    for (i, seg) in segments.iter().enumerate() {
        if *seg == "pull" {
            if let Some(next) = segments.get(i + 1).and_then(|s| s.parse().ok()) {
                return Some(next);
            }
        }
    }
    None
}

/// PR metadata via `gh pr view --json …`.
fn pr_meta_via_gh(slug: &(String, String), number: u64) -> Result<serde_json::Value, AppError> {
    let args = [
        "pr", "view", &number.to_string(), "--repo", &format!("{}/{}", slug.0, slug.1),
        "--json", "number,title,url,baseRefName,headRefName,baseRefOid,headRefOid",
    ];
    gh_json(&args)
}

/// Force-push versions (spec 20) via GraphQL `HEAD_REF_FORCE_PUSHED` events.
pub fn pr_versions(slug: &(String, String), number: u64, head_oid: &str) -> Result<Vec<PrVersion>, AppError> {
    if !gh_available() {
        return Ok(vec![PrVersion { number: 1, after_sha: head_oid.to_string(), before_sha: None, created_at: None }]);
    }
    let query = "query($owner:String!,$repo:String!,$n:Int!){
        repository(owner:$owner,name:$repo){
            pullRequest(number:$n){
                timelineItems(itemTypes:HEAD_REF_FORCE_PUSHED,last:50){
                    nodes{... on HeadRefForcePushedEvent{
                        beforeCommit{oid} afterCommit{oid} createdAt
                    }}
                }
            }
        }
    }";
    let out = command("gh")
        .args(["api", "graphql", "-f", &format!("query={query}"), "-f", &format!("owner={}", slug.0), "-f", &format!("repo={}", slug.1), "-F", &format!("n={number}")])
        .output()
        .map_err(|e| AppError::io("could not run gh CLI", e))?;
    if !out.status.success() {
        return Ok(vec![PrVersion { number: 1, after_sha: head_oid.to_string(), before_sha: None, created_at: None }]);
    }
    let json: serde_json::Value = match serde_json::from_slice(&out.stdout) {
        Ok(v) => v,
        Err(_) => return Ok(vec![PrVersion { number: 1, after_sha: head_oid.to_string(), before_sha: None, created_at: None }]),
    };
    let mut events: Vec<(Option<String>, String, Option<i64>)> = Vec::new();
    if let Some(nodes) = json.pointer("/data/repository/pullRequest/timelineItems/nodes").and_then(|v| v.as_array()) {
        for node in nodes {
            let after = node.pointer("/afterCommit/oid").and_then(|v| v.as_str()).map(String::from);
            let before = node.pointer("/beforeCommit/oid").and_then(|v| v.as_str()).map(String::from);
            let created = node.pointer("/createdAt").and_then(|v| v.as_str()).and_then(|s| parse_rfc3339(s));
            if let Some(after) = after {
                events.push((before, after, created));
            }
        }
    }
    events.sort_by_key(|e| e.2.unwrap_or(0));
    let mut versions: Vec<PrVersion> = Vec::new();
    for (idx, (before, after, created)) in events.into_iter().enumerate() {
        versions.push(PrVersion { number: idx + 1, after_sha: after, before_sha: before, created_at: created });
    }
    if versions.is_empty() || versions.last().map(|v| &v.after_sha) != Some(&head_oid.to_string()) {
        let number = versions.len() + 1;
        versions.push(PrVersion {
            number,
            after_sha: head_oid.to_string(),
            before_sha: versions.last().map(|v| v.after_sha.clone()),
            created_at: None,
        });
    }
    Ok(versions)
}

fn parse_rfc3339(s: &str) -> Option<i64> {
    // "2024-01-02T03:04:05Z" — strip the millisecond/Z suffix.
    let s = s.strip_suffix('Z').or_else(|| s.strip_suffix("+00:00"))?;
    let s = if let Some(dot) = s.find('.') { &s[..dot] } else { s };
    let mut parts = s.splitn(6, |c| c == '-' || c == ':' || c == 'T');
    let year: i64 = parts.next()?.parse().ok()?;
    let month: i64 = parts.next()?.parse().ok()?;
    let day: i64 = parts.next()?.parse().ok()?;
    let hour: i64 = parts.next()?.parse().ok()?;
    let minute: i64 = parts.next()?.parse().ok()?;
    let second: i64 = parts.next()?.parse().ok()?;
    // Days-from-civil algorithm (Howard Hinnant).
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    Some(days * 86_400 + hour * 3600 + minute * 60 + second)
}

/// Resolve a PR into a replay range. `version` may be a force-push version's
/// after-sha; None = current head.
pub fn resolve_pr(repo: &Repo, input: &str, version: Option<&str>) -> Result<PrReplay, AppError> {
    let number = parse_pr_number(input)
        .ok_or_else(|| AppError::new(ErrorKind::InvalidState, "expected a PR number or a github.com pull URL"))?;
    let slug = origin_slug(repo)
        .ok_or_else(|| AppError::new(ErrorKind::InvalidState, "this repository has no GitHub remote (origin)"))?;

    let (title, url, base_oid, head_oid) = if gh_available() {
        let meta = pr_meta_via_gh(&slug, number)?;
        let title = meta.pointer("/title").and_then(|v| v.as_str()).unwrap_or("Pull request").to_string();
        let url = meta.pointer("/url").and_then(|v| v.as_str()).unwrap_or_default().to_string();
        let base_oid = meta.pointer("/baseRefOid").and_then(|v| v.as_str()).ok_or_else(|| {
            AppError::new(ErrorKind::GitFailed, "gh returned no base commit for this PR")
        })?.to_string();
        let head_oid = meta.pointer("/headRefOid").and_then(|v| v.as_str()).ok_or_else(|| {
            AppError::new(ErrorKind::GitFailed, "gh returned no head commit for this PR")
        })?.to_string();
        (title, url, base_oid, head_oid)
    } else {
        // Fetch-only fallback for public repos.
        let refspec = format!("refs/pull/{number}/head");
        run_git(&repo.path, &["fetch", "-q", "origin", &refspec])
            .map_err(|e| AppError::new(ErrorKind::GitFailed, "could not fetch the PR head (run `gh auth login` for private repos)").with_git(e))?;
        let head_oid = {
            let out = run_git(&repo.path, &["rev-parse", "FETCH_HEAD"]).map_err(|e| AppError::git("could not resolve PR head", e))?;
            trim_line(&lossy(&out)).to_string()
        };
        let base_ref = {
            let out = run_git(&repo.path, &["symbolic-ref", "refs/remotes/origin/HEAD"])
                .map_err(|e| AppError::git("could not resolve the default branch", e))?;
            let r = trim_line(&lossy(&out)).to_string();
            r.strip_prefix("refs/remotes/origin/").unwrap_or("main").to_string()
        };
        let base_oid = {
            let out = run_git(&repo.path, &["rev-parse", &format!("origin/{base_ref}")])
                .map_err(|e| AppError::git("could not resolve the base commit", e))?;
            trim_line(&lossy(&out)).to_string()
        };
        (format!("PR #{number}"), format!("https://github.com/{}/{}/pull/{number}", slug.0, slug.1), base_oid, head_oid)
    };

    // Make sure the objects exist locally.
    let _ = run_git(&repo.path, &["fetch", "-q", "origin", &head_oid]);
    let _ = run_git(&repo.path, &["fetch", "-q", "origin", &base_oid]);

    let versions = pr_versions(&slug, number, &head_oid)?;

    // Replay at a specific force-pushed version when asked.
    let (base_sha, head_sha, resolved_version) = match version {
        Some(v) => {
            let target = versions.iter().find(|ver| ver.after_sha.starts_with(v) || ver.after_sha == v)
                .ok_or_else(|| AppError::new(ErrorKind::RefNotFound, format!("PR version not found: {v}")))?;
            let _ = run_git(&repo.path, &["fetch", "-q", "origin", &target.after_sha])
                .map_err(|e| AppError::new(ErrorKind::GitFailed, "this force-pushed version is no longer fetchable from GitHub").with_git(e))?;
            let base = target.before_sha.clone().unwrap_or_else(|| base_oid.clone());
            let _ = run_git(&repo.path, &["fetch", "-q", "origin", &base]);
            (base, target.after_sha.clone(), Some(target.number))
        }
        None => (base_oid, head_oid, None),
    };

    let range: ReplayRange = resolve_replay(repo, Some(&base_sha), Some(&head_sha), false, false)?;
    Ok(PrReplay { title, number, url, range, versions, resolved_version })
}

/// A browsable web URL for a commit, when the origin is GitHub.
pub fn commit_url(repo: &Repo, sha: &str) -> Option<String> {
    let (owner, name) = origin_slug(repo)?;
    Some(format!("https://github.com/{owner}/{name}/commit/{sha}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_github_slugs() {
        assert_eq!(parse_github_slug("https://github.com/org/repo.git"), Some(("org".into(), "repo".into())));
        assert_eq!(parse_github_slug("https://github.com/org/repo/"), Some(("org".into(), "repo".into())));
        assert_eq!(parse_github_slug("git@github.com:org/repo.git"), Some(("org".into(), "repo".into())));
        assert_eq!(parse_github_slug("ssh://git@github.com/org/repo"), Some(("org".into(), "repo".into())));
        assert_eq!(parse_github_slug("https://gitlab.com/o/r.git"), None);
    }

    #[test]
    fn parses_pr_numbers() {
        assert_eq!(parse_pr_number("482"), Some(482));
        assert_eq!(parse_pr_number("https://github.com/o/r/pull/482"), Some(482));
        assert_eq!(parse_pr_number("https://github.com/o/r/pull/482/files"), Some(482));
    }

    #[test]
    fn parses_timestamps() {
        assert_eq!(parse_rfc3339("2024-01-02T03:04:05Z"), Some(1704164645));
        assert_eq!(parse_rfc3339("2024-01-02T03:04:05.123Z"), Some(1704164645));
        assert_eq!(parse_rfc3339("nonsense"), None);
    }
}
