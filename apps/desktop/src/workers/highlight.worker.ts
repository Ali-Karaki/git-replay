// Syntax highlighting worker: keeps hljs tokenization off the main thread.
// The main thread sends batches of plain-text lines for the visible window
// and receives token lists back — plain data, never HTML. Rendering to spans
// happens in the UI, where React's escaping makes injection impossible.

import hljs from "highlight.js/lib/common";

/** One highlighted run: the hljs class stack (outermost first) + text. */
export interface HighlightToken {
  cls: string[];
  text: string;
}

interface Request {
  id: number;
  lang: string | null;
  lines: string[];
}

interface Response {
  id: number;
  tokens: HighlightToken[][];
}

/** Parse hljs's HTML output back into the (class-stack, text) token runs it
 *  was generated from. hljs spans nest, so a stack tracks the open classes;
 *  text accumulates under the current stack. Entities are decoded here —
 *  consumers render plain strings as React text. */
function tokensFromHtml(html: string): HighlightToken[] {
  const tokens: HighlightToken[] = [];
  const stack: string[] = [];
  let buf = "";

  const decode = (s: string) =>
    s
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&");

  const flush = () => {
    if (buf !== "") {
      tokens.push({ cls: [...stack], text: decode(buf) });
      buf = "";
    }
  };

  const re = /<span class="([^"]*)">|<\/span>/g;
  let last = 0;
  for (const m of html.matchAll(re)) {
    const text = html.slice(last, m.index);
    last = (m.index ?? 0) + m[0].length;
    if (text !== "") {
      buf += text;
    }
    if (m[0] === "</span>") {
      flush();
      stack.pop();
    } else {
      flush();
      stack.push(m[1]);
    }
  }
  const tail = html.slice(last);
  if (tail !== "") buf += tail;
  flush();
  return tokens;
}

self.onmessage = (event: MessageEvent<Request>) => {
  const { id, lang, lines } = event.data;
  const tokens = lines.map((line) => {
    if (line === "") return [];
    try {
      const html = lang
        ? hljs.highlight(line, { language: lang, ignoreIllegals: true }).value
        : hljs.highlightAuto(line).value;
      return tokensFromHtml(html);
    } catch {
      return [{ cls: [], text: line }];
    }
  });
  const response: Response = { id, tokens };
  (self as unknown as Worker).postMessage(response);
};
