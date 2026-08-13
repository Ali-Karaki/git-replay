// The AI chat panel — Cursor/Copilot-style: right-side drawer, streaming
// markdown answers, context-aware by default, fully opt-in. The API key is
// the user's own; requests go directly to Claude. Nothing is sent unless the
// user asks a question (spec 37/43).

import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useChat } from "../../stores/chat";
import { useReplay } from "../../stores/replay";
import { renderMarkdown } from "../../lib/markdown";
import { frameSha } from "../../stores/replay";
import type { ChatEvent } from "../../lib/types";
import { BranchIcon, CloseIcon } from "../../components/Icons";

const MODELS = [
  { id: "claude-opus-5", label: "Claude Opus 5 (default)" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (fast)" },
];

export function ChatPanel() {
  const open = useChat((s) => s.open);
  const setOpen = useChat((s) => s.setOpen);
  const messages = useChat((s) => s.messages);
  const sending = useChat((s) => s.sending);
  const hasKey = useChat((s) => s.hasKey);
  const settingsOpen = useChat((s) => s.settingsOpen);
  const setSettingsOpen = useChat((s) => s.setSettingsOpen);
  const [input, setInput] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [modelInput, setModelInput] = useState(useChat.getState().model);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Stream events from the engine.
  useEffect(() => {
    const unlisten = listen<ChatEvent>("chat://chunk", (e) => {
      const ev = e.payload;
      if (ev.text !== undefined) useChat.getState().appendChunk(ev.id, ev.text);
      if (ev.done) useChat.getState().finishStream(ev.id, ev.error ?? null);
    });
    return () => {
      void unlisten.then((u) => u());
    };
  }, []);

  // Autoscroll while streaming.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Context chips: what the answer will be grounded in.
  const range = useReplay((s) => s.range);
  const index = useReplay((s) => s.index);
  const selectedFile = useReplay((s) => s.selectedFile);
  const hasWorkingTree = useReplay((s) => s.hasWorkingTree);
  const contextChips = useMemo(() => {
    if (!range) return [];
    const chips = [`${range.commits.length} commits`];
    const sha = frameSha(range, index, hasWorkingTree);
    if (index > 0) {
      chips.push(`commit ${index} · ${sha.slice(0, 7)}`);
    } else {
      chips.push("base snapshot");
    }
    if (selectedFile) chips.push(selectedFile.split("/").pop()!);
    return chips;
  }, [range, index, selectedFile, hasWorkingTree]);

  const send = async () => {
    const q = input.trim();
    if (!q || sending) return;
    setInput("");
    await useChat.getState().send(q);
  };

  if (!open) return null;

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <span className="chat-title">
          <BranchIcon size={14} /> Ask about this replay
        </span>
        <div className="chat-header-actions">
          <button
            className={`btn-icon ${settingsOpen ? "active" : ""}`}
            onClick={() => setSettingsOpen(!settingsOpen)}
            title="Chat settings (API key + model)"
            aria-label="Chat settings"
          >
            ⚙
          </button>
          <button className="btn-icon" onClick={() => setOpen(false)} title="Close chat" aria-label="Close chat">
            <CloseIcon size={14} />
          </button>
        </div>
      </div>

      {settingsOpen && (
        <div className="chat-settings">
          <p className="dim">
            Your Anthropic API key is stored locally in the OS config directory. Requests go
            directly from this app to Claude — nothing else is sent, and only when you ask.
          </p>
          <label>
            Model
            <select className="select" value={modelInput} onChange={(e) => setModelInput(e.target.value)}>
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </label>
          <label>
            API key {hasKey && <span className="dim">(saved — leave blank to keep)</span>}
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="sk-ant-…"
              autoComplete="off"
            />
          </label>
          <button className="btn btn-primary" onClick={() => void useChat.getState().saveSettings(modelInput, keyInput || null)}>
            Save
          </button>
        </div>
      )}

      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="empty-title">Ask anything about this code</div>
            <div className="empty-hint">
              Questions are answered with the current commit's changes, the selected file's diff, and the replay
              range as context — e.g. “why was this changed?” or “how did this file evolve?”
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            {m.role === "assistant" && m.error ? (
              <div className="chat-error">{m.content}</div>
            ) : m.role === "assistant" ? (
              <div className="chat-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content || (sending ? "…" : "")) }} />
            ) : (
              <div className="chat-user-text">{m.content}</div>
            )}
          </div>
        ))}
        {!hasKey && !settingsOpen && (
          <button className="chat-key-cta" onClick={() => setSettingsOpen(true)}>
            Add your API key to start asking →
          </button>
        )}
      </div>

      <div className="chat-input-row">
        {contextChips.length > 0 && (
          <div className="chat-context">
            {contextChips.map((c) => (
              <span key={c} className="chat-context-chip" title="Attached as context to your question">{c}</span>
            ))}
          </div>
        )}
        <textarea
          ref={inputRef}
          className="chat-input"
          rows={2}
          placeholder="Ask about this commit, diff, or file… (Enter to send, Shift+Enter for a new line)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="chat-input-actions">
          <button className="btn" onClick={() => void useChat.getState().clearMessages()} disabled={messages.length === 0}>
            Clear
          </button>
          <button className="btn btn-primary" onClick={() => void send()} disabled={sending || !input.trim()}>
            {sending ? "Thinking…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
