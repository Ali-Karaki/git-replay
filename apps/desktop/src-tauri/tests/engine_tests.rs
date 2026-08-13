//! Invariant tests for the replay engine, run against programmatic fixture
//! repositories built with the real git CLI. The engine is tested
//! independently of the UI, per the spec.

mod fixtures;

use fixtures::*;
use git_replay_lib::cache::CacheStore;
use git_replay_lib::git::types::{FileKind, FileStatus};
use git_replay_lib::git::{self, Repo};
use git_replay_lib::state::AppState;

fn repo(f: &Fixture) -> Repo {
    Repo { id: 1, path: f.dir.clone() }
}

fn subjects(range: &git_replay_lib::git::types::ReplayRange) -> Vec<String> {
    range.commits.iter().map(|c| c.subject.clone()).collect()
}

// -- range resolution --------------------------------------------------------

#[test]
fn linear_range_returns_commits_oldest_first() {
    let l = linear();
    let r = repo(&l.f);
    let range = git::history::resolve_replay(&r, Some(&l.c1), None, false, false).expect("resolve");
    assert_eq!(range.base_sha, l.c1);
    assert_eq!(range.head_sha, l.c4);
    assert_eq!(subjects(&range), vec!["add service", "extend a", "add tests"]);
    // Ancestry is respected: each commit's parent is the previous frame.
    assert_eq!(range.commits[0].parents, vec![l.c1.clone()]);
    assert_eq!(range.commits[1].parents, vec![l.c2.clone()]);
    assert_eq!(range.commits[2].parents, vec![l.c3.clone()]);
    // The root commit is discoverable for "entire repository" replays.
    assert_eq!(git::history::root_commit(&r, "HEAD").expect("root"), l.c1);
}

#[test]
fn branch_replay_resolves_merge_base() {
    let b = with_branch();
    let r = repo(&b.f);
    let range = git::history::resolve_replay(&r, Some("main"), Some("feature"), true, false).expect("resolve");
    assert_eq!(range.base_sha, b.base, "Frame 0 must be the merge base");
    assert_eq!(subjects(&range), vec!["feat one", "feat two"]);
    assert_eq!(range.head_sha, b.feat2);
    assert_eq!(range.commits[0].sha, b.feat1);
    // Replaying from main's actual tip (not the merge base) gives the same
    // feature commits, since main never touched the feature files.
    let exact = git::history::resolve_replay(&r, Some(&b.main_extra), Some("feature"), false, false).expect("resolve");
    assert_eq!(subjects(&exact), vec!["feat one", "feat two"]);
}

#[test]
fn full_range_includes_merged_branch_and_merge_commit() {
    let m = with_merge();
    let r = repo(&m.f);
    // Base = main before the merge; head = the merge itself.
    let range = git::history::resolve_replay(&r, Some(&m.main_extra), Some(&m.merge), false, false).expect("resolve");
    assert_eq!(range.commits.len(), 3);
    assert_eq!(range.commits[0].sha, m.feat1);
    assert_eq!(range.commits[1].sha, m.feat2);
    assert_eq!(range.commits[2].sha, m.merge);
    // From the original base, the replay covers the whole main-line story too.
    let all = git::history::resolve_replay(&r, Some(&m.base), Some(&m.merge), false, false).expect("resolve");
    assert_eq!(all.commits.len(), 4);
    assert!(all.commits.iter().any(|c| c.sha == m.main_extra));
    assert!(all.commits.iter().any(|c| c.sha == m.merge));
}

#[test]
fn merge_base_of_merged_branch_is_the_merge_itself() {
    // Once feature is merged into main, merge-base(main, feature) = feature's
    // tip — the replay is empty. Correct semantics, worth pinning.
    let m = with_merge();
    let r = repo(&m.f);
    let range = git::history::resolve_replay(&r, Some("main"), Some("feature"), true, false).expect("resolve");
    assert_eq!(range.base_sha, m.feat2);
    assert!(range.commits.is_empty());
}

#[test]
fn first_parent_flag_prunes_side_branches() {
    let m = with_merge();
    let r = repo(&m.f);
    let range = git::history::resolve_replay(&r, Some(&m.main_extra), Some(&m.merge), false, true).expect("resolve");
    assert_eq!(range.commits.len(), 1, "first-parent walk skips the feature commits");
    assert_eq!(range.commits[0].sha, m.merge);
}

// -- commit semantics --------------------------------------------------------

#[test]
fn merge_commit_compares_first_parent_by_default_and_second_on_request() {
    let m = with_merge();
    let r = repo(&m.f);
    let meta = git::history::log_metas(&r, &["-n", "1", &m.merge]).expect("meta").remove(0);
    assert_eq!(meta.parents, vec![m.main_extra.clone(), m.feat2.clone()], "first parent = main, second = feature");

    // Default: diff against the first parent (main) → feature files appear added.
    let detail = git::changes::commit_detail(&r, &meta, None).expect("detail");
    let paths: Vec<&str> = detail.files.iter().map(|f| f.new_path.as_str()).collect();
    assert!(paths.contains(&"feature.ts"), "first-parent diff should show feature.ts as added: {paths:?}");
    assert!(!paths.contains(&"main_extra.ts"), "first-parent diff must not show main_extra.ts: {paths:?}");

    // Explicit second parent: main_extra.ts appears added.
    let detail = git::changes::commit_detail(&r, &meta, Some(1)).expect("detail 2nd parent");
    let paths: Vec<&str> = detail.files.iter().map(|f| f.new_path.as_str()).collect();
    assert!(paths.contains(&"main_extra.ts"), "second-parent diff should show main_extra.ts: {paths:?}");
    assert!(!paths.contains(&"feature.ts"), "second-parent diff must not show feature.ts: {paths:?}");
}

#[test]
fn topology_beats_author_dates() {
    let s = with_skewed_dates();
    let r = repo(&s.f);
    let range = git::history::resolve_replay(&r, Some(&s.base), Some(&s.merge), false, false).expect("resolve");
    // feat's author date (2030) is after the merge's (2024) — a timestamp
    // sort would wrongly put the merge first. Topology must win.
    assert_eq!(range.commits[0].sha, s.feat);
    assert_eq!(range.commits[1].sha, s.merge);
}

#[test]
fn root_commit_diffs_against_empty_tree() {
    let l = linear();
    let r = repo(&l.f);
    let meta = git::history::log_metas(&r, &["-n", "1", &l.c1]).expect("meta").remove(0);
    assert!(meta.parents.is_empty());
    let detail = git::changes::commit_detail(&r, &meta, None).expect("detail");
    assert_eq!(detail.files.len(), 2);
    assert!(detail.files.iter().all(|f| f.status == FileStatus::Added));
    assert_eq!(detail.stats.files_changed, 2);
    assert_eq!(detail.stats.insertions, 2);
}

#[test]
fn empty_commits_have_no_files() {
    let f = init();
    write(&f.dir, "a.ts", "const a = 1;\n");
    let c1 = commit(&f.dir, "add a");
    let c2 = empty_commit(&f.dir, "wip");
    let r = repo(&f);
    let meta = git::history::log_metas(&r, &["-n", "1", &c2]).expect("meta").remove(0);
    let detail = git::changes::commit_detail(&r, &meta, None).expect("detail");
    assert!(detail.files.is_empty());
    assert_eq!(detail.stats.files_changed, 0);
    assert_eq!(detail.stats.insertions, 0);
    assert_ne!(c1, c2);
}

// -- rename / copy / binary ---------------------------------------------------

#[test]
fn rename_detection_reports_old_and_new_paths() {
    let rn = with_rename();
    let r = repo(&rn.f);
    let meta = git::history::log_metas(&r, &["-n", "1", &rn.rename]).expect("meta").remove(0);
    let detail = git::changes::commit_detail(&r, &meta, None).expect("detail");
    let file = detail.files.iter().find(|f| f.new_path == "deployment-worker.ts").expect("renamed file present");
    assert_eq!(file.status, FileStatus::Renamed);
    assert_eq!(file.old_path.as_deref(), Some("worker.ts"));
    assert!(file.similarity.is_some());
    assert!(!detail.files.iter().any(|f| f.status == FileStatus::Deleted && f.new_path == "worker.ts"),
        "a detected rename must not also appear as delete+add");
}

#[test]
fn copy_detection_reports_copies() {
    let c = with_copy();
    let r = repo(&c.f);
    // The source file started as a plain addition.
    let meta1 = git::history::log_metas(&r, &["-n", "1", &c.c1]).expect("meta").remove(0);
    let d1 = git::changes::commit_detail(&r, &meta1, None).expect("detail");
    assert!(d1.files.iter().any(|f| f.new_path == "a.ts" && f.status == FileStatus::Added));
    // Then it was modified and copied in the same commit.
    let meta = git::history::log_metas(&r, &["-n", "1", &c.c2]).expect("meta").remove(0);
    let detail = git::changes::commit_detail(&r, &meta, None).expect("detail");
    let file = detail.files.iter().find(|f| f.new_path == "b.ts").expect("copied file present");
    assert_eq!(file.status, FileStatus::Copied);
    assert_eq!(file.old_path.as_deref(), Some("a.ts"));
}

#[test]
fn binary_files_are_flagged() {
    let b = with_binary();
    let r = repo(&b.f);
    let meta = git::history::log_metas(&r, &["-n", "1", &b.c1]).expect("meta").remove(0);
    let detail = git::changes::commit_detail(&r, &meta, None).expect("detail");
    let png = detail.files.iter().find(|f| f.new_path == "assets/image.png").expect("png present");
    assert!(png.binary, "binary file must be flagged");
    let txt = detail.files.iter().find(|f| f.new_path == "notes.txt").expect("txt present");
    assert!(!txt.binary, "txt flagged binary — files: {:#?}", detail.files);
}

// -- snapshots match git -------------------------------------------------------

#[test]
fn snapshot_tree_matches_git() {
    let l = linear();
    let r = repo(&l.f);
    // Root listing (content-addressed per directory by design).
    let root = git::snapshot::tree_entries(&r, &l.c4).expect("tree");
    let out = fixtures::run_git(&l.f.dir, &["ls-tree", &l.c4]);
    let lines = String::from_utf8(out).expect("utf8");
    assert_eq!(
        root.iter().filter(|e| e.kind == "blob").count(),
        lines.lines().filter(|l| l.contains(" blob ")).count(),
        "root blobs"
    );
    assert_eq!(
        root.iter().filter(|e| e.kind == "tree").count(),
        lines.lines().filter(|l| l.contains(" tree ")).count(),
        "root trees"
    );
    // Recursing by tree sha must reach the same total as `ls-tree -r`.
    let mut blobs = root.iter().filter(|e| e.kind == "blob").count();
    for dir in root.iter().filter(|e| e.kind == "tree") {
        let children = git::snapshot::tree_entries(&r, &dir.object).expect("subtree");
        blobs += children.iter().filter(|e| e.kind == "blob").count();
    }
    let recursive = fixtures::run_git(&l.f.dir, &["ls-tree", "-r", &l.c4]);
    let recursive = String::from_utf8(recursive).expect("utf8");
    assert_eq!(blobs, recursive.lines().filter(|l| l.contains(" blob ")).count());
}

#[test]
fn blob_content_matches_git() {
    let l = linear();
    let r = repo(&l.f);
    let file = git::snapshot::file_at_commit(&r, &l.c4, "src/a.ts").expect("file");
    assert_eq!(file.kind, FileKind::Text);
    let expected = fixtures::run_git(&l.f.dir, &["show", &format!("{}:src/a.ts", l.c4)]);
    assert_eq!(file.content.unwrap(), String::from_utf8(expected).expect("utf8"));
}

#[test]
fn file_diff_matches_git() {
    let l = linear();
    let r = repo(&l.f);
    let meta = git::history::log_metas(&r, &["-n", "1", &l.c3]).expect("meta").remove(0);
    let diff = git::diff::file_diff(&r, &meta, None, "src/a.ts").expect("diff");
    let expected = fixtures::run_git(&l.f.dir, &["diff", &l.c2, &l.c3, "--", "src/a.ts"]);
    assert_eq!(diff.patch.unwrap(), String::from_utf8(expected).expect("utf8"));
}

#[test]
fn symlink_and_submodule_kinds() {
    let s = with_special_entries();
    let r = repo(&s.f);
    let link = git::snapshot::file_at_commit(&r, &s.c1, "link.txt").expect("symlink");
    assert_eq!(link.kind, FileKind::Symlink);
    assert_eq!(link.symlink_target.as_deref(), Some("target.txt"));
    let sub = git::snapshot::file_at_commit(&r, &s.c1, "vendor/lib").expect("submodule");
    assert_eq!(sub.kind, FileKind::Submodule);
    assert_eq!(sub.submodule_sha.as_deref(), Some("0123456789012345678901234567890123456789"));
}

// -- evolution ------------------------------------------------------------------

#[test]
fn evolution_follows_rename_chain() {
    let rn = with_rename();
    let r = repo(&rn.f);
    let entries = git::evolution::file_evolution(&r, &rn.init, &rn.modify, "deployment-worker.ts").expect("evolution");
    assert_eq!(entries.len(), 3, "create + rename + modify: {entries:?}");
    assert_eq!(entries[0].sha, rn.create);
    assert_eq!(entries[0].status, FileStatus::Added);
    assert_eq!(entries[0].new_path, "worker.ts");
    assert_eq!(entries[1].sha, rn.rename);
    assert_eq!(entries[1].status, FileStatus::Renamed);
    assert_eq!(entries[1].old_path.as_deref(), Some("worker.ts"));
    assert_eq!(entries[1].new_path, "deployment-worker.ts");
    assert_eq!(entries[2].sha, rn.modify);
    assert_eq!(entries[2].status, FileStatus::Modified);
    // Line counts come from the numstat merge.
    assert_eq!(entries[0].additions, 5);
    assert_eq!(entries[1].additions, 1);
    assert_eq!(entries[2].additions, 1);
}

// -- tags ------------------------------------------------------------------------

#[test]
fn tag_range_resolution() {
    let t = with_tags();
    let r = repo(&t.f);
    assert_eq!(git::history::root_commit(&r, "HEAD").expect("root"), t.c1);
    let range = git::history::resolve_replay(&r, Some("v1.0"), None, false, false).expect("resolve");
    assert_eq!(range.base_sha, t.c2, "v1.0 points at c2");
    assert_eq!(subjects(&range), vec!["three"]);
    assert_eq!(range.commits[0].sha, t.c3);
    // Tags are listed with peeled shas.
    let tags = git::history::list_tags(&r).expect("tags");
    assert_eq!(tags.len(), 1);
    assert_eq!(tags[0].name, "v1.0");
    assert_eq!(tags[0].sha, t.c2);
}

#[test]
fn branches_are_listed_with_head_flag() {
    let m = with_merge();
    let r = repo(&m.f);
    let branches = git::history::list_branches(&r).expect("branches");
    assert_eq!(branches.len(), 2);
    let main = branches.iter().find(|b| b.name == "main").expect("main");
    assert!(main.is_head);
    let feature = branches.iter().find(|b| b.name == "feature").expect("feature");
    assert!(!feature.is_head);
}

// -- cache invariance --------------------------------------------------------------

#[test]
fn cache_deletion_does_not_change_results() {
    let l = linear();

    let compute = |cache_dir: Option<std::path::PathBuf>| {
        let state = AppState::new(cache_dir.map(|d| CacheStore::open(&d.join("cache.db")).expect("cache open")));
        let info = state.open_repository(l.f.dir.to_str().unwrap()).expect("open");
        let detail = state.commit_detail(info.id, &l.c3, None).expect("detail");
        let diff = state.file_diff(info.id, &l.c3, "src/a.ts", None).expect("diff");
        (detail.files.len(), detail.stats.insertions, diff.patch.unwrap_or_default())
    };

    let tmp = tempfile::tempdir().expect("tempdir");
    let cached = compute(Some(tmp.path().to_path_buf()));
    // Wipe the cache entirely and recompute: identical results, from Git.
    std::fs::remove_file(tmp.path().join("cache.db")).expect("remove cache db");
    let rebuilt = compute(Some(tmp.path().to_path_buf()));
    let uncached = compute(None);
    assert_eq!(cached, rebuilt);
    assert_eq!(cached, uncached);
}

// -- stats -------------------------------------------------------------------------

#[test]
fn large_diff_stats_match_shortstat() {
    let lg = with_large_diff();
    let r = repo(&lg.f);
    let meta = git::history::log_metas(&r, &["-n", "1", &lg.c1]).expect("meta").remove(0);
    let detail = git::changes::commit_detail(&r, &meta, None).expect("detail");
    assert_eq!(detail.stats.files_changed, 1);
    assert_eq!(detail.stats.insertions, 1500, "stats: {:?}", detail.stats);
    assert_eq!(detail.files[0].additions, 1500, "files: {:#?}", detail.files);
}

#[test]
fn snapshot_stats_counts_files_and_loc() {
    let l = linear();
    let r = repo(&l.f);
    let stats = git::snapshot::snapshot_stats(&r, &l.c4).expect("stats");
    assert_eq!(stats.files, 4); // README.md, src/a.ts, src/service.ts, tests/a.test.ts
    assert_eq!(stats.dirs, 2); // src, tests
    assert!(stats.loc.is_some());
    assert!(stats.loc.unwrap() >= 5);
}

// -- search --------------------------------------------------------------------------

#[test]
fn search_finds_message_and_path_matches() {
    let l = linear();
    let r = repo(&l.f);
    let by_message = git::search::search_replay(&r, &l.c1, &l.c4, "service", 10).expect("search");
    assert!(by_message.iter().any(|h| h.sha == l.c2), "message match on 'service'");
    let by_path = git::search::search_replay(&r, &l.c1, &l.c4, "a.test", 10).expect("search");
    assert!(by_path.iter().any(|h| h.sha == l.c4), "path match on a.test.ts");
    assert!(git::search::search_replay(&r, &l.c1, &l.c4, "", 10).expect("empty").is_empty());
}

#[test]
fn search_pickaxe_finds_content_introductions() {
    let l = linear();
    let r = repo(&l.f);
    // "Service" is introduced in c2 (src/service.ts).
    let hits = git::search::search_replay(&r, &l.c1, &l.c4, "Service", 10).expect("search");
    assert!(hits.iter().any(|h| h.sha == l.c2), "pickaxe should find where Service appeared: {hits:?}");
    // Short queries skip pickaxe (noise), so "a" only matches paths/messages.
    let _ = git::search::search_replay(&r, &l.c1, &l.c4, "a", 10).expect("search");
}

// -- working tree (spec 35) ------------------------------------------------------

#[test]
fn working_tree_frame_matches_git_diff() {
    let l = linear();
    let r = repo(&l.f);
    // Modify a tracked file, stage a delete, add an untracked file.
    write(&l.f.dir, "src/a.ts", "export const a = 42;\n");
    std::fs::remove_file(l.f.dir.join("src/service.ts")).expect("rm");
    write(&l.f.dir, "notes.txt", "scratch notes\n");

    let frame = git::working_tree::working_tree_frame(&r).expect("frame");
    let modified = frame.files.iter().find(|f| f.new_path == "src/a.ts").expect("modified a.ts");
    assert_eq!(modified.status, FileStatus::Modified);
    let deleted = frame.files.iter().find(|f| f.new_path == "src/service.ts").expect("deleted service.ts");
    assert_eq!(deleted.status, FileStatus::Deleted);
    let untracked = frame.files.iter().find(|f| f.new_path == "notes.txt").expect("untracked notes.txt");
    assert_eq!(untracked.status, FileStatus::Untracked);
    assert_eq!(frame.untracked, 1);

    // Stats agree with git's own shortstat (computed by hand here: a.ts is
    // 1 add + 2 del, service.ts is 1 del).
    assert_eq!(frame.stats.files_changed, 2);
    assert_eq!(frame.stats.insertions, 1);
    assert_eq!(frame.stats.deletions, 3);
}

#[test]
fn working_file_diff_matches_git_and_synthesizes_untracked() {
    let l = linear();
    let r = repo(&l.f);
    write(&l.f.dir, "src/a.ts", "export const a = 99;\n");
    write(&l.f.dir, "fresh.ts", "brand new\n");

    let tracked = git::working_tree::working_file_diff(&r, "src/a.ts").expect("tracked diff");
    let expected = fixtures::run_git(&l.f.dir, &["diff", "HEAD", "--no-ext-diff", "--no-color", "-M", "--", "src/a.ts"]);
    assert_eq!(tracked.patch.unwrap(), String::from_utf8(expected).expect("utf8"));

    let fresh = git::working_tree::working_file_diff(&r, "fresh.ts").expect("untracked diff");
    let patch = fresh.patch.expect("synthesized patch");
    assert!(patch.contains("new file mode"), "patch: {patch}");
    assert!(patch.contains("+brand new"), "patch: {patch}");
}

#[test]
fn working_tree_listing_includes_untracked_dirs() {
    let l = linear();
    write(&l.f.dir, "scratch/one.ts", "1\n");
    write(&l.f.dir, "scratch/two.ts", "2\n");

    let state = AppState::new(None);
    let info = state.open_repository(l.f.dir.to_str().unwrap()).expect("open");
    let root = state.tree(info.id, "wt:").expect("wt root");
    assert!(root.iter().any(|e| e.name == "scratch" && e.kind == "tree"), "untracked dir listed");
    let scratch = state.tree(info.id, "wt:scratch").expect("wt scratch");
    assert_eq!(scratch.iter().filter(|e| e.kind == "blob").count(), 2);
    // Index version for tracked files: file_at_commit with the WORKTREE marker.
    let file = state.file_at_commit(info.id, "WORKTREE", "src/a.ts").expect("index file");
    assert_eq!(file.kind, FileKind::Text);
}

// -- detached HEAD -------------------------------------------------------------------

#[test]
fn detached_head_resolves_and_lists_branches_without_head_flag() {
    let l = linear();
    let r = repo(&l.f);
    fixtures::checkout(&l.f.dir, &l.c2);
    assert_eq!(git::history::head_branch(&r).expect("head branch"), None);
    let branches = git::history::list_branches(&r).expect("branches");
    assert!(!branches.iter().any(|b| b.is_head), "no branch should be HEAD when detached");
    let range = git::history::resolve_replay(&r, None, None, false, false).expect("resolve");
    assert_eq!(range.head_sha, l.c2, "HEAD resolves to the detached commit");
    assert!(range.commits.is_empty(), "base == head → empty replay");
}

#[test]
fn big_history_stays_correct_at_scale() {
    // 500 commits (spec 46: "repository with very large history") — every
    // engine path must stay correct, not just the happy small case.
    let b = with_big_history(500);
    let r = repo(&b.f);
    assert_eq!(b.count, 500);

    let range = git::history::resolve_replay(&r, Some(&b.first), Some(&b.last), false, false).expect("resolve");
    assert_eq!(range.commits.len(), 499);
    assert_eq!(range.commits[0].subject, "commit 0001");
    assert_eq!(range.commits[498].subject, "commit 0499");

    // Mid-history detail + diff.
    let mid = &range.commits[250];
    let detail = git::changes::commit_detail(&r, mid, None).expect("detail at mid");
    assert_eq!(detail.files.len(), 1);
    let diff = git::diff::file_diff(&r, mid, None, "src/churn.ts").expect("diff at mid");
    assert!(diff.patch.unwrap_or_default().contains("churn 0251"), "diff content");

    // File evolution across the whole range (every 10th commit: 10..490).
    let entries = git::evolution::file_evolution(&r, &b.first, &b.last, "src/tracked.ts").expect("evolution");
    assert_eq!(entries.len(), 49, "49 tracked.ts commits");
    assert_eq!(entries[0].additions, 51); // "// iteration 0010" + 50 lines

    // Search: message + pickaxe at scale.
    let hits = git::search::search_replay(&r, &b.first, &b.last, "commit 0251", 10).expect("search");
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].sha, range.commits[250].sha);
    // Pickaxe finds both the introduction and the later removal of a marker.
    let pick = git::search::search_replay(&r, &b.first, &b.last, "iteration 0250", 10).expect("pickaxe");
    assert_eq!(pick.len(), 2);
    assert!(pick.iter().any(|h| h.subject == "commit 0250"), "introducing commit");
    assert!(pick.iter().any(|h| h.subject == "commit 0260"), "removing commit");

    // Snapshot stats at the head.
    let stats = git::snapshot::snapshot_stats(&r, &b.last).expect("stats");
    assert_eq!(stats.files, 3); // README.md, src/tracked.ts, src/churn.ts
    assert_eq!(stats.dirs, 1);
    assert!(stats.loc.is_some());

    // Ordering invariant at scale: first frame = base, last = head.
    assert_eq!(range.base_sha, b.first);
    assert_eq!(range.head_sha, b.last);
}

#[test]
fn head_state_reports_sha_branch_and_dirt() {
    let l = linear();
    let r = repo(&l.f);
    let hs = git::working_tree::head_state(&r).expect("head state");
    assert_eq!(hs.sha, l.c4);
    assert_eq!(hs.branch.as_deref(), Some("main"));
    assert!(!hs.dirty);
    write(&l.f.dir, "src/a.ts", "export const a = 1;\n// dirty\n");
    let hs = git::working_tree::head_state(&r).expect("head state");
    assert!(hs.dirty);
}
