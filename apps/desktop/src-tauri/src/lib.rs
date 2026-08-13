pub mod cache;
pub mod commands;
pub mod error;
pub mod git;
pub mod state;

use state::AppState;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // The SQLite cache is acceleration only — if it cannot be opened,
            // the app keeps working (invariant: cache loss never loses data).
            let cache_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
            std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
            let cache_path = cache_dir.join("replay_cache.db");
            let cache = match cache::CacheStore::open(&cache_path) {
                Ok(store) => Some(store),
                Err(e) => {
                    eprintln!("git-replay: cache disabled ({e})");
                    None
                }
            };
            app.manage(AppState::new(cache, Some(cache_path)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_repository,
            commands::list_branches,
            commands::list_tags,
            commands::get_recent_commits,
            commands::resolve_replay,
            commands::get_commit_detail,
            commands::get_file_diff,
            commands::get_tree,
            commands::get_file_at_commit,
            commands::get_file_evolution,
            commands::get_snapshot_stats,
            commands::search_replay,
            commands::get_working_tree,
            commands::get_working_file_diff,
            commands::get_head_state,
            commands::resolve_pr_replay,
            commands::get_commit_url,
            commands::get_cache_info,
            commands::clear_cache,
            commands::self_test_repo_path,
            commands::report_self_test,
            commands::ensure_demo_fixture,
            commands::dirty_demo_fixture,
            commands::commit_demo_fixture,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
