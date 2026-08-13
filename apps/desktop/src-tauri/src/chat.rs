//! The AI chat layer: BYO provider + API key, requests go DIRECTLY from this
//! app to the chosen provider (no middleman), with streaming responses. The
//! key lives in the OS config directory, never in the webview, and the chat
//! is fully opt-in — core replay works with AI disabled (spec 43).
//!
//! Providers:
//! - `anthropic` — Messages API (`api.anthropic.com/v1/messages`), model
//!   `claude-opus-5` default, adaptive thinking with summarized display, and
//!   `fallbacks: "default"` refusal handling (per the claude-api skill).
//! - `deepseek` — Anthropic-compatible endpoint (`api.deepseek.com/anthropic`),
//!   models `deepseek-chat` / `deepseek-reasoner`.
//! - `openai` / `openrouter` / custom endpoints — OpenAI chat/completions
//!   wire shape with SSE `choices[0].delta.content` streaming.

use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use tauri::Emitter;

const ANTHROPIC_VERSION: &str = "2023-06-01";
const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";

const ANTHROPIC_SYSTEM_PROMPT: &str = "\
You are a code-exploration assistant inside Git Replay, a desktop app that replays how a \
Git repository evolved commit by commit. The user is stepping through a timeline of commits, \
diffs, and snapshots.

The CONTEXT section below describes what the user is currently looking at (current commit, \
changed files, selected file's diff or content, replay range). Answer questions about that \
context precisely; reference files and commits by name. Be concise — lead with the outcome. \
If the question needs information that is not in the context, say what is missing instead of \
guessing. Never invent file contents or commit hashes.";

const GENERIC_SYSTEM_PROMPT: &str = "\
You are a code-exploration assistant inside Git Replay, a desktop app that replays how a \
Git repository evolved commit by commit. Answer questions about the CONTEXT below precisely; \
reference files and commits by name. Be concise — lead with the outcome. If the question \
needs information that is not in the context, say what is missing instead of guessing. \
Never invent file contents or commit hashes.";

/// The six supported provider shapes.
pub const PROVIDERS: &[(&str, &str, &str)] = &[
    // (id, label, default model)
    ("anthropic", "Anthropic (Claude)", "claude-opus-5"),
    ("deepseek", "DeepSeek", "deepseek-chat"),
    ("openai", "OpenAI", ""),
    ("openrouter", "OpenRouter", ""),
    ("custom_openai", "Custom (OpenAI-compatible)", ""),
    ("custom_anthropic", "Custom (Anthropic-compatible)", ""),
];

fn default_model(provider: &str) -> String {
    PROVIDERS.iter().find(|(id, _, _)| *id == provider).map(|(_, _, m)| *m).unwrap_or("").to_string()
}

fn default_base_url(provider: &str) -> &'static str {
    match provider {
        "anthropic" => "https://api.anthropic.com/v1/messages",
        "deepseek" => "https://api.deepseek.com/anthropic",
        "openai" => "https://api.openai.com/v1/chat/completions",
        "openrouter" => "https://openrouter.ai/api/v1/chat/completions",
        _ => "",
    }
}

fn anthropic_shaped(provider: &str) -> bool {
    matches!(provider, "anthropic" | "deepseek" | "custom_anthropic")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSettings {
    pub provider: String,
    pub model: String,
    pub base_url: String,
    /// Never returned after being set.
    pub has_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredSettings {
    pub provider: String,
    pub model: String,
    pub base_url: String,
    pub api_key: String,
}

impl Default for StoredSettings {
    fn default() -> Self {
        Self { provider: "anthropic".into(), model: "claude-opus-5".into(), base_url: String::new(), api_key: String::new() }
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
    let path = settings_path(config_dir);
    let settings: StoredSettings = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    #[cfg(debug_assertions)]
    eprintln!("CHAT_LOAD provider={} key_len={} path={}", settings.provider, settings.api_key.len(), path.display());
    settings
}

pub fn save_settings(config_dir: &PathBuf, settings: &StoredSettings) -> Result<(), AppError> {
    // The config directory may not exist on first use — create it.
    std::fs::create_dir_all(config_dir)
        .map_err(|e| AppError::io("could not create the config directory", e))?;
    let json = serde_json::to_string_pretty(settings)
        .map_err(|e| AppError::new(crate::error::ErrorKind::Cache, format!("could not serialize chat settings: {e}")))?;
    let path = settings_path(config_dir);
    #[cfg(debug_assertions)]
    eprintln!("CHAT_SAVE provider={} key_len={} path={}", settings.provider, settings.api_key.len(), path.display());
    std::fs::write(&path, json)
        .map_err(|e| AppError::io("could not save chat settings", e))
}

/// Remove a stored API key (provider/model stay).
pub fn clear_key(config_dir: &PathBuf) -> Result<(), AppError> {
    let mut settings = load_settings(config_dir);
    settings.api_key = String::new();
    save_settings(config_dir, &settings)
}

/// Normalize a settings update: empty model → provider default; empty base
/// URL → provider default.
pub fn normalized(settings: &mut StoredSettings) {
    if settings.model.trim().is_empty() {
        settings.model = default_model(&settings.provider);
    }
    if settings.base_url.trim().is_empty() {
        settings.base_url = default_base_url(&settings.provider).to_string();
    }
}

/// Streaming chat request. `messages` is the full conversation (context
/// already baked into the last user message by the frontend). Progress is
/// emitted as `chat://chunk` events carrying the request id.
pub fn run_chat_request(
    emitter: tauri::AppHandle,
    config_dir: PathBuf,
    request_id: &str,
    messages: &[WireMessage],
) -> Result<(), AppError> {
    let mut settings = load_settings(&config_dir);
    normalized(&mut settings);
    if settings.api_key.trim().is_empty() {
        emit(
            &emitter,
            ChatEvent {
                id: request_id.to_string(),
                text: None,
                error: Some(
                    "No API key configured. Open the chat settings (gear icon), pick a provider, and add your API key.".into(),
                ),
                done: Some(true),
            },
        );
        return Ok(());
    }

    let base_url = settings.base_url.clone();
    let body = if anthropic_shaped(&settings.provider) {
        build_anthropic_body(&settings, messages)
    } else {
        build_openai_body(&settings, messages)
    };

    // Anthropic-shaped auth uses x-api-key; OpenAI-shaped uses Bearer.
    let use_bearer = !anthropic_shaped(&settings.provider);
    let mut req = ureq::post(&base_url)
        .set("content-type", "application/json")
        .set("anthropic-version", ANTHROPIC_VERSION);
    if use_bearer {
        req = req.set("Authorization", &format!("Bearer {}", settings.api_key.trim()));
    } else {
        req = req.set("x-api-key", settings.api_key.trim());
        if settings.provider == "anthropic" {
            req = req.set("anthropic-beta", FALLBACK_BETA);
        }
    }

    let resp = match req.send_json(&body) {
        Ok(r) => r,
        Err(ureq::Error::Status(code, resp)) => {
            let friendly = match code {
                401 => "The API key was rejected (401). Check it in the chat settings.".to_string(),
                402 => "The provider reports insufficient credits (402).".to_string(),
                429 => "Rate limited by the provider (429). Wait a moment and try again.".to_string(),
                529 => "The provider is temporarily overloaded (529). Try again shortly.".to_string(),
                _ => format!("The provider returned an error ({code})."),
            };
            let _ = resp.into_string();
            emit(
                &emitter,
                ChatEvent { id: request_id.to_string(), text: None, error: Some(friendly), done: Some(true) },
            );
            return Ok(());
        }
        Err(e) => {
            emit(
                &emitter,
                ChatEvent {
                    id: request_id.to_string(),
                    text: None,
                    error: Some(format!("Could not reach the provider: {e}")),
                    done: Some(true),
                },
            );
            return Ok(());
        }
    };

    let reader = BufReader::new(resp.into_reader());
    let stream_fn: fn(&serde_json::Value) -> Option<&str> = if anthropic_shaped(&settings.provider) {
        |json| {
            if json["type"].as_str() == Some("content_block_delta") {
                json.pointer("/delta/text").and_then(|t| t.as_str())
            } else {
                None
            }
        }
    } else {
        |json| json.pointer("/choices/0/delta/content").and_then(|t| t.as_str())
    };

    for line in reader.lines() {
        let Ok(line) = line else { break };
        let line = line.trim();
        if !line.starts_with("data:") {
            continue;
        }
        let payload = line[5..].trim();
        if payload == "[DONE]" {
            break;
        }
        let Ok(json) = serde_json::from_str::<serde_json::Value>(payload) else { continue };
        if let Some(text) = stream_fn(&json) {
            if !text.is_empty() {
                emit(
                    &emitter,
                    ChatEvent { id: request_id.to_string(), text: Some(text.to_string()), error: None, done: None },
                );
            }
        }
    }

    emit(&emitter, ChatEvent { id: request_id.to_string(), text: None, error: None, done: Some(true) });
    Ok(())
}

fn build_anthropic_body(settings: &StoredSettings, messages: &[WireMessage]) -> serde_json::Value {
    let mut api_messages = serde_json::json!([]);
    if let Some(arr) = api_messages.as_array_mut() {
        for m in messages {
            let role = if m.role == "assistant" { "assistant" } else { "user" };
            arr.push(serde_json::json!({ "role": role, "content": m.content }));
        }
    }
    let mut body = serde_json::json!({
        "model": settings.model,
        "max_tokens": 16384,
        "system": ANTHROPIC_SYSTEM_PROMPT,
        "messages": api_messages,
        "stream": true,
    });
    // Claude-specific parameters (rejected by compatible endpoints).
    if settings.provider == "anthropic" {
        body["thinking"] = serde_json::json!({ "type": "adaptive", "display": "summarized" });
        body["fallbacks"] = serde_json::json!("default");
    }
    body
}

fn build_openai_body(settings: &StoredSettings, messages: &[WireMessage]) -> serde_json::Value {
    let mut api_messages = serde_json::json!([{ "role": "system", "content": GENERIC_SYSTEM_PROMPT }]);
    if let Some(arr) = api_messages.as_array_mut() {
        for m in messages {
            let role = if m.role == "assistant" { "assistant" } else { "user" };
            arr.push(serde_json::json!({ "role": role, "content": m.content }));
        }
    }
    serde_json::json!({
        "model": settings.model,
        "max_tokens": 16384,
        "messages": api_messages,
        "stream": true,
    })
}

fn emit(emitter: &tauri::AppHandle, event: ChatEvent) {
    let _ = emitter.emit("chat://chunk", event);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(role: &str, content: &str) -> WireMessage {
        WireMessage { role: role.into(), content: content.into() }
    }

    #[test]
    fn anthropic_body_is_skill_compliant_and_compat_is_lean() {
        let anthropic = StoredSettings {
            provider: "anthropic".into(),
            model: "claude-opus-5".into(),
            base_url: String::new(),
            api_key: "k".into(),
        };
        let body = build_anthropic_body(&anthropic, &[msg("user", "hi")]);
        assert_eq!(body["model"], "claude-opus-5");
        assert!(body["thinking"].is_object(), "adaptive thinking for Claude");
        assert_eq!(body["fallbacks"], "default");
        assert!(body["system"].as_str().unwrap().contains("Git Replay"));

        // Compatible endpoints must NOT receive Claude-only parameters.
        let deepseek = StoredSettings {
            provider: "deepseek".into(),
            model: "deepseek-chat".into(),
            base_url: "https://api.deepseek.com/anthropic".into(),
            api_key: "k".into(),
        };
        let body = build_anthropic_body(&deepseek, &[msg("user", "hi")]);
        assert!(body.get("thinking").is_none());
        assert!(body.get("fallbacks").is_none());
        assert_eq!(body["model"], "deepseek-chat");
    }

    #[test]
    fn openai_body_includes_system_message_first() {
        let settings = StoredSettings {
            provider: "openai".into(),
            model: "gpt-5-mini".into(),
            base_url: "https://api.openai.com/v1/chat/completions".into(),
            api_key: "k".into(),
        };
        let body = build_openai_body(&settings, &[msg("user", "hi"), msg("assistant", "hello"), msg("user", "again")]);
        let messages = body["messages"].as_array().unwrap();
        assert_eq!(messages[0]["role"], "system");
        assert_eq!(messages[1]["role"], "user");
        assert_eq!(messages[2]["role"], "assistant");
    }

    #[test]
    fn provider_defaults_fill_in() {
        let mut deepseek = StoredSettings {
            provider: "deepseek".into(),
            model: String::new(),
            base_url: String::new(),
            api_key: "k".into(),
        };
        normalized(&mut deepseek);
        assert_eq!(deepseek.model, "deepseek-chat");
        assert_eq!(deepseek.base_url, "https://api.deepseek.com/anthropic");

        let mut anthropic = StoredSettings::default();
        normalized(&mut anthropic);
        assert_eq!(anthropic.model, "claude-opus-5");
        assert_eq!(anthropic.base_url, "https://api.anthropic.com/v1/messages");
    }
}
