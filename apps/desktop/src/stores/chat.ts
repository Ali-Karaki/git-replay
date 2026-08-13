// Chat panel state: messages, settings, streaming. The API key lives on the
// Rust side (OS config dir) — this store only ever sees `hasKey`.

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { buildChatContext } from "../lib/chatContext";
import { api } from "../lib/ipc";
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
/** True once settings have been fetched at least once this session — keeps
 *  reopen cheap (no per-open flash of the no-key state) without persisting
 *  hasKey. Saves/clears keep it fresh from then on. */
let settingsLoaded = false;
/** Monotonic guard: a save or clear invalidates any in-flight load so a slow
 *  getChatSettings can never clobber a newer value. */
let settingsSeq = 0;

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
        if (open && !settingsLoaded) void get().loadSettings();
      },

      clearMessages() {
        set({ messages: [] });
      },

      setSettingsOpen(v) {
        set({ settingsOpen: v });
      },

      async loadSettings() {
        const seq = ++settingsSeq;
        try {
          const s = await api.getChatSettings();
          if (seq !== settingsSeq) return; // superseded by a save/clear
          settingsLoaded = true;
          set({ provider: s.provider, model: s.model, baseUrl: s.baseUrl, hasKey: s.hasKey });
        } catch {
          // Settings unavailable — chat just stays disabled-looking.
        }
      },

      async saveSettings(provider, model, baseUrl, apiKey) {
        settingsSeq++;
        const s = await api.setChatSettings(provider, model, baseUrl, apiKey);
        settingsLoaded = true;
        // Keep the settings open so the "Saved ✓" feedback is visible.
        set({ provider: s.provider, model: s.model, baseUrl: s.baseUrl, hasKey: s.hasKey });
      },

      async clearKey() {
        settingsSeq++;
        const s = await api.clearChatSettings();
        settingsLoaded = true;
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
          messages: [
            ...messages,
            { id: crypto.randomUUID(), role: "user", content: question },
            { id: crypto.randomUUID(), role: "assistant", content: "" },
          ],
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
            messages[messages.length - 1] = {
              ...last,
              content: error ? last.content || "" : last.content,
              error: !!error,
            };
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
      // Messages persisted before ids existed get one on rehydrate so list
      // keys stay stable.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as { messages?: ChatMessage[]; model?: string };
        return {
          ...current,
          ...p,
          messages: (p.messages ?? []).map((m) => ({
            id: m.id ?? crypto.randomUUID(),
            role: m.role,
            content: m.content,
            error: m.error,
          })),
        };
      },
    },
  ),
);
