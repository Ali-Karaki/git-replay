//! SQLite-derived cache. Every row is derivable from Git by re-running
//! plumbing commands — deleting the database loses acceleration, never data
//! (invariant 6). Blobs and trees are content-addressed by object SHA, so
//! they survive history rewrites for any object that still exists.

use crate::error::AppError;
use crate::git::types::{CommitDetail, CommitMeta, EvolutionEntry, FileDiff, SnapshotStats, TreeEntry};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS commits (
    repo_id INTEGER NOT NULL,
    sha TEXT NOT NULL,
    meta TEXT NOT NULL,
    PRIMARY KEY (repo_id, sha)
);
CREATE TABLE IF NOT EXISTS details (
    repo_id INTEGER NOT NULL,
    sha TEXT NOT NULL,
    parent_index INTEGER NOT NULL, -- -1 for root commits
    detail TEXT NOT NULL,
    PRIMARY KEY (repo_id, sha, parent_index)
);
CREATE TABLE IF NOT EXISTS diffs (
    repo_id INTEGER NOT NULL,
    sha TEXT NOT NULL,
    parent_index INTEGER NOT NULL,
    path TEXT NOT NULL,
    diff TEXT NOT NULL,
    PRIMARY KEY (repo_id, sha, parent_index, path)
);
CREATE TABLE IF NOT EXISTS blobs (
    repo_id INTEGER NOT NULL,
    blob_sha TEXT NOT NULL,
    size INTEGER NOT NULL,
    content BLOB NOT NULL,
    PRIMARY KEY (repo_id, blob_sha)
);
CREATE TABLE IF NOT EXISTS trees (
    repo_id INTEGER NOT NULL,
    tree_sha TEXT NOT NULL,
    entries TEXT NOT NULL,
    PRIMARY KEY (repo_id, tree_sha)
);
CREATE TABLE IF NOT EXISTS stats (
    repo_id INTEGER NOT NULL,
    sha TEXT NOT NULL,
    stats TEXT NOT NULL,
    PRIMARY KEY (repo_id, sha)
);
CREATE TABLE IF NOT EXISTS evolutions (
    repo_id INTEGER NOT NULL,
    base TEXT NOT NULL,
    head TEXT NOT NULL,
    path TEXT NOT NULL,
    entries TEXT NOT NULL,
    PRIMARY KEY (repo_id, base, head, path)
);
";

fn parent_key(parent_index: Option<usize>) -> i64 {
    parent_index.map(|i| i as i64).unwrap_or(0).max(0)
}

pub struct CacheStore {
    conn: Connection,
}

impl CacheStore {
    pub fn open(path: &Path) -> Result<Self, AppError> {
        let conn = Connection::open(path)?;
        conn.execute_batch(SCHEMA)?;
        conn.execute_batch("PRAGMA journal_mode=WAL;")?;
        Ok(Self { conn })
    }

    pub fn get_commit(&self, repo_id: u32, sha: &str) -> Option<CommitMeta> {
        let json: String = self
            .conn
            .query_row(
                "SELECT meta FROM commits WHERE repo_id = ?1 AND sha = ?2",
                params![repo_id, sha],
                |row| row.get(0),
            )
            .optional()
            .ok()??;
        serde_json::from_str(&json).ok()
    }

    pub fn put_commit(&self, repo_id: u32, meta: &CommitMeta) {
        if let Ok(json) = serde_json::to_string(meta) {
            let _ = self.conn.execute(
                "INSERT OR REPLACE INTO commits (repo_id, sha, meta) VALUES (?1, ?2, ?3)",
                params![repo_id, meta.sha, json],
            );
        }
    }

    pub fn get_detail(&self, repo_id: u32, sha: &str, parent_index: Option<usize>) -> Option<CommitDetail> {
        let json: String = self
            .conn
            .query_row(
                "SELECT detail FROM details WHERE repo_id = ?1 AND sha = ?2 AND parent_index = ?3",
                params![repo_id, sha, parent_key(parent_index)],
                |row| row.get(0),
            )
            .optional()
            .ok()??;
        serde_json::from_str(&json).ok()
    }

    pub fn put_detail(&self, repo_id: u32, sha: &str, parent_index: Option<usize>, detail: &CommitDetail) {
        if let Ok(json) = serde_json::to_string(detail) {
            let _ = self.conn.execute(
                "INSERT OR REPLACE INTO details (repo_id, sha, parent_index, detail) VALUES (?1, ?2, ?3, ?4)",
                params![repo_id, sha, parent_key(parent_index), json],
            );
        }
    }

    pub fn get_diff(&self, repo_id: u32, sha: &str, parent_index: Option<usize>, path: &str) -> Option<FileDiff> {
        let json: String = self
            .conn
            .query_row(
                "SELECT diff FROM diffs WHERE repo_id = ?1 AND sha = ?2 AND parent_index = ?3 AND path = ?4",
                params![repo_id, sha, parent_key(parent_index), path],
                |row| row.get(0),
            )
            .optional()
            .ok()??;
        serde_json::from_str(&json).ok()
    }

    pub fn put_diff(&self, repo_id: u32, sha: &str, parent_index: Option<usize>, path: &str, diff: &FileDiff) {
        if let Ok(json) = serde_json::to_string(diff) {
            let _ = self.conn.execute(
                "INSERT OR REPLACE INTO diffs (repo_id, sha, parent_index, path, diff) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![repo_id, sha, parent_key(parent_index), path, json],
            );
        }
    }

    pub fn get_blob(&self, repo_id: u32, blob_sha: &str) -> Option<(Vec<u8>, u64)> {
        self.conn
            .query_row(
                "SELECT content, size FROM blobs WHERE repo_id = ?1 AND blob_sha = ?2",
                params![repo_id, blob_sha],
                |row| Ok((row.get::<_, Vec<u8>>(0)?, row.get::<_, i64>(1)? as u64)),
            )
            .optional()
            .ok()
            .flatten()
    }

    pub fn put_blob(&self, repo_id: u32, blob_sha: &str, content: &[u8], size: u64) {
        let _ = self.conn.execute(
            "INSERT OR REPLACE INTO blobs (repo_id, blob_sha, size, content) VALUES (?1, ?2, ?3, ?4)",
            params![repo_id, blob_sha, size as i64, content],
        );
    }

    pub fn get_tree(&self, repo_id: u32, tree_sha: &str) -> Option<Vec<TreeEntry>> {
        let json: String = self
            .conn
            .query_row(
                "SELECT entries FROM trees WHERE repo_id = ?1 AND tree_sha = ?2",
                params![repo_id, tree_sha],
                |row| row.get(0),
            )
            .optional()
            .ok()??;
        serde_json::from_str(&json).ok()
    }

    pub fn put_tree(&self, repo_id: u32, tree_sha: &str, entries: &[TreeEntry]) {
        if let Ok(json) = serde_json::to_string(entries) {
            let _ = self.conn.execute(
                "INSERT OR REPLACE INTO trees (repo_id, tree_sha, entries) VALUES (?1, ?2, ?3)",
                params![repo_id, tree_sha, json],
            );
        }
    }

    pub fn get_stats(&self, repo_id: u32, sha: &str) -> Option<SnapshotStats> {
        let json: String = self
            .conn
            .query_row(
                "SELECT stats FROM stats WHERE repo_id = ?1 AND sha = ?2",
                params![repo_id, sha],
                |row| row.get(0),
            )
            .optional()
            .ok()??;
        serde_json::from_str(&json).ok()
    }

    pub fn put_stats(&self, repo_id: u32, sha: &str, stats: &SnapshotStats) {
        if let Ok(json) = serde_json::to_string(stats) {
            let _ = self.conn.execute(
                "INSERT OR REPLACE INTO stats (repo_id, sha, stats) VALUES (?1, ?2, ?3)",
                params![repo_id, sha, json],
            );
        }
    }

    pub fn get_evolution(&self, repo_id: u32, base: &str, head: &str, path: &str) -> Option<Vec<EvolutionEntry>> {
        let json: String = self
            .conn
            .query_row(
                "SELECT entries FROM evolutions WHERE repo_id = ?1 AND base = ?2 AND head = ?3 AND path = ?4",
                params![repo_id, base, head, path],
                |row| row.get(0),
            )
            .optional()
            .ok()??;
        serde_json::from_str(&json).ok()
    }

    pub fn put_evolution(&self, repo_id: u32, base: &str, head: &str, path: &str, entries: &[EvolutionEntry]) {
        if let Ok(json) = serde_json::to_string(entries) {
            let _ = self.conn.execute(
                "INSERT OR REPLACE INTO evolutions (repo_id, base, head, path, entries) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![repo_id, base, head, path, json],
            );
        }
    }
}
