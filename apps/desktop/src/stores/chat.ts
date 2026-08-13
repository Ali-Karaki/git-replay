// Chat panel state: messages, settings, streaming. The API key lives on the
// Rust side (OS config dir) — this store only ever sees `hasKey`.

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api } from "../lib/ipc";
import { buildChatContext } from "../lib/chatContext";
import type { ChatMessage } from "../lib/types";

interface ChatState {
  open: boolean;
  messages: ChatMessage[];
  sending: boolean;
  provider: string;
  model: string;
  baseUrl: string;
  hasKey: boolean;
  settingsOpen: boolean;
  pendingId: string | null;

  setOpen(open: boolean): void;
  clearMessages(): void;
  setSettingsOpen(v: boolean): void;
  loadSettings(): Promise<void>;
  saveSettings(provider: string, model: string, baseUrl: string | null, apiKey: string | null): Promise<void>;
  clearKey(): Promise<void>;
  send(question: string): Promise<void>;
  appendChunk(id: string, text: string): void;
  finishStream(id: string, error: string | null): void;
}

let nextId = 1;

export const useChat = create<ChatState>()(
  persist(
    (set, get) => ({
      open: false,
      messages: [],
      sending: false,
      provider: "anthropic",
      model: "claude-opus-5",
      baseUrl: "",
      hasKey: false,
      settingsOpen: false,
      pendingId: null,

      setOpen(open) {
        set({ open });
        if (open && !get().hasKey) void get().loadSettings();
      },

      clearMessages() {
        set({ messages: [] });
      },

      setSettingsOpen(v) {
        set({ settingsOpen: v });
      },

      async loadSettings() {
        try {
          const s = await api.getChatSettings();
          set({ provider: s.provider, model: s.model, baseUrl: s.baseUrl, hasKey: s.hasKey });
        } catch {
          // Settings unavailable — chat just stays disabled-looking.
        }
      },

      async saveSettings(provider, model, baseUrl, apiKey) {
        const s = await api.setChatSettings(provider, model, baseUrl, apiKey);
        // Keep the settings open so the "Saved ✓" feedback is visible.
        set({ provider: s.provider, model: s.model, baseUrl: s.baseUrl, hasKey: s.hasKey });
      },

      async clearKey() {
        const s = await api.clearChatSettings();
        set({ hasKey: s.hasKey });
      },

      async send(question) {
        const { messages, sending } = get();
        if (sending) return;
        const context = await buildChatContext();
        const userContent = `${question}\n\n<context>\n${context}\n</context>`;

        const history = messages
          .filter((m) => !m.error)
          .slice(-12)
          .map((m) => ({ role: m.role, content: m.content }));
        const id = `req-${nextId++}`;
        const payload = [...history, { role: "user", content: userContent }];

        set({
          messages: [...messages, { role: "user", content: question }, { role: "assistant", content: "" }],
          sending: true,
          pendingId: id,
        });
        try {
          await api.chatSend(id, payload);
        } catch (e) {
          get().finishStream(id, (e as { message?: string }).message ?? String(e));
        }
      },

      appendChunk(id, text) {
        if (get().pendingId !== id) return;
        set((s) => {
          const messages = [...s.messages];
          const last = messages[messages.length - 1];
          if (last && last.role === "assistant") {
            messages[messages.length - 1] = { ...last, content: last.content + text };
          }
          return { messages };
        });
      },

      finishStream(id, error) {
        if (get().pendingId !== id) return;
        set((s) => {
          const messages = [...s.messages];
          const last = messages[messages.length - 1];
          if (last && last.role === "assistant") {
            messages[messages.length - 1] = { ...last, content: error ? last.content || "" : last.content, error: !!error };
          }
          if (error && last) {
            // Surface the error as text in the bubble.
            messages[messages.length - 1] = {
              ...last,
              content: error,
              error: true,
            };
          }
          return { messages, sending: false, pendingId: null };
        });
      },
    }),
    {
      name: "git-replay-chat",
      partialize: (s) => ({ messages: s.messages.slice(-40), model: s.model }),
    },
  ),
);
