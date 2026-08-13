//! The repository as it existed at a commit: trees, blobs, and aggregate stats.
//!
//! Tree listings are content-addressed (listed by tree object SHA), which
//! sidesteps pathspec escaping entirely and makes listings cacheable by SHA.

use super::{is_binary, lossy, run_git, run_git_input, trim_line, Repo};
use crate::error::{AppError, ErrorKind};
use crate::git::types::{FileAtCommit, FileKind, SnapshotStats, TreeEntry};

use base64::Engine;

/// List a tree's entries. Accepts a tree SHA, a commit SHA, or a `rev:path`
/// spec. Peeling happens in two steps: `rev:path^{tree}` is not valid git
/// syntax, so resolve first, then peel.
pub fn tree_entries(repo: &Repo, treeish: &str) -> Result<Vec<TreeEntry>, AppError> {
    let resolved = run_git(&repo.path, &["rev-parse", "--verify", treeish])
        .map_err(|e| AppError::git("could not read the directory tree", e))?;
    let resolved = trim_line(&lossy(&resolved)).to_string();
    let tree = run_git(&repo.path, &["rev-parse", "--verify", &format!("{resolved}^{{tree}}")])
        .map_err(|e| AppError::git("could not read the directory tree", e))?;
    let tree = trim_line(&lossy(&tree)).to_string();
    let out = run_git(&repo.path, &["ls-tree", "-l", "-z", &tree])
        .map_err(|e| AppError::git("could not read the directory tree", e))?;
    Ok(parse_ls_tree(&out))
}

/// Parse `git ls-tree -l -z` output: `<mode> <type> <sha> <size|-}\t<name>\0`
/// (with `-l`, blobs carry a byte size in the meta; trees/submodules show "-").
pub fn parse_ls_tree(bytes: &[u8]) -> Vec<TreeEntry> {
    let mut entries = Vec::new();
    for entry in bytes.split(|&b| b == 0) {
        if entry.is_empty() {
            continue;
        }
        let Some((head, name)) = split_once_byte(entry, b'\t') else { continue };
        let parts: Vec<&[u8]> = head.split(|&b| b == b' ').collect();
        if parts.len() < 3 {
            continue;
        }
        let size = parts
            .get(3)
            .and_then(|s| std::str::from_utf8(s).ok())
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        entries.push(TreeEntry {
            name: lossy(name),
            kind: lossy(parts[1]),
            mode: lossy(parts[0]),
            size,
            object: lossy(parts[2]),
        });
    }
    entries
}

fn split_once_byte(bytes: &[u8], needle: u8) -> Option<(&[u8], &[u8])> {
    bytes.iter().position(|&b| b == needle).map(|i| (&bytes[..i], &bytes[i + 1..]))
}

/// Raw blob bytes, content-addressed by blob SHA.
pub fn blob_data(repo: &Repo, blob_sha: &str) -> Result<Vec<u8>, AppError> {
    run_git(&repo.path, &["cat-file", "blob", blob_sha])
        .map_err(|e| AppError::git("could not read file content", e))
}

/// The file `path` as it existed at commit `sha`.
pub fn file_at_commit(repo: &Repo, sha: &str, path: &str) -> Result<FileAtCommit, AppError> {
    let spec = format!("{sha}:{path}");
    let obj = run_git(&repo.path, &["rev-parse", "--verify", &spec]).map_err(|e| {
        let stderr = e.stderr.to_lowercase();
        if stderr.contains("path") && (stderr.contains("does not exist") || stderr.contains("not in")) {
            AppError::new(ErrorKind::ObjectNotFound, format!("path not found at this commit: {path}"))
        } else {
            AppError::git("could not resolve file", e)
        }
    })?;
    let obj = trim_line(&lossy(&obj)).to_string();

    // The parent entry's mode decides the kind — gitlinks (160000) are
    // submodules whose recorded commit may not even be cloned, so the mode
    // must be consulted before touching the object.
    let mode = parent_entry_mode(repo, sha, path)?.unwrap_or_else(|| "100644".to_string());

    if mode.starts_with("160000") {
        return Ok(FileAtCommit {
            path: path.to_string(),
            blob_sha: obj.clone(),
            size: 0,
            kind: FileKind::Submodule,
            content: None,
            content_base64: None,
            symlink_target: None,
            submodule_sha: Some(obj),
        });
    }

    let data = blob_data(repo, &obj)?;
    let size = data.len() as u64;

    if mode.starts_with("120000") {
        let target = lossy(&data);
        return Ok(FileAtCommit {
            path: path.to_string(),
            blob_sha: obj,
            size,
            kind: FileKind::Symlink,
            content: None,
            content_base64: None,
            symlink_target: Some(target.trim_end().to_string()),
            submodule_sha: None,
        });
    }

    if is_binary(&data) {
        let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
        return Ok(FileAtCommit {
            path: path.to_string(),
            blob_sha: obj,
            size,
            kind: FileKind::Binary,
            content: None,
            content_base64: Some(b64),
            symlink_target: None,
            submodule_sha: None,
        });
    }

    Ok(FileAtCommit {
        path: path.to_string(),
        blob_sha: obj,
        size,
        kind: FileKind::Text,
        content: Some(lossy(&data)),
        content_base64: None,
        symlink_target: None,
        submodule_sha: None,
    })
}

/// Look up `path`'s mode string by listing its parent directory.
pub(crate) fn parent_entry_mode(repo: &Repo, sha: &str, path: &str) -> Result<Option<String>, AppError> {
    let (dir, name) = match path.rfind('/') {
        Some(i) => (&path[..i], &path[i + 1..]),
        None => ("", path),
    };
    let treeish = if dir.is_empty() { format!("{sha}^{{tree}}") } else { format!("{sha}:{dir}") };
    let entries = tree_entries(repo, &treeish)?;
    Ok(entries.into_iter().find(|e| e.name == name).map(|e| e.mode))
}

const LOC_MAX_FILES: u64 = 20_000;
const LOC_MAX_BYTES: u64 = 100 * 1024 * 1024;
const LOC_MAX_BLOB: u64 = 32 * 1024 * 1024;

/// Files, directories, and (when affordable) lines of code at a commit.
pub fn snapshot_stats(repo: &Repo, sha: &str) -> Result<SnapshotStats, AppError> {
    // -t includes tree rows (ls-tree -r alone lists only leaves).
    let out = run_git(&repo.path, &["ls-tree", "-r", "-t", "-l", "-z", sha])
        .map_err(|e| AppError::git("could not read the repository tree", e))?;
    let entries = parse_ls_tree(&out);

    let mut files = 0u64;
    let mut dirs = 0u64;
    let mut blobs: Vec<String> = Vec::new();
    let mut total_bytes = 0u64;
    for e in &entries {
        match e.kind.as_str() {
            "tree" => dirs += 1,
            "blob" => {
                files += 1;
                if files <= LOC_MAX_FILES && e.size <= LOC_MAX_BLOB {
                    total_bytes += e.size;
                    blobs.push(e.object.clone());
                }
            }
            // Submodule entries count as files for the tree view.
            _ => files += 1,
        }
    }

    let loc = if files <= LOC_MAX_FILES && total_bytes <= LOC_MAX_BYTES {
        Some(count_lines(repo, &blobs)?)
    } else {
        None
    };

    Ok(SnapshotStats { files, dirs, loc })
}

/// Count newlines across blobs via a single `cat-file --batch` run, skipping
/// binary content.
fn count_lines(repo: &Repo, blob_shas: &[String]) -> Result<u64, AppError> {
    if blob_shas.is_empty() {
        return Ok(0);
    }
    let mut input = String::new();
    for sha in blob_shas {
        input.push_str(sha);
        input.push('\n');
    }
    let out = run_git_input(&repo.path, &["cat-file", "--batch"], input.as_bytes())
        .map_err(|e| AppError::git("could not count lines", e))?;

    let mut loc = 0u64;
    let mut i = 0usize;
    let bytes = &out[..];
    while i < bytes.len() {
        // Header line: "<sha> <type> <size>\n"
        let line_end = match bytes[i..].iter().position(|&b| b == b'\n') {
            Some(p) => i + p,
            None => break,
        };
        let line = lossy(&bytes[i..line_end]);
        let mut parts = line.split_whitespace();
        let (_sha, _type, size) = (parts.next(), parts.next(), parts.next());
        let Some(size) = size.and_then(|s| s.parse::<usize>().ok()) else {
            // "<sha> missing" — the object vanished; skip.
            i = line_end + 1;
            continue;
        };
        let content = &bytes[line_end + 1..line_end + 1 + size];
        if !is_binary(content) {
            loc += content.iter().filter(|&&b| b == b'\n').count() as u64;
        }
        i = line_end + 1 + size;
        if i < bytes.len() && bytes[i] == b'\n' {
            i += 1;
        }
    }
    Ok(loc)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ls_tree_output() {
        let bytes = b"100644 blob abc123 42\tfile.ts\0040000 tree def456 -\tsrc\0160000 commit 0123456 -\tsub\0";
        let entries = parse_ls_tree(bytes);
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].name, "file.ts");
        assert_eq!(entries[0].kind, "blob");
        assert_eq!(entries[0].size, 42);
        assert_eq!(entries[1].kind, "tree");
        assert_eq!(entries[1].size, 0);
        assert_eq!(entries[2].kind, "commit");
        assert_eq!(entries[2].object, "0123456");
    }
}
