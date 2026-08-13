//! Programmatic fixture repositories, built with the real git CLI.
//!
//! Every git invocation runs with an isolated identity and configuration, so
//! fixtures never touch the developer's global git config.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

pub struct Fixture {
    _tmp: tempfile::TempDir,
    pub dir: PathBuf,
}

fn git_env() -> Vec<(&'static str, String)> {
    vec![
        ("GIT_AUTHOR_NAME", "Fixture Author".into()),
        ("GIT_AUTHOR_EMAIL", "fixture@test.local".into()),
        ("GIT_COMMITTER_NAME", "Fixture Committer".into()),
        ("GIT_COMMITTER_EMAIL", "fixture@test.local".into()),
        ("GIT_CONFIG_NOSYSTEM", "1".into()),
        ("GIT_CONFIG_GLOBAL", "NUL".into()), // nonexistent → isolated config
    ]
}

pub fn run_git(dir: &Path, args: &[&str]) -> Vec<u8> {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .envs(git_env())
        .args(args)
        .output()
        .expect("git must be installed for these tests");
    assert!(
        out.status.success(),
        "git {} failed:\n{}",
        args.join(" "),
        String::from_utf8_lossy(&out.stderr)
    );
    out.stdout
}

pub fn run_git_env(dir: &Path, args: &[&str], envs: &[(&str, &str)]) -> Vec<u8> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(dir).envs(git_env()).args(args);
    for (k, v) in envs {
        cmd.env(k, v);
    }
    let out = cmd.output().expect("git must be installed for these tests");
    assert!(
        out.status.success(),
        "git {} failed:\n{}",
        args.join(" "),
        String::from_utf8_lossy(&out.stderr)
    );
    out.stdout
}

pub fn init() -> Fixture {
    let tmp = tempfile::tempdir().expect("tempdir");
    run_git(tmp.path(), &["init", "-q", "-b", "main"]);
    let dir = tmp.path().to_path_buf();
    Fixture { _tmp: tmp, dir }
}

pub fn write(dir: &Path, rel: &str, content: &str) {
    let full = dir.join(rel);
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).expect("create parent dirs");
    }
    fs::write(full, content).expect("write fixture file");
}

pub fn write_bytes(dir: &Path, rel: &str, content: &[u8]) {
    let full = dir.join(rel);
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).expect("create parent dirs");
    }
    fs::write(full, content).expect("write fixture file");
}

pub fn sha(dir: &Path) -> String {
    let out = run_git(dir, &["rev-parse", "HEAD"]);
    String::from_utf8(out).expect("sha utf8").trim().to_string()
}

pub fn commit(dir: &Path, msg: &str) -> String {
    run_git(dir, &["add", "-A"]);
    run_git(dir, &["commit", "-q", "-m", msg]);
    sha(dir)
}

/// Commit the index as-is, without `git add -A` — required for entries
/// staged via `update-index --cacheinfo` (gitlinks/symlinks have no worktree
/// files, and `add -A` would stage their deletion).
pub fn commit_index(dir: &Path, msg: &str) -> String {
    run_git(dir, &["commit", "-q", "-m", msg]);
    sha(dir)
}

pub fn empty_commit(dir: &Path, msg: &str) -> String {
    run_git(dir, &["commit", "-q", "--allow-empty", "-m", msg]);
    sha(dir)
}

pub fn commit_with_date(dir: &Path, msg: &str, date: &str) -> String {
    run_git(dir, &["add", "-A"]);
    run_git_env(dir, &["commit", "-q", "-m", msg], &[("GIT_AUTHOR_DATE", date), ("GIT_COMMITTER_DATE", date)]);
    sha(dir)
}

pub fn tag(dir: &Path, name: &str) {
    run_git(dir, &["tag", name]);
}

pub fn checkout_b(dir: &Path, name: &str) {
    run_git(dir, &["checkout", "-q", "-b", name]);
}

pub fn checkout(dir: &Path, target: &str) {
    run_git(dir, &["checkout", "-q", target]);
}

pub fn merge_noff(dir: &Path, branch: &str, msg: &str) -> String {
    run_git(dir, &["merge", "-q", "--no-ff", branch, "-m", msg]);
    sha(dir)
}

/// Add a gitlink (submodule) entry without needing a real submodule clone.
pub fn add_gitlink(dir: &Path, path: &str) {
    let fake_sha = "0123456789012345678901234567890123456789";
    run_git(dir, &["update-index", "--add", "--cacheinfo", &format!("160000,{fake_sha},{path}")]);
}

/// Add a symlink entry without needing OS symlink support: the blob is the
/// target path, the mode is 120000.
pub fn add_symlink_entry(dir: &Path, path: &str, target: &str) {
    let tmp = dir.join(".git").join("symlink-target-tmp");
    fs::write(&tmp, target).expect("write symlink target temp");
    let blob = run_git(dir, &["hash-object", "-w", tmp.to_str().unwrap()]);
    let blob = String::from_utf8(blob).expect("utf8").trim().to_string();
    run_git(dir, &["update-index", "--add", "--cacheinfo", &format!("120000,{blob},{path}")]);
}

// ---------------------------------------------------------------------------
// Fixture shapes
// ---------------------------------------------------------------------------

/// 4 linear commits touching progressively more files.
pub struct Linear {
    pub f: Fixture,
    pub c1: String,
    pub c2: String,
    pub c3: String,
    pub c4: String,
}

pub fn linear() -> Linear {
    let f = init();
    write(&f.dir, "README.md", "# demo\n");
    write(&f.dir, "src/a.ts", "export const a = 1;\n");
    let c1 = commit(&f.dir, "initial commit");
    write(&f.dir, "src/service.ts", "export class Service {}\n");
    let c2 = commit(&f.dir, "add service");
    write(&f.dir, "src/a.ts", "export const a = 1;\nexport const b = 2;\n");
    let c3 = commit(&f.dir, "extend a");
    write(&f.dir, "tests/a.test.ts", "import { a } from '../src/a';\n");
    let c4 = commit(&f.dir, "add tests");
    Linear { f, c1, c2, c3, c4 }
}

/// A feature branch off main, never merged — the classic branch replay shape.
pub struct Branch {
    pub f: Fixture,
    pub base: String,
    pub feat1: String,
    pub feat2: String,
    pub main_extra: String,
}

pub fn with_branch() -> Branch {
    let f = init();
    write(&f.dir, "base.ts", "export const base = 0;\n");
    let base = commit(&f.dir, "base");
    checkout_b(&f.dir, "feature");
    write(&f.dir, "feature.ts", "export const feature = 1;\n");
    let feat1 = commit(&f.dir, "feat one");
    write(&f.dir, "feature2.ts", "export const feature2 = 2;\n");
    let feat2 = commit(&f.dir, "feat two");
    checkout(&f.dir, "main");
    write(&f.dir, "main_extra.ts", "export const extra = 3;\n");
    let main_extra = commit(&f.dir, "main work");
    Branch { f, base, feat1, feat2, main_extra }
}

/// main → feature (2 commits) → main advances → --no-ff merge.
pub struct Merge {
    pub f: Fixture,
    pub base: String,
    pub feat1: String,
    pub feat2: String,
    pub main_extra: String,
    pub merge: String,
}

pub fn with_merge() -> Merge {
    let f = init();
    write(&f.dir, "base.ts", "export const base = 0;\n");
    let base = commit(&f.dir, "base");
    checkout_b(&f.dir, "feature");
    write(&f.dir, "feature.ts", "export const feature = 1;\n");
    let feat1 = commit(&f.dir, "feat one");
    write(&f.dir, "feature2.ts", "export const feature2 = 2;\n");
    let feat2 = commit(&f.dir, "feat two");
    checkout(&f.dir, "main");
    write(&f.dir, "main_extra.ts", "export const extra = 3;\n");
    let main_extra = commit(&f.dir, "main work");
    let merge = merge_noff(&f.dir, "feature", "Merge feature");
    Merge { f, base, feat1, feat2, main_extra, merge }
}

/// A file created, then renamed (+modified), then modified again. An initial
/// commit exists so replay ranges can include the creation.
pub struct Rename {
    pub f: Fixture,
    pub init: String,
    pub create: String,
    pub rename: String,
    pub modify: String,
}

pub fn with_rename() -> Rename {
    let f = init();
    write(&f.dir, "README.md", "# repo\n");
    let init = commit(&f.dir, "init");
    let content = "line 1\nline 2\nline 3\nline 4\nline 5\n";
    write(&f.dir, "worker.ts", content);
    let create = commit(&f.dir, "create worker");
    fs::rename(f.dir.join("worker.ts"), f.dir.join("deployment-worker.ts")).expect("rename");
    write(&f.dir, "deployment-worker.ts", &format!("{content}line 6\n"));
    let rename = commit(&f.dir, "rename and extend worker");
    write(&f.dir, "deployment-worker.ts", &format!("{content}line 6\nline 7\n"));
    let modify = commit(&f.dir, "extend worker again");
    Rename { f, init, create, rename, modify }
}

/// Text plus binary content in one commit.
pub struct Binary {
    pub f: Fixture,
    pub c1: String,
}

pub fn with_binary() -> Binary {
    let f = init();
    write(&f.dir, "notes.txt", "some notes\n");
    let mut png = vec![0u8, 1, 2, 3];
    png.extend(std::iter::repeat(0u8).take(64));
    png.extend([0xff, 0x00, 0x00, 0xfe]);
    write_bytes(&f.dir, "assets/image.png", &png);
    let c1 = commit(&f.dir, "add assets");
    Binary { f, c1 }
}

/// A commit whose author date is in the future relative to the merge — naive
/// timestamp ordering would place it after its own merge commit.
pub struct Skewed {
    pub f: Fixture,
    pub base: String,
    pub feat: String,
    pub merge: String,
}

pub fn with_skewed_dates() -> Skewed {
    let f = init();
    write(&f.dir, "a.ts", "const a = 1;\n");
    let base = commit_with_date(&f.dir, "base commit", "2024-01-01T00:00:00Z");
    checkout_b(&f.dir, "feature");
    write(&f.dir, "feature.ts", "const f = 1;\n");
    let feat = commit_with_date(&f.dir, "future-dated feature work", "2030-01-01T00:00:00Z");
    checkout(&f.dir, "main");
    let merge = merge_noff(&f.dir, "feature", "Merge feature");
    Skewed { f, base, feat, merge }
}

/// A copy detected by git's -C (source modified in the same commit).
pub struct Copy {
    pub f: Fixture,
    pub c1: String,
    pub c2: String,
}

pub fn with_copy() -> Copy {
    let f = init();
    let original = "line 1\nline 2\nline 3\nline 4\nline 5\n";
    write(&f.dir, "a.ts", original);
    let c1 = commit(&f.dir, "add a");
    write(&f.dir, "a.ts", &format!("{original}line 6\n"));
    write(&f.dir, "b.ts", original);
    let c2 = commit(&f.dir, "modify a, copy to b");
    Copy { f, c1, c2 }
}

pub struct Tags {
    pub f: Fixture,
    pub c1: String,
    pub c2: String,
    pub c3: String,
}

pub fn with_tags() -> Tags {
    let f = init();
    write(&f.dir, "one.ts", "const one = 1;\n");
    let c1 = commit(&f.dir, "one");
    write(&f.dir, "two.ts", "const two = 2;\n");
    let c2 = commit(&f.dir, "two");
    tag(&f.dir, "v1.0");
    write(&f.dir, "three.ts", "const three = 3;\n");
    let c3 = commit(&f.dir, "three");
    Tags { f, c1, c2, c3 }
}

pub struct Special {
    pub f: Fixture,
    pub c1: String,
}

/// Symlink entry (mode 120000) + gitlink (mode 160000) via update-index.
/// A base commit exists first: update-index --cacheinfo needs a real HEAD.
pub fn with_special_entries() -> Special {
    let f = init();
    write(&f.dir, "base.txt", "base\n");
    commit(&f.dir, "base commit");
    add_symlink_entry(&f.dir, "link.txt", "target.txt");
    add_gitlink(&f.dir, "vendor/lib");
    let c1 = commit_index(&f.dir, "add symlink and submodule");
    Special { f, c1 }
}

pub struct Large {
    pub f: Fixture,
    pub c1: String,
}

/// A 1500-line file in one commit.
pub fn with_large_diff() -> Large {
    let f = init();
    let content: String = (0..1500).map(|i| format!("export const n{i} = {i};\n")).collect();
    write(&f.dir, "src/generated.ts", &content);
    let c1 = commit(&f.dir, "generate large file");
    Large { f, c1 }
}

pub struct BigHistory {
    pub f: Fixture,
    pub first: String,
    pub last: String,
    pub count: usize,
}

/// A repository with `n` linear commits; every 10th commit touches
/// `src/tracked.ts` with a searchable marker.
pub fn with_big_history(n: usize) -> BigHistory {
    let f = init();
    write(&f.dir, "README.md", "big\n");
    let first = commit(&f.dir, "commit 0000");
    for i in 1..n {
        if i % 10 == 0 {
            let content: String = (0..50).map(|j| format!("line {j}\n")).collect();
            write(&f.dir, "src/tracked.ts", &format!("// iteration {i:04}\n{content}"));
        } else {
            let content: String = (0..5).map(|j| format!("v{j}\n")).collect();
            write(&f.dir, "src/churn.ts", &format!("// churn {i:04}\n{content}"));
        }
        commit(&f.dir, &format!("commit {i:04}"));
    }
    let last = sha(&f.dir);
    BigHistory { f, first, last, count: n }
}
