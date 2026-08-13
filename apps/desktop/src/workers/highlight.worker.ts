// Syntax highlighting worker: keeps hljs tokenization off the main thread.
// The main thread sends batches of plain-text lines for the visible window
// and receives escaped HTML back.

import hljs from "highlight.js/lib/common";

interface Request {
  id: number;
  lang: string | null;
  lines: string[];
}

interface Response {
  id: number;
  html: string[];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

self.onmessage = (event: MessageEvent<Request>) => {
  const { id, lang, lines } = event.data;
  const html = lines.map((line) => {
    try {
      if (lang) {
        return hljs.highlight(line, { language: lang, ignoreIllegals: true }).value;
      }
      if (line.length > 0) {
        return hljs.highlightAuto(line).value;
      }
      return "";
    } catch {
      return escapeHtml(line);
    }
  });
  const response: Response = { id, html };
  (self as unknown as Worker).postMessage(response);
};

export {};
