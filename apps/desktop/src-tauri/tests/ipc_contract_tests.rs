//! The IPC wire contract, pinned at the source: every serialized domain type
//! must carry camelCase keys, because the frontend reads camelCase fields.
//! (This class of mismatch caused the "nothing happened" bug — the UI silently
//! read `undefined` from snake_case payloads. It must never regress.)

use git_replay_lib::git::types::*;

fn keys<T: serde::Serialize>(value: &T) -> std::collections::HashSet<String> {
    serde_json::to_value(value).expect("serialize").as_object().expect("object").keys().cloned().collect()
}

fn has(keys: &std::collections::HashSet<String>, expected: &[&str]) {
    for k in expected {
        assert!(keys.contains(*k), "missing camelCase key `{k}` — got {keys:?}");
    }
}

fn identity() -> Identity {
    Identity { name: "n".into(), email: "e".into() }
}

#[test]
fn range_uses_camel_case() {
    let range = ReplayRange {
        base_sha: "b".into(),
        base_ts: 1,
        head_sha: "h".into(),
        commits: vec![CommitMeta {
            sha: "s".into(),
            parents: vec![],
            author: identity(),
            committer: identity(),
            author_ts: 1,
            commit_ts: 2,
            subject: "subj".into(),
            body: String::new(),
        }],
    };
    has(&keys(&range), &["baseSha", "baseTs", "headSha", "commits"]);
    let commit = serde_json::to_value(&range).expect("json");
    has(
        &commit["commits"][0].as_object().unwrap().keys().cloned().collect(),
        &["sha", "parents", "author", "committer", "authorTs", "commitTs", "subject", "body"],
    );
}

#[test]
fn detail_and_changes_use_camel_case() {
    let detail = CommitDetail {
        meta: CommitMeta {
            sha: "s".into(),
            parents: vec![],
            author: identity(),
            committer: identity(),
            author_ts: 1,
            commit_ts: 1,
            subject: "s".into(),
            body: String::new(),
        },
        stats: CommitStats { files_changed: 1, insertions: 2, deletions: 3 },
        files: vec![FileChange {
            old_path: Some("old".into()),
            new_path: "new".into(),
            status: FileStatus::Renamed,
            similarity: Some(90),
            additions: 1,
            deletions: 2,
            binary: false,
            whitespace_only: true,
        }],
    };
    let v = serde_json::to_value(&detail).expect("json");
    has(&keys(&detail.stats), &["filesChanged", "insertions", "deletions"]);
    let file = &v["files"][0];
    has(
        &file.as_object().unwrap().keys().cloned().collect(),
        &["oldPath", "newPath", "status", "similarity", "additions", "deletions", "binary", "whitespaceOnly"],
    );
    assert_eq!(file["status"], "renamed");
}

#[test]
fn snapshot_types_use_camel_case() {
    let file = FileAtCommit {
        path: "p".into(),
        blob_sha: "b".into(),
        size: 1,
        kind: FileKind::Text,
        content: Some("c".into()),
        content_base64: None,
        symlink_target: None,
        submodule_sha: None,
    };
    has(&keys(&file), &["path", "blobSha", "size", "kind", "content", "contentBase64", "symlinkTarget", "submoduleSha"]);
    assert_eq!(serde_json::to_value(FileKind::Binary).expect("json"), "binary");
    assert_eq!(serde_json::to_value(FileKind::Submodule).expect("json"), "submodule");

    let entry = TreeEntry { name: "n".into(), kind: "blob".into(), mode: "100644".into(), size: 0, object: "o".into() };
    has(&keys(&entry), &["name", "kind", "mode", "size", "object"]);

    let stats = SnapshotStats { files: 1, dirs: 2, loc: Some(3) };
    has(&keys(&stats), &["files", "dirs", "loc"]);
}

#[test]
fn working_tree_and_evolution_use_camel_case() {
    let wt = WorkingTreeFrame {
        files: vec![],
        stats: CommitStats { files_changed: 0, insertions: 0, deletions: 0 },
        untracked: 2,
    };
    has(&keys(&wt), &["files", "stats", "untracked"]);

    let evo = EvolutionEntry {
        sha: "s".into(),
        subject: "s".into(),
        commit_ts: 1,
        status: FileStatus::Added,
        old_path: None,
        new_path: "p".into(),
        similarity: None,
        additions: 0,
        deletions: 0,
    };
    has(&keys(&evo), &["sha", "subject", "commitTs", "status", "oldPath", "newPath", "similarity", "additions", "deletions"]);
    assert_eq!(serde_json::to_value(FileStatus::TypeChanged).expect("json"), "typeChanged");
    assert_eq!(serde_json::to_value(FileStatus::Untracked).expect("json"), "untracked");
}

#[test]
fn repo_pr_and_meta_types_use_camel_case() {
    let repo = RepoInfo { id: 1, path: "p".into(), default_branch: Some("main".into()), head_sha: "h".into() };
    has(&keys(&repo), &["id", "path", "defaultBranch", "headSha"]);

    let branch = BranchInfo { name: "main".into(), sha: "s".into(), is_head: true };
    has(&keys(&branch), &["name", "sha", "isHead"]);

    let pr = PrReplay {
        title: "t".into(),
        number: 1,
        url: "u".into(),
        range: ReplayRange { base_sha: "b".into(), base_ts: 0, head_sha: "h".into(), commits: vec![] },
        versions: vec![PrVersion { number: 1, after_sha: "a".into(), before_sha: None, created_at: None }],
        resolved_version: Some(1),
    };
    has(&keys(&pr), &["title", "number", "url", "range", "versions", "resolvedVersion"]);
    has(&keys(&pr.versions[0]), &["number", "afterSha", "beforeSha", "createdAt"]);

    let head = HeadState { sha: "s".into(), branch: Some("b".into()), dirty: true };
    has(&keys(&head), &["sha", "branch", "dirty"]);

    let cache = CacheInfo { path: "p".into(), size_bytes: 42 };
    has(&keys(&cache), &["path", "sizeBytes"]);

    let result = SearchResult { sha: "s".into(), subject: "s".into(), commit_ts: 1, kind: "message".into() };
    has(&keys(&result), &["sha", "subject", "commitTs", "kind"]);

    let diff = FileDiff { patch: None, binary: true };
    has(&keys(&diff), &["patch", "binary"]);
}
