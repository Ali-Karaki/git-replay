//! The AI chat layer: BYO Anthropic API key, requests go DIRECTLY from this
//! app to the Claude Messages API (no middleman), with streaming responses.
//! The key lives in the OS config directory, never in the webview, and the
//! chat is fully opt-in — core replay works with AI disabled (spec 43).
//!
//! Claude API facts pinned from the claude-api skill (2026-06):
//! - model `claude-opus-5` (default), adaptive thinking, summarized display
//! - `fallbacks: "default"` + beta header `server-side-fallback-2026-07-01`
//! - streaming SSE: `content_block_delta` → `delta.text_delta` → `text`

use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use tauri::Emitter;

const API_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";
const DEFAULT_MODEL: &str = "claude-opus-5";

const SYSTEM_PROMPT: &str = "\
You are a code-exploration assistant inside Git Replay, a desktop app that replays how a \
Git repository evolved commit by commit. The user is stepping through a timeline of commits, \
diffs, and snapshots.

The CONTEXT section below describes what the user is currently looking at (current commit, \
changed files, selected file's diff or content, replay range). Answer questions about that \
context precisely; reference files and commits by name. Be concise — lead with the outcome. \
If the question needs information that is not in the context, say what is missing instead of \
guessing. Never invent file contents or commit hashes.";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSettings {
    pub provider: String,
    pub model: String,
    /// Never returned after being set.
    pub has_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredSettings {
    pub provider: String,
    pub model: String,
    pub api_key: String,
}

impl Default for StoredSettings {
    fn default() -> Self {
        Self { provider: "anthropic".into(), model: DEFAULT_MODEL.into(), api_key: String::new() }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatEvent {
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    done: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WireMessage {
    pub role: String,
    pub content: String,
}

fn settings_path(config_dir: &PathBuf) -> PathBuf {
    config_dir.join("chat-settings.json")
}

pub fn load_settings(config_dir: &PathBuf) -> StoredSettings {
    std::fs::read_to_string(settings_path(config_dir))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_settings(config_dir: &PathBuf, settings: &StoredSettings) -> Result<(), AppError> {
    let json = serde_json::to_string_pretty(settings)
        .map_err(|e| AppError::new(crate::error::ErrorKind::Cache, format!("could not serialize chat settings: {e}")))?;
    std::fs::write(settings_path(config_dir), json)
        .map_err(|e| AppError::io("could not save chat settings", e))
}

/// Streaming chat request. `messages` is the full conversation (context already
/// baked into the last user message by the frontend). Progress is emitted as
/// `chat://chunk` events carrying the request id.
pub fn run_chat_request(
    emitter: tauri::AppHandle,
    config_dir: PathBuf,
    request_id: &str,
    messages: &[WireMessage],
) -> Result<(), AppError> {
    let settings = load_settings(&config_dir);
    if settings.api_key.trim().is_empty() {
        emit(
            &emitter,
            ChatEvent {
                id: request_id.to_string(),
                text: None,
                error: Some("No API key configured. Open the chat settings (gear icon) and add your Anthropic API key.".into()),
                done: Some(true),
            },
        );
        return Ok(());
    }

    let mut api_messages = serde_json::json!([]);
    if let Some(arr) = api_messages.as_array_mut() {
        for m in messages {
            let role = if m.role == "assistant" { "assistant" } else { "user" };
            arr.push(serde_json::json!({ "role": role, "content": m.content }));
        }
    }

    let body = serde_json::json!({
        "model": settings.model,
        "max_tokens": 16384,
        "thinking": { "type": "adaptive", "display": "summarized" },
        "fallbacks": "default",
        "system": SYSTEM_PROMPT,
        "messages": api_messages,
        "stream": true,
    });

    let resp = match ureq::post(API_URL)
        .set("x-api-key", settings.api_key.trim())
        .set("anthropic-version", ANTHROPIC_VERSION)
        .set("anthropic-beta", FALLBACK_BETA)
        .set("content-type", "application/json")
        .send_json(&body)
    {
        Ok(r) => r,
        Err(ureq::Error::Status(code, resp)) => {
            let detail = resp.into_string().unwrap_or_default();
            let friendly = match code {
                401 => "The API key was rejected (401). Check it in the chat settings.".to_string(),
                429 => "Rate limited by the API (429). Wait a moment and try again.".to_string(),
                529 => "The API is temporarily overloaded (529). Try again shortly.".to_string(),
                _ => format!("The API returned an error ({code})."),
            };
            emit(
                &emitter,
                ChatEvent {
                    id: request_id.to_string(),
                    text: None,
                    error: Some(friendly),
                    done: Some(true),
                },
            );
            return Ok(());
        }
        Err(e) => {
            emit(
                &emitter,
                ChatEvent {
                    id: request_id.to_string(),
                    text: None,
                    error: Some(format!("Could not reach the API: {e}")),
                    done: Some(true),
                },
            );
            return Ok(());
        }
    };

    // Stream SSE: `data: {...}` lines; text arrives in content_block_delta.
    let reader = BufReader::new(resp.into_reader());
    let mut saw_stop = false;
    for line in reader.lines() {
        let Ok(line) = line else { break };
        let line = line.trim();
        if !line.starts_with("data:") {
            continue;
        }
        let payload = line[5..].trim();
        if payload == "[DONE]" {
            saw_stop = true;
            break;
        }
        let Ok(json) = serde_json::from_str::<serde_json::Value>(payload) else { continue };
        let Some(event_type) = json["type"].as_str() else { continue };
        match event_type {
            "content_block_delta" => {
                if let Some(text) = json.pointer("/delta/text").and_then(|t| t.as_str()) {
                    emit(
                        &emitter,
                        ChatEvent { id: request_id.to_string(), text: Some(text.to_string()), error: None, done: None },
                    );
                }
            }
            "message_stop" => {
                saw_stop = true;
                break;
            }
            _ => {}
        }
    }
    let _ = saw_stop;

    emit(
        &emitter,
        ChatEvent { id: request_id.to_string(), text: None, error: None, done: Some(true) },
    );
    Ok(())
}

fn emit(emitter: &tauri::AppHandle, event: ChatEvent) {
    let _ = emitter.emit("chat://chunk", event);
}
