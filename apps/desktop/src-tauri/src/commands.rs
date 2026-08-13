//! Tauri command surface. Every command is a thin async wrapper that runs its
//! work on the blocking pool — the IPC thread never waits on git or disk.

use crate::error::AppError;
use crate::git::types::*;
use crate::state::AppState;
use tauri::{Manager, State};

type Cmd<T> = Result<T, AppError>;

fn join_error(e: tauri::Error) -> AppError {
    AppError::new(crate::error::ErrorKind::Io, format!("background task failed: {e}"))
}

fn block<T, F>(state: &State<'_, AppState>, f: F) -> impl std::future::Future<Output = Cmd<T>>
where
    T: Send + 'static,
    F: FnOnce(AppState) -> Cmd<T> + Send + 'static,
{
    let st = state.inner().clone();
    async move { tauri::async_runtime::spawn_blocking(move || f(st)).await.map_err(join_error)? }
}

#[tauri::command]
pub async fn open_repository(state: State<'_, AppState>, path: String) -> Cmd<RepoInfo> {
    block(&state, move |st| st.open_repository(&path)).await
}

#[tauri::command]
pub async fn list_branches(state: State<'_, AppState>, repo_id: u32) -> Cmd<Vec<BranchInfo>> {
    block(&state, move |st| st.branches(repo_id)).await
}

#[tauri::command]
pub async fn list_tags(state: State<'_, AppState>, repo_id: u32) -> Cmd<Vec<TagInfo>> {
    block(&state, move |st| st.tags(repo_id)).await
}

#[tauri::command]
pub async fn get_recent_commits(state: State<'_, AppState>, repo_id: u32, limit: Option<u32>) -> Cmd<Vec<CommitMeta>> {
    block(&state, move |st| st.recent_commits(repo_id, limit.unwrap_or(300))).await
}

#[tauri::command]
pub async fn resolve_replay(
    state: State<'_, AppState>,
    repo_id: u32,
    base_ref: Option<String>,
    head_ref: Option<String>,
    use_merge_base: Option<bool>,
    first_parent: Option<bool>,
) -> Cmd<ReplayRange> {
    block(&state, move |st| {
        st.resolve_replay(repo_id, base_ref, head_ref, use_merge_base.unwrap_or(true), first_parent.unwrap_or(false))
    })
    .await
}

#[tauri::command]
pub async fn get_commit_detail(state: State<'_, AppState>, repo_id: u32, sha: String, parent_index: Option<usize>) -> Cmd<CommitDetail> {
    block(&state, move |st| st.commit_detail(repo_id, &sha, parent_index)).await
}

#[tauri::command]
pub async fn get_file_diff(
    state: State<'_, AppState>,
    repo_id: u32,
    sha: String,
    path: String,
    parent_index: Option<usize>,
) -> Cmd<FileDiff> {
    block(&state, move |st| st.file_diff(repo_id, &sha, &path, parent_index)).await
}

#[tauri::command]
pub async fn get_tree(state: State<'_, AppState>, repo_id: u32, treeish: String) -> Cmd<Vec<TreeEntry>> {
    block(&state, move |st| st.tree(repo_id, &treeish)).await
}

#[tauri::command]
pub async fn get_file_at_commit(state: State<'_, AppState>, repo_id: u32, sha: String, path: String) -> Cmd<FileAtCommit> {
    block(&state, move |st| st.file_at_commit(repo_id, &sha, &path)).await
}

#[tauri::command]
pub async fn get_file_evolution(
    state: State<'_, AppState>,
    repo_id: u32,
    base: String,
    head: String,
    path: String,
) -> Cmd<Vec<EvolutionEntry>> {
    block(&state, move |st| st.file_evolution(repo_id, &base, &head, &path)).await
}

#[tauri::command]
pub async fn get_snapshot_stats(state: State<'_, AppState>, repo_id: u32, sha: String) -> Cmd<SnapshotStats> {
    block(&state, move |st| st.snapshot_stats(repo_id, &sha)).await
}

#[tauri::command]
pub async fn search_replay(
    state: State<'_, AppState>,
    repo_id: u32,
    base: String,
    head: String,
    query: String,
    limit: Option<u32>,
) -> Cmd<Vec<SearchResult>> {
    block(&state, move |st| st.search(repo_id, &base, &head, &query, limit.unwrap_or(50))).await
}

#[tauri::command]
pub async fn get_working_tree(state: State<'_, AppState>, repo_id: u32) -> Cmd<WorkingTreeFrame> {
    block(&state, move |st| st.working_tree_frame(repo_id)).await
}

#[tauri::command]
pub async fn get_working_file_diff(state: State<'_, AppState>, repo_id: u32, path: String) -> Cmd<FileDiff> {
    block(&state, move |st| st.working_file_diff(repo_id, &path)).await
}

#[tauri::command]
pub async fn get_head_state(state: State<'_, AppState>, repo_id: u32) -> Cmd<HeadState> {
    block(&state, move |st| st.head_state(repo_id)).await
}

#[tauri::command]
pub async fn resolve_pr_replay(
    state: State<'_, AppState>,
    repo_id: u32,
    pr: String,
    version: Option<String>,
) -> Cmd<PrReplay> {
    block(&state, move |st| st.resolve_pr(repo_id, &pr, version.as_deref())).await
}

#[tauri::command]
pub async fn get_commit_url(state: State<'_, AppState>, repo_id: u32, sha: String) -> Cmd<Option<String>> {
    block(&state, move |st| st.commit_url(repo_id, &sha)).await
}

#[tauri::command]
pub async fn get_cache_info(state: State<'_, AppState>) -> Cmd<CacheInfo> {
    block(&state, move |st| Ok(st.cache_info())).await
}

#[tauri::command]
pub async fn clear_cache(state: State<'_, AppState>) -> Cmd<CacheInfo> {
    block(&state, move |st| st.clear_cache()).await
}

/// The repository this app was built from — the self-test target.
/// Only available in debug builds; returns None in release.
#[tauri::command]
pub async fn self_test_repo_path() -> Cmd<Option<String>> {
    #[cfg(debug_assertions)]
    {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
        return Ok(std::fs::canonicalize(&root).ok().map(|p| p.to_string_lossy().into_owned()));
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = ();
        Ok(None)
    }
}

/// Build the demo fixture (merge, rename, binary, empty commit, large diff,
/// tags) and return its path. Debug builds only.
#[tauri::command]
pub async fn ensure_demo_fixture() -> Cmd<Option<String>> {
    #[cfg(debug_assertions)]
    {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
        let script = root.join("scripts").join("make-demo-fixture.sh");
        let out = std::process::Command::new("sh").arg(&script).output();
        return Ok(out.ok().filter(|o| o.status.success()).and_then(|_| {
            std::fs::canonicalize(root.join("fixtures").join("demo-repo")).ok().map(|p| p.to_string_lossy().into_owned())
        }));
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = ();
        Ok(None)
    }
}

/// Make the demo fixture's working tree dirty (modify + untracked file), so
/// the Working Tree frame has content. Debug builds only.
#[tauri::command]
pub async fn dirty_demo_fixture(path: String) -> Cmd<()> {
    #[cfg(debug_assertions)]
    {
        let p = std::path::PathBuf::from(path);
        let _ = std::fs::write(p.join("src/queue.ts"), "// modified\n");
        let _ = std::fs::write(p.join("scratch-notes.txt"), "untracked\n");
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = path;
    }
    Ok(())
}

/// Commit the demo fixture's current state, so the repository-change banner
/// and refresh flow can be exercised end-to-end. Debug builds only.
#[tauri::command]
pub async fn commit_demo_fixture(path: String) -> Cmd<()> {
    #[cfg(debug_assertions)]
    {
        let p = std::path::PathBuf::from(path);
        let envs = [
            ("GIT_AUTHOR_NAME", "Self Test"),
            ("GIT_AUTHOR_EMAIL", "selftest@git-replay.local"),
            ("GIT_COMMITTER_NAME", "Self Test"),
            ("GIT_COMMITTER_EMAIL", "selftest@git-replay.local"),
        ];
        let mut git = |args: &[&str]| {
            std::process::Command::new("git")
                .arg("-C").arg(&p).envs(envs.clone()).args(args)
                .stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null())
                .status().map(|s| s.success()).unwrap_or(false)
        };
        git(&["add", "-A"]);
        git(&["commit", "-q", "-m", "self-test commit"]);
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = path;
    }
    Ok(())
}

/// Persist the in-app self-test report: echoes it to stdout (captured by the
/// dev log) and writes a copy next to the cache database.
#[tauri::command]
pub async fn report_self_test(app: tauri::AppHandle, report: String) -> Cmd<()> {
    println!("SELFTEST_REPORT {report}");
    if let Ok(dir) = app.path().app_cache_dir() {
        let _ = std::fs::write(dir.join("selftest-report.json"), &report);
    }
    Ok(())
}

#[tauri::command]
pub async fn get_chat_settings(app: tauri::AppHandle) -> Cmd<crate::chat::ChatSettings> {
    let config_dir = app.path().app_config_dir().map_err(|e| crate::error::AppError::io("config dir", std::io::Error::other(e.to_string())))?;
    let mut stored = crate::chat::load_settings(&config_dir);
    crate::chat::normalized(&mut stored);
    Ok(crate::chat::ChatSettings {
        provider: stored.provider,
        model: stored.model,
        base_url: stored.base_url,
        has_key: !stored.api_key.trim().is_empty(),
    })
}

#[tauri::command]
pub async fn set_chat_settings(
    app: tauri::AppHandle,
    provider: String,
    model: String,
    base_url: Option<String>,
    api_key: Option<String>,
) -> Cmd<crate::chat::ChatSettings> {
    let config_dir = app.path().app_config_dir().map_err(|e| crate::error::AppError::io("config dir", std::io::Error::other(e.to_string())))?;
    let mut stored = crate::chat::load_settings(&config_dir);
    stored.provider = provider;
    stored.model = model;
    if let Some(url) = base_url {
        if !url.trim().is_empty() {
            stored.base_url = url.trim().to_string();
        }
    }
    if let Some(key) = api_key {
        if !key.trim().is_empty() {
            stored.api_key = key.trim().to_string();
        }
    }
    crate::chat::normalized(&mut stored);
    crate::chat::save_settings(&config_dir, &stored)?;
    Ok(crate::chat::ChatSettings {
        provider: stored.provider,
        model: stored.model,
        base_url: stored.base_url,
        has_key: !stored.api_key.trim().is_empty(),
    })
}

#[tauri::command]
pub async fn clear_chat_settings(app: tauri::AppHandle) -> Cmd<crate::chat::ChatSettings> {
    let config_dir = app.path().app_config_dir().map_err(|e| crate::error::AppError::io("config dir", std::io::Error::other(e.to_string())))?;
    crate::chat::clear_key(&config_dir)?;
    let mut stored = crate::chat::load_settings(&config_dir);
    crate::chat::normalized(&mut stored);
    Ok(crate::chat::ChatSettings {
        provider: stored.provider,
        model: stored.model,
        base_url: stored.base_url,
        has_key: false,
    })
}

#[tauri::command]
pub async fn chat_send(
    app: tauri::AppHandle,
    request_id: String,
    messages_json: String,
) -> Cmd<()> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| crate::error::AppError::io("config dir", std::io::Error::other(e.to_string())))?;
    let messages: Vec<crate::chat::WireMessage> = serde_json::from_str(&messages_json)
        .map_err(|e| crate::error::AppError::new(crate::error::ErrorKind::InvalidState, format!("bad message payload: {e}")))?;
    let emitter = app.clone();
    let rid = request_id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _ = crate::chat::run_chat_request(emitter, config_dir, &rid, &messages);
    });
    Ok(())
}
