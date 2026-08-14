// Minimal, dependency-free markdown parser. Produces a typed AST of plain
// strings — never HTML. Rendering happens in components/Markdown.tsx, where
// React's escaping makes raw-HTML injection impossible by construction.
//
// Node ids are assigned per parse (1, 2, 3, …) so React keys are stable and
// deterministic without falling back to array indices.

export type Inline =
  | { id: number; t: "text"; s: string }
  | { id: number; t: "code"; s: string }
  | { id: number; t: "strong"; c: Inline[] }
  | { id: number; t: "em"; c: Inline[] }
  | { id: number; t: "a"; href: string; c: Inline[] };

export type Block =
  | { id: number; t: "p"; c: Inline[] }
  | { id: number; t: "h"; level: number; c: Inline[] }
  | { id: number; t: "hr" }
  | { id: number; t: "quote"; c: Inline[] }
  | { id: number; t: "list"; ordered: boolean; items: Array<{ id: number; c: Inline[] }> }
  | {
      id: number;
      t: "table";
      header: Array<{ id: number; c: Inline[] }>;
      rows: Array<{ id: number; cells: Array<{ id: number; c: Inline[] }> }>;
    }
  | { id: number; t: "pre"; lang: string | null; code: string };

type NextId = () => number;

/** Inline scanner: `` `code` ``, **strong**, *em*, and [label](href). */
function parseInline(text: string, nextId: NextId): Inline[] {
  const out: Inline[] = [];
  const buf: string[] = [];
  const flush = () => {
    if (buf.length > 0) {
      out.push({ id: nextId(), t: "text", s: buf.join("") });
      buf.length = 0;
    }
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > 0) {
        flush();
        out.push({ id: nextId(), t: "code", s: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (text.startsWith("**", i) || text.startsWith("__", i)) {
      const marker = text[i];
      const end = text.indexOf(marker + marker, i + 2);
      if (end > 0) {
        flush();
        out.push({ id: nextId(), t: "strong", c: parseInline(text.slice(i + 2, end), nextId) });
        i = end + 2;
        continue;
      }
    }
    if (ch === "*" || ch === "_") {
      const end = text.indexOf(ch, i + 1);
      if (end > i + 1) {
        flush();
        out.push({ id: nextId(), t: "em", c: parseInline(text.slice(i + 1, end), nextId) });
        i = end + 1;
        continue;
      }
    }
    if (ch === "[") {
      const open = text.indexOf("](", i + 1);
      const close = open > 0 ? text.indexOf(")", open + 2) : -1;
      if (close > open) {
        flush();
        out.push({
          id: nextId(),
          t: "a",
          href: text.slice(open + 2, close),
          c: parseInline(text.slice(i + 1, open), nextId),
        });
        i = close + 1;
        continue;
      }
    }
    buf.push(ch);
    i++;
  }
  flush();
  return out;
}

export function parseMarkdown(src: string): Block[] {
  let n = 1;
  const nextId = () => n++;

  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let list: "ul" | "ol" | null = null;
  let listItems: Array<{ id: number; c: Inline[] }> = [];
  let fence: string | null = null;
  let fenceLang: string | null = null;
  let code: string[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (para.length > 0) {
      blocks.push({ id: nextId(), t: "p", c: parseInline(para.join(" "), nextId) });
      para = [];
    }
  };
  const closeList = () => {
    if (list) {
      blocks.push({ id: nextId(), t: "list", ordered: list === "ol", items: listItems });
      list = null;
      listItems = [];
    }
  };

  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li];
    // Fenced code.
    if (fence) {
      if (raw.trim().startsWith(fence)) {
        blocks.push({ id: nextId(), t: "pre", lang: fenceLang, code: code.join("\n") });
        code = [];
        fence = null;
        fenceLang = null;
      } else {
        code.push(raw);
      }
      continue;
    }
    const fenceMatch = raw.match(/^\s*(```|~~~)(.*)$/);
    if (fenceMatch) {
      flushPara();
      closeList();
      fence = fenceMatch[1];
      fenceLang = fenceMatch[2].trim() || null;
      continue;
    }
    // GFM table: a header row, a |---| separator, then body rows — the body
    // rows are consumed here so the main loop never re-reads them.
    const tableHeader = raw.match(/^\s*\|(.+)\|\s*$/);
    if (tableHeader) {
      const next = lines[li + 1] ?? "";
      const isSeparator = /^\s*\|?(\s*:?-+:?\s*\|)+(\s*:?-+:?\s*)?\|?\s*$/.test(next);
      if (isSeparator) {
        flushPara();
        closeList();
        const cells = (row: string) =>
          row
            .replace(/^\s*\||\|\s*$/g, "")
            .split("|")
            .map((c) => ({ id: nextId(), c: parseInline(c.trim(), nextId) }));
        const header = cells(tableHeader[1]);
        const rows: Array<{ id: number; cells: Array<{ id: number; c: Inline[] }> }> = [];
        let j = li + 2;
        for (; j < lines.length; j++) {
          const m = lines[j].match(/^\s*\|(.+)\|\s*$/);
          if (!m) break;
          rows.push({ id: nextId(), cells: cells(m[1]) });
        }
        li = j - 1; // resume after the table
        blocks.push({ id: nextId(), t: "table", header, rows });
        continue;
      }
    }
    const heading = raw.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushPara();
      closeList();
      blocks.push({ id: nextId(), t: "h", level: heading[1].length, c: parseInline(heading[2], nextId) });
      continue;
    }
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(raw)) {
      flushPara();
      closeList();
      blocks.push({ id: nextId(), t: "hr" });
      continue;
    }
    if (/^\s*>\s?/.test(raw)) {
      flushPara();
      closeList();
      blocks.push({ id: nextId(), t: "quote", c: parseInline(raw.replace(/^\s*>\s?/, ""), nextId) });
      continue;
    }
    const ul = raw.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) {
      flushPara();
      if (list !== "ul") {
        closeList();
        list = "ul";
      }
      listItems.push({ id: nextId(), c: parseInline(ul[1], nextId) });
      continue;
    }
    const ol = raw.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) {
      flushPara();
      if (list !== "ol") {
        closeList();
        list = "ol";
      }
      listItems.push({ id: nextId(), c: parseInline(ol[1], nextId) });
      continue;
    }
    if (raw.trim() === "") {
      flushPara();
      closeList();
      continue;
    }
    para.push(raw);
  }
  if (fence) blocks.push({ id: nextId(), t: "pre", lang: fenceLang, code: code.join("\n") });
  flushPara();
  closeList();
  return blocks;
}
