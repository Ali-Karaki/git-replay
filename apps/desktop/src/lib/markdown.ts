// Minimal, dependency-free markdown renderer for the file viewer's preview
// mode. Input is escaped first — raw HTML never passes through.

import { escapeHtml } from "./format";

function inline(text: string): string {
  let out = escapeHtml(text);
  // inline code first (protects its contents)
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  out = out.replace(/_([^_\n]+)_/g, "<em>$1</em>");
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  return out;
}

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let list: "ul" | "ol" | null = null;
  let fence: string | null = null;
  let code: string[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (para.length > 0) {
      html.push(`<p>${inline(para.join(" "))}</p>`);
      para = [];
    }
  };
  const closeList = () => {
    if (list) {
      html.push(`</${list}>`);
      list = null;
    }
  };

  for (const raw of lines) {
    // Fenced code.
    if (fence) {
      if (raw.trim().startsWith(fence)) {
        html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        code = [];
        fence = null;
      } else {
        code.push(raw);
      }
      continue;
    }
    const fenceMatch = raw.match(/^\s*(```|~~~)/);
    if (fenceMatch) {
      flushPara();
      closeList();
      fence = fenceMatch[1];
      continue;
    }
    const heading = raw.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushPara();
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(raw)) {
      flushPara();
      closeList();
      html.push("<hr/>");
      continue;
    }
    if (/^\s*>\s?/.test(raw)) {
      flushPara();
      closeList();
      html.push(`<blockquote>${inline(raw.replace(/^\s*>\s?/, ""))}</blockquote>`);
      continue;
    }
    const ul = raw.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) {
      flushPara();
      if (list !== "ul") {
        closeList();
        html.push("<ul>");
        list = "ul";
      }
      html.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }
    const ol = raw.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) {
      flushPara();
      if (list !== "ol") {
        closeList();
        html.push("<ol>");
        list = "ol";
      }
      html.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }
    if (raw.trim() === "") {
      flushPara();
      closeList();
      continue;
    }
    para.push(raw);
  }
  if (fence) html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
  flushPara();
  closeList();
  return html.join("\n");
}
