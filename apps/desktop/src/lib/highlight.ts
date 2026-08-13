// Client for the highlighting worker: line-keyed cache + window batching.

import { escapeHtml } from "./format";

interface Pending {
  resolve: (html: string[]) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
const lineCache = new Map<string, string>(); // `${lang}|${text}` → html
const MAX_CACHE = 40_000;

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL("../workers/highlight.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; html: string[] }>) => {
      const p = pending.get(e.data.id);
      if (p) {
        pending.delete(e.data.id);
        p.resolve(e.data.html);
      }
    };
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      pending.forEach((p) => p.resolve([]));
      pending.clear();
    };
  } catch {
    return null;
  }
  return worker;
}

/** Highlight a batch of lines. Falls back to escaped plain text. */
export function highlightLines(lang: string | null, lines: string[]): Promise<string[]> {
  const result = new Array<string>(lines.length);
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
      result[m.index] = escapeHtml(m.text);
      lineCache.set(`${lang ?? ""}|${m.text}`, result[m.index]);
    }
    return Promise.resolve(result);
  }

  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, {
      resolve: (html) => {
        missing.forEach((m, i) => {
          const key = `${lang ?? ""}|${m.text}`;
          const value = html[i] ?? escapeHtml(m.text);
          if (lineCache.size < MAX_CACHE) lineCache.set(key, value);
          result[m.index] = value;
        });
        resolve(result);
      },
    });
    w.postMessage({ id, lang, lines: missing.map((m) => m.text) });
  });
}
