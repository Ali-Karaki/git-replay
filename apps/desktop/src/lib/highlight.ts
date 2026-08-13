// Client for the highlighting worker: line-keyed cache + window batching.
// Lines come back as token runs (class stacks + plain text) — consumers
// render them as React spans, never as HTML strings.

import type { HighlightToken } from "../workers/highlight.worker";

interface Pending {
  resolve: (tokens: HighlightToken[][]) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
const lineCache = new Map<string, HighlightToken[]>(); // `${lang}|${text}` → tokens
const MAX_CACHE = 40_000;

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL("../workers/highlight.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; tokens: HighlightToken[][] }>) => {
      const p = pending.get(e.data.id);
      if (p) {
        pending.delete(e.data.id);
        p.resolve(e.data.tokens);
      }
    };
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      pending.forEach((p) => {
        p.resolve([]);
      });
      pending.clear();
    };
  } catch {
    return null;
  }
  return worker;
}

/** Highlight a batch of lines. Falls back to plain unhighlighted tokens. */
export function highlightLines(lang: string | null, lines: string[]): Promise<HighlightToken[][]> {
  const result = new Array<HighlightToken[]>(lines.length);
  const missing: Array<{ index: number; text: string }> = [];

  lines.forEach((text, index) => {
    const key = `${lang ?? ""}|${text}`;
    const hit = lineCache.get(key);
    if (hit !== undefined) {
      result[index] = hit;
    } else {
      missing.push({ index, text });
    }
  });

  if (missing.length === 0) {
    return Promise.resolve(result);
  }

  const w = getWorker();
  if (!w) {
    for (const m of missing) {
      const tokens = [{ cls: [], text: m.text }];
      result[m.index] = tokens;
      lineCache.set(`${lang ?? ""}|${m.text}`, tokens);
    }
    return Promise.resolve(result);
  }

  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, {
      resolve: (tokens) => {
        missing.forEach((m, i) => {
          const key = `${lang ?? ""}|${m.text}`;
          const value = tokens[i] ?? [{ cls: [], text: m.text }];
          if (lineCache.size < MAX_CACHE) lineCache.set(key, value);
          result[m.index] = value;
        });
        resolve(result);
      },
    });
    w.postMessage({ id, lang, lines: missing.map((m) => m.text) });
  });
}
