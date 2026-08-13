// Markdown parser: the common shapes. The parser returns a typed AST of
// plain strings — rendering (and thus injection safety) lives in the React
// layer, which escapes by construction. Node ids are per-parse counters,
// so the tests compare structure with ids stripped.

import { describe, expect, it } from "vitest";
import { type Block, parseMarkdown } from "./markdown";

type StrippedBlock = unknown;
type StrippedInline = unknown;

function stripIds(blocks: Block[]): StrippedBlock[] {
  return blocks.map((b) => {
    if (b.t === "p") return { t: "p", c: stripInline(b.c) };
    if (b.t === "h") return { t: "h", level: b.level, c: stripInline(b.c) };
    if (b.t === "hr") return { t: "hr" };
    if (b.t === "quote") return { t: "quote", c: stripInline(b.c) };
    if (b.t === "list") return { t: "list", ordered: b.ordered, items: b.items.map((i) => stripInline(i.c)) };
    return { t: "pre", code: b.code };
  });
}

function stripInline(nodes: unknown[]): StrippedInline[] {
  return (nodes as Array<{ t: string; s?: string; href?: string; c?: unknown[] }>).map((n) => {
    if (n.t === "text" || n.t === "code") return { t: n.t, s: n.s };
    if (n.t === "strong" || n.t === "em") return { t: n.t, c: stripInline(n.c ?? []) };
    return { t: "a", href: n.href, c: stripInline(n.c ?? []) };
  });
}

describe("parseMarkdown", () => {
  it("parses headings, paragraphs and inline styles", () => {
    const blocks = stripIds(parseMarkdown("# Title\n\nSome **bold** and *italic* and `code` text.\n"));
    expect(blocks[0]).toEqual({ t: "h", level: 1, c: [{ t: "text", s: "Title" }] });
    expect(blocks[1]).toEqual({
      t: "p",
      c: [
        { t: "text", s: "Some " },
        { t: "strong", c: [{ t: "text", s: "bold" }] },
        { t: "text", s: " and " },
        { t: "em", c: [{ t: "text", s: "italic" }] },
        { t: "text", s: " and " },
        { t: "code", s: "code" },
        { t: "text", s: " text." },
      ],
    });
  });

  it("parses fenced code blocks without interpreting their contents", () => {
    const blocks = stripIds(parseMarkdown("```ts\nconst x = <T>1;\n```\n"));
    expect(blocks).toEqual([{ t: "pre", code: "const x = <T>1;" }]);
  });

  it("parses lists and links", () => {
    const blocks = stripIds(parseMarkdown("- one\n- two\n\n1. first\n2. second\n\n[link](https://example.com)\n"));
    expect(blocks[0]).toEqual({
      t: "list",
      ordered: false,
      items: [[{ t: "text", s: "one" }], [{ t: "text", s: "two" }]],
    });
    expect(blocks[1]).toEqual({
      t: "list",
      ordered: true,
      items: [[{ t: "text", s: "first" }], [{ t: "text", s: "second" }]],
    });
    expect(blocks[2]).toEqual({ t: "p", c: [{ t: "a", href: "https://example.com", c: [{ t: "text", s: "link" }] }] });
  });

  it("keeps raw HTML as inert text — nothing becomes a tag", () => {
    const blocks = stripIds(parseMarkdown("hello <script>alert(1)</script> world"));
    expect(blocks).toEqual([{ t: "p", c: [{ t: "text", s: "hello <script>alert(1)</script> world" }] }]);
  });

  it("parses blockquotes and horizontal rules", () => {
    const blocks = stripIds(parseMarkdown("> quoted\n\n---\n"));
    expect(blocks[0]).toEqual({ t: "quote", c: [{ t: "text", s: "quoted" }] });
    expect(blocks[1]).toEqual({ t: "hr" });
  });
});
