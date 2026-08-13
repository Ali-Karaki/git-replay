//! The Git engine: a thin, disciplined layer over the system Git CLI.
//!
//! Rules (see ADR-0002):
//! - Plumbing commands only, with `-z` (NUL-separated) machine-readable output.
//! - Human-formatted output is never parsed.
//! - No shell; arguments are passed directly, so paths need no quoting.
//! - Tree listings are addressed by object SHA, sidestepping pathspec escaping.
//! - Reads run with `GIT_OPTIONAL_LOCKS=0` and never prompt.

pub mod changes;
pub mod diff;
pub mod evolution;
pub mod history;
pub mod search;
pub mod snapshot;
pub mod types;

use crate::error::GitFailure;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// The git tree object of the empty tree — the diff base for root commits.
pub const EMPTY_TREE_SHA: &str = "4b825dc642cb6eb9a0506e54bf8d69288fbee4904";

/// An opened repository. Cheap to clone; commands run against `path`.
#[derive(Debug, Clone)]
pub struct Repo {
    pub id: u32,
    pub path: PathBuf,
}

/// Run git in `repo` and return stdout. Fails on non-zero exit.
pub fn run_git<S: AsRef<OsStr>>(repo: &Path, args: &[S]) -> Result<Vec<u8>, GitFailure> {
    run_git_full(repo, args, None)
}

/// Run git feeding `input` on stdin (used for `cat-file --batch`).
pub fn run_git_input<S: AsRef<OsStr>>(repo: &Path, args: &[S], input: &[u8]) -> Result<Vec<u8>, GitFailure> {
    run_git_full(repo, args, Some(input))
}

fn run_git_full<S: AsRef<OsStr>>(repo: &Path, args: &[S], input: Option<&[u8]>) -> Result<Vec<u8>, GitFailure> {
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(repo)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .args(args)
        .stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| GitFailure {
        stderr: format!("failed to spawn git: {e}"),
        status: None,
    })?;

    if let Some(data) = input {
        use std::io::Write;
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(data);
        }
        // Dropping the handle above closes stdin; take again defensively.
        drop(child.stdin.take());
    }

    let output = child.wait_with_output().map_err(|e| GitFailure {
        stderr: format!("failed to read git output: {e}"),
        status: None,
    })?;

    if output.status.success() {
        Ok(output.stdout)
    } else {
        Err(GitFailure {
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
            status: output.status.code(),
        })
    }
}

/// Lossy but deterministic byte→string conversion for path-ish data.
pub fn lossy(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

/// Strip a single trailing newline (LF or CRLF), as emitted by git for
/// line-oriented outputs.
pub fn trim_line(s: &str) -> &str {
    s.strip_suffix('\n').map(|t| t.strip_suffix('\r').unwrap_or(t)).unwrap_or(s)
}

/// Quote a pathspec so glob metacharacters are literal, then wrap in the
/// `:(literal)` magic so git never re-interprets it.
pub fn literal_pathspec(path: &str) -> String {
    format!(":(literal){path}")
}

/// True when the first chunk of `data` contains a NUL byte — git's own
/// heuristic for binary content, applied consistently.
pub fn is_binary(data: &[u8]) -> bool {
    data[..data.len().min(8192)].contains(&0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trim_line_handles_crlf_and_lf() {
        assert_eq!(trim_line("abc\n"), "abc");
        assert_eq!(trim_line("abc\r\n"), "abc");
        assert_eq!(trim_line("abc"), "abc");
    }

    #[test]
    fn binary_sniff_detects_nul() {
        assert!(is_binary(b"a\0b"));
        assert!(!is_binary(b"plain text"));
    }
}
