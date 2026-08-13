//! User-facing error model.
//!
//! The primary UX never shows raw shell errors: `message` is a human sentence,
//! `detail` carries the technical cause (e.g. raw git stderr) for a
//! "Show details" surface.

use serde::ser::{SerializeStruct, Serializer};
use serde::Serialize;

/// Machine-readable error category, stable for the frontend.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorKind {
    RepoNotFound,
    NotAWorkTree,
    NoCommits,
    NoMergeBase,
    RefNotFound,
    ObjectNotFound,
    GitNotFound,
    Corrupt,
    Io,
    GitFailed,
    Cache,
    InvalidState,
}

impl ErrorKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ErrorKind::RepoNotFound => "repoNotFound",
            ErrorKind::NotAWorkTree => "notAWorkTree",
            ErrorKind::NoCommits => "noCommits",
            ErrorKind::NoMergeBase => "noMergeBase",
            ErrorKind::RefNotFound => "refNotFound",
            ErrorKind::ObjectNotFound => "objectNotFound",
            ErrorKind::GitNotFound => "gitNotFound",
            ErrorKind::Corrupt => "corrupt",
            ErrorKind::Io => "io",
            ErrorKind::GitFailed => "gitFailed",
            ErrorKind::Cache => "cache",
            ErrorKind::InvalidState => "invalidState",
        }
    }
}

/// A git subprocess failure (non-zero exit or spawn failure).
#[derive(Debug, Clone)]
pub struct GitFailure {
    pub stderr: String,
    pub status: Option<i32>,
}

#[derive(Debug)]
pub struct AppError {
    pub kind: ErrorKind,
    pub message: String,
    pub detail: Option<String>,
}

impl AppError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self { kind, message: message.into(), detail: None }
    }

    pub fn with_detail(kind: ErrorKind, message: impl Into<String>, detail: impl Into<String>) -> Self {
        Self { kind, message: message.into(), detail: Some(detail.into()) }
    }

    /// Wrap a git failure with a friendly context sentence.
    pub fn git(context: &str, failure: GitFailure) -> Self {
        let stderr = failure.stderr.trim();
        let message = if stderr.is_empty() {
            format!("{context}.")
        } else {
            let first_line = stderr.lines().next().unwrap_or_default();
            format!("{context}: {first_line}")
        };
        Self::with_detail(ErrorKind::GitFailed, message, stderr.to_string())
    }

    /// Attach raw git stderr as the technical detail.
    pub fn with_git(mut self, failure: GitFailure) -> Self {
        self.detail = Some(failure.stderr);
        self
    }

    pub fn io(context: &str, e: std::io::Error) -> Self {
        if e.kind() == std::io::ErrorKind::NotFound && context.contains("git") {
            Self::new(ErrorKind::GitNotFound, "git executable not found. Please install Git and try again.")
        } else {
            Self::with_detail(ErrorKind::Io, format!("{context}: {e}"), e.to_string())
        }
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for AppError {}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut st = serializer.serialize_struct("AppError", 3)?;
        st.serialize_field("kind", self.kind.as_str())?;
        st.serialize_field("message", &self.message)?;
        st.serialize_field("detail", &self.detail)?;
        st.end()
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        Self::with_detail(ErrorKind::Io, format!("io error: {e}"), e.to_string())
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        Self::with_detail(ErrorKind::Cache, format!("cache error: {e}"), e.to_string())
    }
}
