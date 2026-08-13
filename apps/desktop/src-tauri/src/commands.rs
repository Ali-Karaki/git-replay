//! Tauri command surface. Every command is a thin async wrapper that runs its
//! work on the blocking pool — the IPC thread never waits on git or disk.

use crate::error::AppError;
use crate::git::types::*;
use crate::state::AppState;
use tauri::State;

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
